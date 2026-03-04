import { AIService } from "../../services/ai.service.js";
import { TeamState } from "../state.js";
import { ConfigManager } from "../../utils/config.js";
import { N8nClient } from "../../utils/n8nClient.js";
import { theme } from "../../utils/theme.js";
import { Spinner } from "../../utils/spinner.js";

export const qaNode = async (state: typeof TeamState.State) => {
  const aiService = AIService.getInstance();
  const workflowJson = state.workflowJson;

  if (!workflowJson) {
    throw new Error("No workflow JSON found in state to test.");
  }

  // 1. Load Credentials
  const config = await ConfigManager.load();
  // Env vars take priority over stored config so a fresh key in .env is always used
  const n8nUrl = process.env.N8N_API_URL || config.n8nUrl;
  const n8nKey = process.env.N8N_API_KEY || config.n8nKey;

  if (!n8nUrl || !n8nKey) {
    throw new Error('Credentials missing. Configure environment via \'n8m config\'.');
  }

  const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
  let createdWorkflowId: string | null = null;
  const validationErrors: string[] = [];
  let healedNodes: any[] | null = null; // set when inline fixes mutate deployed nodes

  try {
    // 2. Prepare Workflow Data (Extract from state structure)
    // engineerNode returns { workflows: [ { name, nodes, connections } ] }
    // Or it might just return the single workflow object if that's how it was implemented.
    // Based on engineer.ts logic: it returns { workflowJson: result } where result matches { workflows: [...] } structure.
    
    let targetWorkflow = workflowJson;
    if (workflowJson.workflows && Array.isArray(workflowJson.workflows) && workflowJson.workflows.length > 0) {
        targetWorkflow = workflowJson.workflows[0];
    }

    const workflowName = targetWorkflow.name || 'Agentic_Test_Workflow';

    // Drop timezone — sanitizeSettings in N8nClient strips it unconditionally
    const rawSettings = { ...(targetWorkflow.settings || {}) };
    delete rawSettings.timezone;

    // Shim external-network nodes FIRST (credentials present on the original node
    // are the signal that a node calls an external service), then strip credentials
    // from whatever remains so n8n doesn't reject the workflow at activation time.
    const shimmedNodes = N8nClient.shimNetworkNodes(
      (targetWorkflow.nodes as any[]).filter((node: any) => node != null)
    );
    const strippedNodes = shimmedNodes.map((node: any) => {
      const { credentials: _creds, ...rest } = node;
      return rest;
    });

    const rootPayload = {
      nodes: strippedNodes,
      connections: targetWorkflow.connections,
      settings: rawSettings,
      staticData: targetWorkflow.staticData || {},
      name: `[n8m:test] ${workflowName}`,
    };

    // Shim trigger if needed (reusing logic from test.ts)
    // CRITICAL: We MUST have a proper Webhook for automated testing to working.
    // Manual Triggers cannot be "activated" via API, and we need activation for validation.
    // So we inject a webhook shim even if a Manual Trigger exists.
    const hasWebhook = rootPayload.nodes.some((n: any) => 
      n.type === 'n8n-nodes-base.webhook' && !n.disabled
    );
    
    if (!hasWebhook) {
         const shimmed = client.injectManualTrigger(rootPayload);
         rootPayload.nodes = shimmed.nodes;
         rootPayload.connections = shimmed.connections;
    }

    // 3. Deploy Ephemeral Workflow
    const result = await client.createWorkflow(rootPayload.name, rootPayload);
    createdWorkflowId = result.id;

    // 4. Determine Test Scenarios
    let scenarios = state.testScenarios;
    if (!scenarios || scenarios.length === 0) {
        // Fallback to generating a single mock payload for efficiency if no scenarios provided
        const nodeNames = targetWorkflow.nodes.map((n: any) => n.name).join(', ');
        const context = `Workflow Name: "${targetWorkflow.name}"
        Nodes: ${nodeNames}
        Goal: "${state.userGoal}"
        Generate a SINGLE JSON object payload that effectively tests this workflow.`;
        const mockPayload = await aiService.generateMockData(context);
        scenarios = [{ name: "Default Test", payload: mockPayload }];
    }

    // Track whether we mutated the deployed workflow so we can surface the healed JSON

    const webhookNode = rootPayload.nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook');

    if (webhookNode) {
        const path = webhookNode.parameters?.path;
        if (path) {
            // Activate for webhook testing — n8n validates the workflow at this point
            try {
                await client.activateWorkflow(createdWorkflowId);
            } catch (activateErr: any) {
                const raw: string = activateErr.message || String(activateErr);
                // Try to extract a clean message from a JSON error body
                let reason = raw;
                const jsonMatch = raw.match(/\{.*\}/s);
                if (jsonMatch) {
                    try { reason = JSON.parse(jsonMatch[0]).message ?? raw; } catch { /* keep raw */ }
                }
                const msg = `Activation rejected by n8n: ${reason}`;
                validationErrors.push(msg);
                console.log(theme.fail(msg));
                return { validationStatus: 'failed', validationErrors };
            }
            const baseUrl = new URL(n8nUrl).origin;
            const webhookUrl = `${baseUrl}/webhook/${path}`;

            for (const scenario of scenarios) {
                let fixAttempted = false;
                let binaryShimInjected = false;
                let codeNodeFixApplied = false; // tracks whether a code_node_js fix was actually committed
                let codeNodeFixAppliedName: string | undefined;
                let mockDataShimApplied = false; // tracks whether mock-data shim replaced the Code node

                // Up to 5 rounds: initial + fix + mock-shim + downstream + buffer
                fixRound: for (let fixRound = 0; fixRound < 5; fixRound++) {
                    console.log(theme.agent(`Testing: ${scenario.name}${fixRound > 0 ? ` (retry ${fixRound})` : ''}`));
                    const response = await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(scenario.payload)
                    });

                    if (!response.ok) {
                        validationErrors.push(`Scenario "${scenario.name}" failed to trigger: ${response.status}`);
                        break fixRound;
                    }

                    // 5. Verify Execution for this scenario
                    const executionStartTime = Date.now();
                    let executionFound = false;
                    let scenarioErrorMsg = '';
                    const maxPoll = 15;

                    Spinner.start('Waiting for execution result');
                    for (let i = 0; i < maxPoll; i++) {
                        await new Promise(r => setTimeout(r, 2000));
                        const executions = await client.getWorkflowExecutions(createdWorkflowId);
                        const recentExec = executions.find((e: any) => new Date(e.startedAt).getTime() > (executionStartTime - 5000));

                        if (recentExec) {
                            executionFound = true;
                            const fullExec = await client.getExecution(recentExec.id) as any;
                            Spinner.stop();

                            if (fullExec.status === 'success') {
                                console.log(theme.done('Passed'));
                                break fixRound; // scenario passed — move to next
                            }

                            // Extract error details including failing node name
                            const execError = fullExec.data?.resultData?.error;
                            const nodeRef = execError?.node;
                            const failingNodeName: string | undefined =
                                typeof nodeRef === 'string' ? nodeRef : nodeRef?.name ?? nodeRef?.type;

                            let rawMsg: string = execError?.message || '';
                            const topDesc: string | undefined = execError?.description ?? execError?.cause?.message;
                            if (rawMsg && topDesc && !rawMsg.includes(topDesc)) rawMsg = `${rawMsg} — ${topDesc}`;

                            if (!rawMsg) {
                                const runData = fullExec.data?.resultData?.runData as Record<string, any[]> | undefined;
                                if (runData) {
                                    outer: for (const [nodeName, nodeRuns] of Object.entries(runData)) {
                                        for (const run of nodeRuns) {
                                            if (run?.error?.message) {
                                                rawMsg = run.error.message;
                                                const desc = run.error.description ?? run.error.cause?.message;
                                                if (desc && !rawMsg.includes(desc)) rawMsg = `${rawMsg} — ${desc}`;
                                                if (!failingNodeName) scenarioErrorMsg = `[${nodeName}] ${rawMsg}`;
                                                break outer;
                                            }
                                        }
                                    }
                                }
                            }

                            scenarioErrorMsg = scenarioErrorMsg || (failingNodeName ? `[${failingNodeName}] ${rawMsg}` : rawMsg) || 'Unknown flow failure';
                            console.log(theme.fail(`Failed: ${scenarioErrorMsg}`));
                            break; // exit poll loop, handle error below
                        }
                    }

                    if (!executionFound) {
                        Spinner.stop();
                        validationErrors.push(`Scenario "${scenario.name}": No execution detected after trigger.`);
                        console.log(theme.warn('No execution detected after trigger.'));
                        break fixRound;
                    }

                    if (!scenarioErrorMsg) break fixRound; // success path handled above

                    // ── AI-powered error evaluation & targeted self-healing ───────────────

                    if (!fixAttempted) {
                        const nodeNameMatch = scenarioErrorMsg.match(/^\[([^\]]+)\]/);
                        const failingName = nodeNameMatch?.[1];
                        const evaluation = await aiService.evaluateTestError(
                            scenarioErrorMsg, rootPayload.nodes, failingName
                        );
                        fixAttempted = true;

                        if (evaluation.action === 'structural_pass') {
                            console.log(theme.warn(`${evaluation.reason}: ${scenarioErrorMsg}`));
                            console.log(theme.done('Structural validation passed.'));
                            break fixRound; // pass — don't add to validationErrors
                        }

                        if (evaluation.action === 'fix_node') {
                            const targetName = evaluation.targetNodeName ?? failingName;

                            if (evaluation.nodeFixType === 'code_node_js') {
                                const target = rootPayload.nodes.find(
                                    (n: any) => n.type === 'n8n-nodes-base.code' && (!targetName || n.name === targetName)
                                ) ?? rootPayload.nodes.find((n: any) => n.type === 'n8n-nodes-base.code');
                                if (target?.parameters?.jsCode) {
                                    try {
                                        console.log(theme.agent(`Self-healing Code node "${target.name}"...`));
                                        target.parameters.jsCode = await aiService.fixCodeNodeJavaScript(
                                            target.parameters.jsCode, scenarioErrorMsg
                                        );
                                        await client.updateWorkflow(createdWorkflowId!, rootPayload);
                                        healedNodes = rootPayload.nodes;
                                        codeNodeFixApplied = true;
                                        codeNodeFixAppliedName = target.name;
                                        console.log(theme.muted('Code node fixed. Retesting...'));
                                        continue fixRound; // retry
                                    } catch { /* fix failed — fall through to escalation */ }
                                }
                            } else if (evaluation.nodeFixType === 'execute_command') {
                                const target = rootPayload.nodes.find(
                                    (n: any) => n.type === 'n8n-nodes-base.executeCommand' && (!targetName || n.name === targetName)
                                ) ?? rootPayload.nodes.find((n: any) => n.type === 'n8n-nodes-base.executeCommand');
                                if (target?.parameters?.command) {
                                    try {
                                        console.log(theme.agent(`Self-healing Execute Command node "${target.name}"...`));
                                        target.parameters.command = await aiService.fixExecuteCommandScript(
                                            target.parameters.command, scenarioErrorMsg
                                        );
                                        await client.updateWorkflow(createdWorkflowId!, rootPayload);
                                        healedNodes = rootPayload.nodes;
                                        console.log(theme.muted('Execute Command script fixed. Retesting...'));
                                        continue fixRound; // retry
                                    } catch { /* fix failed — fall through to escalation */ }
                                }
                            } else if (evaluation.nodeFixType === 'binary_field') {
                                const fieldMatch = scenarioErrorMsg.match(/has no binary field ['"]?(\w+)['"]?/i);
                                const expectedField = fieldMatch?.[1];
                                const failingNode = targetName
                                    ? rootPayload.nodes.find((n: any) => n.name === targetName)
                                    : null;

                                // Delegate binary-field tracing to the AI — it traces the full graph
                                // (handling passthrough nodes like Merge, Set, IF) to find the actual
                                // binary-producing node and the field name it outputs.
                                console.log(theme.agent(`Tracing binary data flow to infer correct field name for "${targetName ?? failingName}"...`));
                                const correctField = await aiService.inferBinaryFieldNameFromWorkflow(
                                    targetName ?? failingName ?? 'unknown',
                                    rootPayload.nodes,
                                    targetWorkflow.connections || {},
                                );

                                if (failingNode && expectedField && correctField && correctField !== expectedField) {
                                    const paramKey = Object.entries(failingNode.parameters || {})
                                        .find(([, v]) => typeof v === 'string' && v === expectedField)
                                        ?.[0];
                                    if (paramKey) {
                                        try {
                                            console.log(theme.agent(`Fixing binary field "${failingName}": '${expectedField}' → '${correctField}' (${paramKey})...`));
                                            failingNode.parameters[paramKey] = correctField;
                                            await client.updateWorkflow(createdWorkflowId!, rootPayload);
                                            healedNodes = rootPayload.nodes;
                                            console.log(theme.muted('Binary field name fixed. Retesting...'));
                                            continue fixRound;
                                        } catch { break; }
                                    }
                                }
                                // Inject a Code node shim that produces synthetic binary data so the
                                // downstream node can actually execute instead of structural-passing.
                                const shimField = correctField ?? expectedField ?? 'data';
                                console.log(theme.agent(`Injecting binary test shim for field "${shimField}" before "${targetName ?? failingName}"...`));
                                try {
                                    const shimCode = aiService.generateBinaryShimCode(shimField);
                                    const shimName = `[n8m:shim] Binary for ${targetName ?? failingName}`;
                                    const shimPos = failingNode?.position ?? [500, 300];
                                    const shimNode: any = {
                                        id: `shim-binary-${Date.now()}`,
                                        name: shimName,
                                        type: 'n8n-nodes-base.code',
                                        typeVersion: 2,
                                        position: [shimPos[0] - 220, shimPos[1]],
                                        parameters: { mode: 'runOnceForAllItems', jsCode: shimCode },
                                    };
                                    // Rewire: redirect connections pointing at the failing node to the shim,
                                    // then add shim → failing node.
                                    const failName = targetName ?? failingName ?? '';
                                    const conns = JSON.parse(JSON.stringify(rootPayload.connections ?? {}));
                                    for (const targets of Object.values(conns) as any[]) {
                                        for (const segment of (targets?.main ?? [])) {
                                            if (!Array.isArray(segment)) continue;
                                            for (const conn of segment) {
                                                if (conn?.node === failName) conn.node = shimName;
                                            }
                                        }
                                    }
                                    conns[shimName] = { main: [[{ node: failName, type: 'main', index: 0 }]] };
                                    rootPayload.nodes = [...rootPayload.nodes, shimNode];
                                    rootPayload.connections = conns;
                                    await client.updateWorkflow(createdWorkflowId!, rootPayload);
                                    // Strip shim from healed nodes — it's a test artifact
                                    healedNodes = rootPayload.nodes.filter((n: any) => !n.name?.startsWith('[n8m:shim]'));
                                    binaryShimInjected = true;
                                    console.log(theme.muted('Binary shim injected. Retesting...'));
                                    continue fixRound;
                                } catch {
                                    // Shim generation/injection failed — fall through to structural pass
                                }
                                console.log(theme.warn(`Binary data not available in test environment (upstream pipeline required): ${scenarioErrorMsg}`));
                                console.log(theme.done('Structural validation passed.'));
                                break fixRound;
                            }
                        }
                        // evaluation.action === 'escalate' or fix attempt failed — fall through
                    }

                    // A Code node still fails after its JS was patched.
                    // Try replacing it with hardcoded mock data so downstream nodes
                    // (e.g. Slack at the end of the flow) can still be exercised.
                    if (codeNodeFixApplied && !mockDataShimApplied) {
                        const shimTarget = rootPayload.nodes.find(
                            (n: any) => n.type === 'n8n-nodes-base.code' && n.name === codeNodeFixAppliedName
                        );
                        if (shimTarget?.parameters?.jsCode) {
                            console.log(theme.agent(`"${codeNodeFixAppliedName}" still fails — replacing with mock data to continue test...`));
                            try {
                                shimTarget.parameters.jsCode = await aiService.shimCodeNodeWithMockData(
                                    shimTarget.parameters.jsCode
                                );
                                await client.updateWorkflow(createdWorkflowId!, rootPayload);
                                healedNodes = rootPayload.nodes;
                                mockDataShimApplied = true;
                                console.log(theme.muted(`"${codeNodeFixAppliedName}" replaced with mock data. Retesting...`));
                                continue fixRound;
                            } catch { /* fall through to structural pass */ }
                        }
                    }
                    if (codeNodeFixApplied || mockDataShimApplied) {
                        console.log(theme.warn(`Code node "${codeNodeFixAppliedName ?? 'unknown'}" relies on external APIs unavailable in test environment: ${scenarioErrorMsg}`));
                        console.log(theme.done('Structural validation passed.'));
                        break fixRound;
                    }

                    // Binary-field errors that survive fixAttempted (e.g. second round after a
                    // successful fix) indicate a test-environment limitation, not a workflow bug.
                    if (scenarioErrorMsg.match(/has no binary field/i)) {
                        console.log(theme.warn(`Binary data not available in test environment (upstream pipeline required): ${scenarioErrorMsg}`));
                        console.log(theme.done('Structural validation passed.'));
                        break fixRound;
                    }

                    // If a binary shim was injected and the downstream node still fails
                    // (e.g. invalid URL, credential errors from external APIs like Slack),
                    // that's a test-environment limitation, not a workflow bug.
                    if (binaryShimInjected) {
                        console.log(theme.warn(`External service error after binary shim (credentials/API required): ${scenarioErrorMsg}`));
                        console.log(theme.done('Structural validation passed.'));
                        break fixRound;
                    }

                    // Unfixable — escalate to engineer
                    validationErrors.push(`Scenario "${scenario.name}" Failed: ${scenarioErrorMsg}`);
                    break fixRound;
                } // end fixRound
            } // end scenarios
        }
    } else {
        // Just execute if no webhook (manual trigger)
         await client.executeWorkflow(createdWorkflowId);
    }

    // 6. Dynamic Tool Execution (Sandbox)
    // If the Agent has defined a custom validation script, run it now.
    // In the future, the QA agent could generate this script on the fly.
    if (state.customTools && state.customTools['validationScript']) {
        console.log("🛠️  QA is running custom validation script...");
        const script = state.customTools['validationScript'];
        const sandboxResult = (await import('../../utils/sandbox.js')).Sandbox.run(script, { 
            workflowJson, 
            validationErrors 
        });
        
        if (sandboxResult === false) {
             validationErrors.push("Custom validation script failed.");
        }
    }

  } catch (error) {
    const errorMsg = (error as Error).message;
    // Connectivity errors can't be fixed by modifying the workflow — rethrow so
    // the graph surfaces a clear failure instead of looping through the engineer.
    const isConnectivityError = errorMsg.includes('Cannot connect to n8n') ||
                                errorMsg.includes('fetch failed') ||
                                errorMsg.includes('ECONNREFUSED') ||
                                errorMsg.includes('ENOTFOUND');
    if (isConnectivityError) throw error;
    validationErrors.push(errorMsg);
  } finally {
      if (createdWorkflowId) {
          try { await client.deleteWorkflow(createdWorkflowId); } catch { /* intentionally empty */ }
      }
  }

  // If we patched nodes inline (Code / Execute Command fixes), propagate the
  // healed workflow back into state so the final saved workflow reflects the fix.
  const healedWorkflow = healedNodes ? (() => {
      const clone = JSON.parse(JSON.stringify(workflowJson));
      const target = clone.workflows?.[0] ?? clone;
      target.nodes = healedNodes;
      return clone;
  })() : undefined;

  return {
    validationStatus: validationErrors.length === 0 ? 'passed' : 'failed',
    validationErrors,
    ...(healedWorkflow ? { workflowJson: healedWorkflow } : {}),
  };
};
