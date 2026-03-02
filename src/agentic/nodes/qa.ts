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

    // Strip credentials from all nodes — n8n 2.x refuses to activate ("publish")
    // a workflow that references credentials that don't exist on the instance.
    // Structural validation can still run; only live execution of credentialed
    // nodes will be skipped/fail, which is expected for an ephemeral test.
    const strippedNodes = (targetWorkflow.nodes as any[])
      .filter((node: any) => node != null)
      .map((node: any) => {
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
                console.log(theme.agent(`Testing: ${scenario.name}`));
                const response = await fetch(webhookUrl, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(scenario.payload)
                });
                
                if (!response.ok) {
                    validationErrors.push(`Scenario "${scenario.name}" failed to trigger: ${response.status}`);
                    continue;
                }

                // 5. Verify Execution for this scenario
                const executionStartTime = Date.now();
                let executionFound = false;
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
                        } else {
                            let errorMsg: string = fullExec.data?.resultData?.error?.message;
                            if (!errorMsg) {
                                const runData = fullExec.data?.resultData?.runData as Record<string, any[]> | undefined;
                                if (runData) {
                                    outer: for (const [, nodeRuns] of Object.entries(runData)) {
                                        for (const run of nodeRuns) {
                                            if (run?.error?.message) {
                                                errorMsg = run.error.message;
                                                break outer;
                                            }
                                        }
                                    }
                                }
                            }
                            errorMsg = errorMsg || 'Unknown flow failure';
                            validationErrors.push(`Scenario "${scenario.name}" Failed: ${errorMsg}`);
                            console.log(theme.fail(`Failed: ${errorMsg}`));
                        }
                        break;
                    }
                }

                if (!executionFound) {
                    Spinner.stop();
                    validationErrors.push(`Scenario "${scenario.name}": No execution detected after trigger.`);
                    console.log(theme.warn('No execution detected after trigger.'));
                }
            }
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

  return {
    validationStatus: validationErrors.length === 0 ? 'passed' : 'failed',
    validationErrors,
  };
};
