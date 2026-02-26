import { AIService } from "../../services/ai.service.js";
import { TeamState } from "../state.js";
import { ConfigManager } from "../../utils/config.js";
import { N8nClient } from "../../utils/n8nClient.js";
import { theme } from "../../utils/theme.js";

export const qaNode = async (state: typeof TeamState.State) => {
  const aiService = AIService.getInstance();
  const workflowJson = state.workflowJson;

  if (!workflowJson) {
    throw new Error("No workflow JSON found in state to test.");
  }

  // 1. Load Credentials
  const config = await ConfigManager.load();
  const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
  const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

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
    const rootPayload = {
      nodes: targetWorkflow.nodes,
      connections: targetWorkflow.connections,
      settings: targetWorkflow.settings || {},
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
    console.log(theme.agent(`Deploying ephemeral root: ${rootPayload.name}...`));
    const result = await client.createWorkflow(rootPayload.name, rootPayload);
    createdWorkflowId = result.id;

    // 4. Generate Mock Data
    const webhookNode = rootPayload.nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook');
    let triggerSuccess = false;

    if (webhookNode) {
        const path = webhookNode.parameters?.path;
        if (path) {
            // Activate for webhook testing
            await client.activateWorkflow(createdWorkflowId);

            const nodeNames = targetWorkflow.nodes.map((n: any) => n.name).join(', ');
            const context = `Workflow Name: "${targetWorkflow.name}"
            Nodes: ${nodeNames}
            Goal: "${state.userGoal}"
            Generate a SINGLE JSON object payload that effectively tests this workflow.`;

            const mockPayload = await aiService.generateMockData(context);
            
            
            const baseUrl = new URL(n8nUrl).origin;
            const webhookUrl = `${baseUrl}/webhook/${path}`;
            
            const response = await fetch(webhookUrl, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mockPayload)
            });
            
            if (response.ok) {
                triggerSuccess = true;
            } else {
                throw new Error(`Webhook trigger failed with status ${response.status}`);
            }
        }
    } else {
        // Just execute if no webhook (manual trigger)
         await client.executeWorkflow(createdWorkflowId);
         triggerSuccess = true;
    }

    // 5. Verify Execution
    // Wait for execution to appear
    if (triggerSuccess) {
         const executionStartTime = Date.now();
         let executionFound = false;
         const maxPoll = 20; // shorter poll for agent
         
         for (let i = 0; i < maxPoll; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const executions = await client.getWorkflowExecutions(createdWorkflowId);
            const recentExec = executions.find((e: any) => new Date(e.startedAt).getTime() > (executionStartTime - 5000));

            if (recentExec) {
                executionFound = true;
                const fullExec = await client.getExecution(recentExec.id) as any;
                
                if (fullExec.status === 'success') {
                    return {
                        validationStatus: 'passed',
                        validationErrors: [],
                    };
                } else {
                     const errorMsg = fullExec.data?.resultData?.error?.message || "Unknown flow failure";
                     validationErrors.push(`Execution Failed: ${errorMsg}`);
                     console.log(theme.error(`Execution Failed: ${errorMsg}`));
                     break;
                }
            }
         }
         
         if (!executionFound) {
             validationErrors.push("No execution detected after trigger.");
         }
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
    console.error(theme.error(`QA Node Error: ${errorMsg}`));
    validationErrors.push(errorMsg);
  } finally {
      // Cleanup
      if (createdWorkflowId) {
          try {
              await client.deleteWorkflow(createdWorkflowId);
              console.log(theme.info(`Purged temporary workflow ${createdWorkflowId}`));
          } catch { /* intentionally empty */ }
      }
  }

  return {
    validationStatus: 'failed',
    validationErrors,
  };
};
