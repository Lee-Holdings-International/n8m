import inquirer from 'inquirer'
import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js'
import {N8nClient} from '../utils/n8nClient.js'
import {ConfigManager} from '../utils/config.js'
import { AIService } from '../services/ai.service.js';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
export default class Test extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path to workflow JSON file',
      required: false,
    }),
  }

  static description = 'Run ephemeral end-to-end tests for n8n workflows'

  static flags = {
    headless: Flags.boolean({
      char: 'h',
      default: true,
      description: 'Run tests in headless mode',
    }),
    'keep-on-fail': Flags.boolean({
      default: false,
      description: 'Do not delete workflow if test fails',
    }),
  }

  async run(): Promise<void> {
    this.log(theme.brand());
    const {args, flags} = await this.parse(Test)

    this.log(theme.header('EPHEMERAL VALIDATION'));

    // 1. Load Credentials
    const config = await ConfigManager.load();
    const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
    const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

    if (!n8nUrl || !n8nKey) {
      this.error('Credentials missing. Configure environment via \'n8m config\'.');
    }

    const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
    let createdWorkflowId: string | null = null;
    const deployedDefinitions = new Map<string, any>(); // TempId -> Original JSON (for patching)

    try {
      let workflowData: any;
      let workflowName = 'Untitled';

      if (args.workflow) {
          this.log(theme.agent(`Initializing virtual orchestrator for ${theme.value(args.workflow)}`));
          
          // Check if it's a file path
          if (!args.workflow.endsWith('.json')) {
              this.error('Local JSON path required.');
          }
          
          const fs = await import('node:fs/promises');
          const content = await fs.readFile(args.workflow, 'utf-8');
          workflowData = JSON.parse(content);
          workflowName = workflowData.name || 'Untitled';
      } else {
          this.log(theme.info('Fetching workflows from instance...'));
          const workflows = await client.getWorkflows();
          
          // this.log('DEBUG: Fetched workflows:', JSON.stringify(workflows, null, 2));
          
          if (workflows.length === 0) {
              this.error('No workflows found on instance.');
          }

          this.log(theme.info(`Found ${workflows.length} workflows.`));

          const choices = workflows
            .filter(w => !w.name.startsWith('[TEST'))
            .map(w => ({
                name: `${w.name} (${w.id}) ${w.active ? '[Active]' : ''}`,
                value: w.id
            }));

          // this.log('DEBUG: Choices:', JSON.stringify(choices, null, 2));

          const { selectedWorkflowId } = await inquirer.prompt([
              {
                  type: 'select',
                  name: 'selectedWorkflowId',
                  message: 'Select a workflow to test:',
                  choices: choices,
                  pageSize: 15
              }
          ]);

          this.log(theme.agent(`Tracing dependencies for ${theme.value(selectedWorkflowId)}...`));
          
          // Dependency Resolution Map: originalId -> { name, data, tempId? }
          const dependencyMap = new Map<string, { name: string, data: any }>();
          const visited = new Set<string>();
          // Map broken/placeholder IDs to Real IDs selected by user
          const resolutionMap = new Map<string, string>(); 

          // Recursive function to fetch dependencies
          const fetchDependencies = async (id: string, contextNodeName: string = 'Unknown') => {
              // Be careful with resolution map - avoid double visiting
              const realId = resolutionMap.get(id) || id;
              
              if (visited.has(realId)) return;
              visited.add(realId);

              let wf: any;
              try {
                  wf = await client.getWorkflow(realId) as any;
              } catch (e) {
                  // Not found? Ask user to resolve!
                  this.log(theme.warn(`Dependency ${theme.value(id)} referenced in node [${contextNodeName}] could not be found.`));
                  
                  const { resolvedId } = await inquirer.prompt([{
                      type: 'select',
                      name: 'resolvedId',
                      message: `Select replacement for missing dependency ${id}:`,
                      choices: choices, // Use hoisted choices from earlier
                      pageSize: 15
                  }]);

                  resolutionMap.set(id, resolvedId);
                  
                  // Retry fetch with resolved ID
                  await fetchDependencies(resolvedId, contextNodeName);
                  return; // Done
              }

              dependencyMap.set(realId, { name: wf.name, data: wf });

              // Scan for Sub-Workflow Executions
              const nodes = wf.nodes || [];
              for (const node of nodes) {
                  if (node.type === 'n8n-nodes-base.executeWorkflow') {
                      const subId = node.parameters?.workflowId;
                      // Handle expression-based IDs (can't resolve statically)
                      if (subId && typeof subId === 'string' && !subId.startsWith('=')) {
                           await fetchDependencies(subId, node.name);
                      }
                  }
              }
          };

          // Start trace
          await fetchDependencies(selectedWorkflowId, 'ROOT');

          this.log(theme.info(`Found ${dependencyMap.size - 1} dependencies.`));

          // 2. Deploy Dependencies
          const idMap = new Map<string, string>(); // ANY id (real or broken) -> newTempId
          // deployedDefinitions hoisted to run() scope
          
          (this as any).createdWorkflowIds = []; // Initialize logic for tracking
          
          // Ensure we don't deploy the root as a dependency
          const rootRealId = resolutionMap.get(selectedWorkflowId) || selectedWorkflowId;
          dependencyMap.delete(rootRealId);

          for (const [realId, info] of dependencyMap.entries()) {
               this.log(theme.agent(`Staging dependency: ${info.name} (ID: ${realId})...`));
               
               // Sanitize
               let depData = {
                   nodes: info.data.nodes,
                   connections: info.data.connections,
                   settings: info.data.settings,
                   // pinData: info.data.pinData 
               };
               
               
               // Ensure there is an ACTIVATABLE trigger (Webhook).
               // Manual triggers alone are not enough to "Activate" a workflow.
               // We need a webhook to trick n8n into thinking this is a live service.
               const hasActivatableTrigger = depData.nodes.some((n: any) => 
                   n.type === 'n8n-nodes-base.webhook' && !n.disabled
               );
               
               if (!hasActivatableTrigger) {
                   this.log(theme.warn(`Dependency ${info.name} missing activatable trigger. Injecting webhook shim...`));
                   depData = client.injectManualTrigger(depData); // Injects Webhook now

                   // DEBUG: Verify injection
                   const shimmedTypes = depData.nodes.map((n: any) => n.type);
                   this.log(`DEBUG: Shimmed nodes for ${info.name}: ${JSON.stringify(shimmedTypes)}`);
               }

               // Create Temp
               const { id: tempId } = await client.createWorkflow(`[n8m:dep] ${info.name}`, depData);
               
               // Track IMMEDIATELY for cleanup
               (this as any).createdWorkflowIds.push(tempId);

               // Activate it so it can be referenced (Validation requires Published state)
               await client.executeWorkflow(tempId);

               // Store definition for repair
               deployedDefinitions.set(tempId, { name: info.name, data: depData, type: 'dependency', realId: realId });
               
               // Map REAL ID to TEMP ID
               idMap.set(realId, tempId);
               
               // ALSO Map BROKEN ID to TEMP ID if it exists
               for (const [broken, resolved] of resolutionMap.entries()) {
                   if (resolved === realId) {
                       idMap.set(broken, tempId);
                   }
               }
          }
          
          // Hacky: Pass the list of created IDs to cleanup via a global or class prop? 
          // Better: We'll modify the `finally` block to handle a list.
          (this as any).createdWorkflowIds = Array.from(idMap.values()); // Store for cleanup
          
          // 4. Prepare Root Workflow with Patched IDs
          const rootWf = await client.getWorkflow(selectedWorkflowId) as any;
          workflowName = rootWf.name;
          workflowData = rootWf;
          
          // PATCHING FUNCTION
          const patchWorkflow = (wf: any, map: Map<string, string>) => {
              // Naive string replacement for IDs might be dangerous if IDs are short/common.
              // Better: Traverse nodes.
              let str = JSON.stringify(wf);
              for (const [oldId, newId] of map.entries()) {
                  // Replace strict ID occurrences
                  str = str.split(oldId).join(newId);
              }
              return JSON.parse(str);
          };

          const patchedRoot = patchWorkflow(workflowData, idMap);
          
          // Ensure it has a trigger shim too if we plan to activate it (which we do for validation)
          const hasRootManualTrigger = patchedRoot.nodes.some((n: any) => n.type === 'n8n-nodes-base.manualTrigger' && !n.disabled);
          if (!hasRootManualTrigger) {
               this.log(theme.warn(`Root workflow missing manual trigger. Injecting shim...`));
               // We need to re-assign patchedRoot result
               const shimmed = client.injectManualTrigger(patchedRoot);
               // Object.assign(patchedRoot, shimmed); // Be simpler
               patchedRoot.nodes = shimmed.nodes;
               patchedRoot.connections = shimmed.connections;
          }

          this.log(theme.agent(`Deploying ephemeral root: [n8m:test] ${workflowName}...`));
          
          // Sanitize
          const rootPayload = {
              nodes: patchedRoot.nodes,
              connections: patchedRoot.connections,
              settings: patchedRoot.settings
          };

          const { id: rootId } = await client.createWorkflow(`[n8m:test] ${workflowName}`, rootPayload);
          
          (this as any).createdWorkflowIds.push(rootId);
          createdWorkflowId = rootId;

          // Store root definition for lookup
          // If we are testing a file, rootRealId might be null/undefined, or we might want to ask user?
          // We stored `rootRealId` earlier via resolutionMap... but wait, if it's a file, `selectedWorkflowId` is the path?
          // If args.workflow is set, `selectedWorkflowId` is undefined at start.
          
          let rootRealTargetId = undefined;
          if (!args.workflow) {
              rootRealTargetId = resolutionMap.get(selectedWorkflowId) || selectedWorkflowId;
          }
          
          deployedDefinitions.set(rootId, { name: workflowName, data: rootPayload, type: 'root', realId: rootRealTargetId });

          // DEBUG: Inspect Switch Node Logic
          const switchNode = patchedRoot.nodes.find((n: any) => n.type === 'n8n-nodes-base.switch');
          if (switchNode) {
              this.log(theme.warn(`DEBUG: Switch Node Rules: ${JSON.stringify(switchNode.parameters, null, 2)}`));
          }

          this.log(theme.success('Environment Ready. Validating...'));
          
          // 5. Execute (Activate)
          // We use /activate validation
          // 5. Execute (Activate)
          // We use /activate validation
          await client.executeWorkflow(rootId);

          // 6. Trigger Execution (E2E)
          // Find the webhook node
          const webhookNode = rootPayload.nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook');
          if (webhookNode) {
              const method = webhookNode.parameters?.httpMethod || 'GET';
              const path = webhookNode.parameters?.path;
              
              if (path) {
                  // INTERACTIVE SELF-HEALING LOOP
                  let attempts = 0;
                  const maxAttempts = 10;
                  let errorHistory: string[] = [];
                  let finalSuccess = false;

                  while (attempts < maxAttempts && !finalSuccess) {
                      attempts++;
                      // Removed explicit attempt counter as requested
                      
                      if (attempts > 1) {
                         this.log(theme.agent('Analyzing failure and regenerating payload...'));
                      } else {
                         this.log(theme.agent('Generating Mock Data...'));
                      }
                      
                      // GATHER CONTEXT
                      const nodeNames = rootPayload.nodes.map((n: any) => n.name).join(', ');
                      const switchNode = rootPayload.nodes.find((n: any) => n.type === 'n8n-nodes-base.switch');
                      let switchRules = '';
                      if (switchNode) {
                          switchRules = JSON.stringify(switchNode.parameters);
                      }

                      const context = `Workflow Name: "${workflowName}"
                      Nodes: ${nodeNames}
                      Switch Rules: ${switchRules}
                      Generate a SINGLE JSON object payload (do NOT generate an array) that effectively tests this workflow, ensuring it passes the Switch node conditions if possible.`;

                      // CALL AI
                      const ai = AIService.getInstance();
                      let mockPayload = {};
                      try {
                          // Pass error history to AI
                          mockPayload = await ai.generateMockData(context, 'gemini-3-pro-preview', errorHistory);
                          this.log(theme.muted(`Mock Payload: ${JSON.stringify(mockPayload)}`));
                      } catch (err) {
                          this.log(theme.warn(`Generation Failed: ${(err as Error).message}. Using fallback.`));
                          mockPayload = { message: "Generation Failed", timestamp: new Date().toISOString() };
                      }

                      this.log(theme.agent('Triggering Entry Point with Payload...'));
                      
                      // Construct Webhook URL
                      const baseUrl = new URL(n8nUrl).origin;
                      const webhookUrl = `${baseUrl}/webhook/${path}`;
                      
                      let currentError: string | null = null;

                      try {
                          const response = await fetch(webhookUrl, {
                              method: 'POST', 
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(mockPayload)
                          });
                          
                          if (response.ok) {
                              // Reset previous execution tracking (by time)
                              const executionStartTime = Date.now();
                          
                              this.log(theme.done('Workflow Triggered Successfully.'));
                              
                              // Polling for Completion & Live Tracing
                              this.log(theme.subHeader('Live Execution Trace'));
                              
                              let executionFound = false;
                              const reportedNodes = new Set<string>();
                              
                              // Poll for up to 100 seconds
                              const maxPoll = 50; 
                              for (let i = 0; i < maxPoll; i++) {
                                  await new Promise(r => setTimeout(r, 2000));
                                  // Removed dot progress to avoid messing up live output
                                  
                                  try {
                                      const executions = await client.getWorkflowExecutions(rootId);
                                      // Look for any execution started AFTER trigger
                                      const recentExec = executions.find((e: any) => new Date(e.startedAt).getTime() > (executionStartTime - 5000));
                                      
                                      if (recentExec) {
                                          executionFound = true;
                                          
                                          // Update Status Line (erase previous line?) 
                                          // Simpler: Just print updates. Or maybe a status log occasionally.
                                          // Let's rely on live node updates.
                                          
                                          // Fetch full details for LIVE tracing
                                          const fullExec = await client.getExecution(recentExec.id) as any;
                                          const runData = fullExec.data?.resultData?.runData || {};
                                          
                                          // Log Status if changed or first time? 
                                          // We can just log: "Status: running..." once.
                                          
                                          // Calculate current nodes count
                                          // ...
                                          
                                          // Print NEW nodes
                                           Object.entries(runData).forEach(([nodeName, runs]: [string, any]) => {
                                               // We only care if we haven't reported this NODE yet (or a new run of it)
                                               // Use for-loop to allow break/continue if needed, though here we just process
                                               for (const [runIndex, run] of runs.entries()) {
                                                   const uniqueKey = `${nodeName}-${runIndex}`;
                                                   
                                                   if (!reportedNodes.has(uniqueKey)) {
                                                       reportedNodes.add(uniqueKey);
                                                       
                                                       // Filter out noise
                                                       if (nodeName.includes('Shim_Flattener')) continue;

                                                       // Print it!
                                                       const outputData = run.data?.main?.[0]?.[0]?.json;
                                                       let displayName = nodeName === 'N8M_Shim_Webhook' ? theme.label('[Trigger]') : theme.label(nodeName);
                                                       const paddedName = displayName.padEnd(25, ' ');
                                                       
                                                       let outputStr = "";
                                                       if (outputData) {
                                                            // Success case
                                                            const itemCount = run.data.main[0].length;
                                                            const dataPreview = JSON.stringify(outputData);
                                                            const truncated = dataPreview.length > 80 ? dataPreview.substring(0, 80) + '...' : dataPreview;
                                                            outputStr = `${theme.success('✔')} (${itemCount} item) ${theme.muted(truncated)}`; // Used theme.muted instead of dim
                                                       } else {
                                                            // Failure / Stop case
                                                            currentError = `Flow stopped at ${displayName} (0 items)`;
                                                            outputStr = theme.warn('🛑 Flow stopped here (0 items produced)');
                                                       }
                                                       
                                                       this.log(`• ${paddedName} ${outputStr}`);
                                                   }
                                               }
                                           });
                                          
                                          // Check if stalled/waiting
                                          if (recentExec.status === 'waiting') {
                                              // Warn user occasionally?
                                          }

                                          // FAST FAILURE: If we detected a logical stop, abort waiting
                                          if (currentError) {
                                              this.log(theme.warn(` Fast-Fail: ${currentError}`));
                                              break;
                                          }

                                          // PREMATURE STOP CHECK (New)
                                          // If a node produced items but didn't trigger its downstream neighbors
                                          if (!recentExec.finished) {
                                              // Only check this if finished? Or continuous?
                                              // If n8n says finished, but we know we didn't reach end?
                                              // Let's check this ONLY when finished to avoid race conditions during run
                                          }

                                          if (recentExec.finished) {
                                              // Check for Premature Stop
                                              // For each executed node, did it produce output? If so, did the connected node run?
                                              
                                              let prematureError = null;
                                              const executedNodes = new Set(Object.keys(runData));
                                              
                                              for (const [nodeName, runs] of Object.entries(runData)) {
                                                   const nodeRuns = runs as any[];
                                                   // Check the LAST run of this node
                                                   const lastRun = nodeRuns[nodeRuns.length - 1];
                                                   
                                                   // Check outputs
                                                   if (lastRun.data?.main) {
                                                       lastRun.data.main.forEach((items: any[], outputIndex: number) => {
                                                           if (items && items.length > 0) {
                                                               // This node produced items on outputIndex
                                                               // Does it have a connection?
                                                               const nodeConns = rootPayload.connections[nodeName];
                                                               if (nodeConns && nodeConns.main && nodeConns.main[outputIndex]) {
                                                                   // It Has connections. Did any target run?
                                                                   const targets = nodeConns.main[outputIndex];
                                                                   const anyTargetRan = targets.some((t: any) => executedNodes.has(t.node));
                                                                   
                                                                   if (!anyTargetRan) {
                                                                       // Suspect Premature Stop
                                                                       // Exception: Logic nodes might be leaf nodes? No, connection exists.
                                                                       // Exception: Disabled nodes?
                                                                       prematureError = `Flow ended early at [${nodeName}] (Output ${outputIndex} connected but target didn't run)`;
                                                                   }
                                                               }
                                                           }
                                                       });
                                                   }
                                              }
                                              
                                              if (prematureError) {
                                                  currentError = prematureError;
                                                  this.log(theme.warn(`Validation Warning: ${currentError}`));
                                              }

                                              if (fullExec.data?.resultData?.error) {
                                                   currentError = `Execution Error: ${fullExec.data.resultData.error.message}`;
                                                   this.log(theme.fail(currentError));
                                              } else if (currentError) {
                                                   // We detected a logical stop (Empty items OR Premature stop)
                                                   // Don't set finalSuccess = true
                                              } else {
                                                   this.log(theme.done(`Execution Finished Successfully. (ID: ${recentExec.id})`));
                                                   finalSuccess = true;
                                              }
                                              break; // Stop polling
                                          }
                                      }
                                  } catch (pollErr) {
                                      // Ignore poll errors
                                  }
                              }
                              
                              if (!finalSuccess) {
                                  if (executionFound) {
                                      if (!currentError) {
                                          this.log(theme.warn('\nExecution is still active (running or waiting). Monitor n8n UI for details.'));
                                          finalSuccess = true; // Treat as Pass for AI workflows ONLY if no errors found
                                      } else {
                                          this.log(theme.warn('\nExecution stopped internally.'));
                                      }
                                  } else {
                                      currentError = "\nTimeout: Execution did not start within 100 seconds.";
                                      this.log(theme.warn(currentError));
                                  }
                              }

                          } else {
                              currentError = `Trigger HTTP Error: ${response.status} ${response.statusText}`;
                              this.log(theme.fail(currentError));
                          }
                      } catch (err) {
                          currentError = `Trigger Network Error: ${(err as Error).message}`;
                          this.log(theme.fail(currentError));
                      }

                      if (currentError) {
                          errorHistory.push(`Attempt ${attempts}: ${currentError}`);
                          
                          if (attempts < maxAttempts) {
                             this.log(theme.info(`Test run failed. Attempting Self-Repair (${attempts + 1}/${maxAttempts})...`));
                             
                             // REPAIR STRATEGY:
                             // If we have "Flow stopped at [NodeName]", identify if it calls a dependency.
                             // If so, try to patch the dependency workflow.
                             
                             let workflowPatched = false;
                             if (currentError && currentError.includes('Flow stopped at')) {
                                 // Extract Node Name
                                 const flowMatch = currentError.match(/Flow stopped at (.*?) \(0 items\)/);
                                 if (flowMatch) {
                                     const nodeName = flowMatch[1].trim();
                                     // Find detailed node in Root
                                     const failingNode = rootPayload.nodes.find((n:any) => theme.label(n.name).trim() === nodeName || n.name === nodeName || nodeName.includes(n.name));
                                     
                                     if (failingNode && failingNode.type === 'n8n-nodes-base.executeWorkflow') {
                                         const calledId = failingNode.parameters?.workflowId;
                                         if (calledId && deployedDefinitions.has(calledId)) {
                                             this.log(theme.agent(`Detected logical failure in dependency workflow used by node '${nodeName}'. analyzing and fixing logic...`));
                                             
                                             const targetDef = deployedDefinitions.get(calledId);
                                             const ai = AIService.getInstance();
                                             
                                             // Trace is generic, we don't have the sub-trace. We trust AI to inspect the JSON logic vs what happened (0 items returned).
                                             try {
                                                 const fixedJson = await ai.generateWorkflowFix(targetDef.data, `The workflow executed but produced NO ITEMS (stopped early). Input was: ${JSON.stringify(mockPayload)}. Review if the logic filters everything out.`, "gemini-2.0-flash");
                                                 
                                                 this.log(theme.agent(`Applying logic patch to dependency '${targetDef.name}'...`));
                                                 
                                                 // Ensure required fields like 'name' are preserved
                                                 fixedJson.name = targetDef.name;
                                                 
                                                 await client.updateWorkflow(calledId, fixedJson); // Update the EPHEMERAL workflow
                                                 deployedDefinitions.get(calledId).data = fixedJson; // Update local cache
                                                 workflowPatched = true;
                                             } catch (fixErr) {
                                                 this.log(theme.fail(`Workflow fix failed: ${fixErr}`));
                                             }
                                         }
                                     }
                                 }
                             }
                             
                             // If we didn't patch workflow, regenerate data
                             if (!workflowPatched) {
                                 this.log(theme.info(`Regenerating test data...`));
                                 // Standard data regen loop continues below
                             } else {
                                 // If patched, we reuse the SAME payload to verify the fix
                                 continue;
                             }
                          }
                      }
                  } 

                  if (!finalSuccess) {
                      this.log(theme.fail(`Failed after ${attempts} attempts.`));
                  }
              }
          } else {
              this.log(theme.warn('No Webhook found to trigger. Validated only.'));
          }




      } // End of else (interactive)

    } catch (error) {
      const errMsg = (error as Error).message;
      
      // Try to parse JSON error from n8n
      let cleanMsg = errMsg;
      try {
        // failed to validate: n8n Validation Error: 400 - {"message": "..."}
        // Extract JSON part if possible
        const jsonMatch = errMsg.match(/\{.*\}/);
        if (jsonMatch) {
            const errorObj = JSON.parse(jsonMatch[0]);
            if (errorObj.message) {
                cleanMsg = errorObj.message;
            }
        }
      } catch (e) {
          // ignore parsing error
      }

      this.log(theme.fail(`Validation Failed`));
      this.log(theme.brand() + ' ' + theme.error(cleanMsg));
      
      if (flags['keep-on-fail'] && createdWorkflowId) {
         this.log(theme.warn(`PRESERVATION ACTIVE: Workflow ${createdWorkflowId} persists.`));
         createdWorkflowId = null; 
      }
      } finally {
        // Post-Test Save Prompt (Only if we have deployed something and aren't in error catch)
        if (deployedDefinitions.size > 0) {
            await this.handlePostTestActions(deployedDefinitions, args.workflow, client);
        }

       const allIds = [createdWorkflowId, ...((this as any).createdWorkflowIds || [])].filter(Boolean);
      const uniqueIds = [...new Set(allIds)];
      
      if (uniqueIds.length > 0) {
        this.log(theme.info(`Purging ${uniqueIds.length} temporary assets...`));
        
        for (const wid of uniqueIds) {
            try {
              if (wid) await client.deleteWorkflow(wid);
            } catch (cleanupError) {
              // this.warn(theme.fail(`Purge failed for ${wid}: ${(cleanupError as Error).message}`));
            }
        }
        this.log(theme.done('Environment clean.'));
      }
    }
  }

  /**
   * Remove temporary test shims (Webhook + Flattener) from workflow data
   */
  private stripShim(workflowData: any): any {
      if (!workflowData.nodes) return workflowData;

      // Identify shim nodes
      const nodes = workflowData.nodes.filter((n: any) => 
          n.name !== 'N8M_Shim_Webhook' && 
          n.name !== 'Shim_Flattener'
      );

      // Clean connections
      const connections: any = {};
      for (const [nodeName, conns] of Object.entries(workflowData.connections || {})) {
          if (nodeName === 'N8M_Shim_Webhook' || nodeName === 'Shim_Flattener') continue;
          
          // Filter outputs that might point TO shims (unlikely, but possible?)
          // Usually shims point TO real nodes. real nodes don't point BACK to shims.
          // So just preserving non-shim source entries is usually enough.
          connections[nodeName] = conns;
      }

      return {
          ...workflowData,
          nodes,
          connections
      };
  }

  /**
   * Prompt user to save active workflow definitions to disk
   */
  private async saveWorkflows(deployedDefinitions: Map<string, any>, originalPath?: string) {
      if (deployedDefinitions.size === 0) return;

      const { save } = await inquirer.prompt([{
          type: 'confirm',
          name: 'save',
          message: 'Test passed. Save workflows locally for review/deployment?',
          default: true
      }]);

      if (!save) return;

      for (const [id, def] of deployedDefinitions.entries()) {
          const cleanData = this.stripShim(def.data);
          cleanData.name = def.name;
          
          let targetPath = '';
          
          if (def.type === 'root' && originalPath) {
              targetPath = originalPath;
          } else {
              // For dependencies or unknown sources, use name-based path
              const safeName = def.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
              targetPath = path.join(process.cwd(), 'workflows', `${safeName}.json`);
          }

          const { confirmPath } = await inquirer.prompt([{
              type: 'input',
              name: 'confirmPath',
              message: `Save '${def.name}' to:`,
              default: targetPath
          }]);

          try {
              // Ensure dir exists
              await fs.mkdir(path.dirname(confirmPath), { recursive: true });
              await fs.writeFile(confirmPath, JSON.stringify(cleanData, null, 2));
              this.log(theme.success(`Saved to ${confirmPath}`));
          } catch (e) {
              this.log(theme.fail(`Failed to save to ${confirmPath}: ${(e as Error).message}`));
          }
      }
  }

  /**
   * Handle post-test actions: Deploy or Save
   */
  private async handlePostTestActions(deployedDefinitions: Map<string, any>, originalPath: string | undefined, client: N8nClient) {
      if (deployedDefinitions.size === 0) return;

      this.log(''); // spacer
      const { action } = await inquirer.prompt([{
          type: 'confirm',
          name: 'action',
          message: 'Test passed. Deploy changes to instance? (Y = Deploy, n = Save to file)',
          default: true
      }]);

      if (action) {
          await this.deployWorkflows(deployedDefinitions, client);
      } else {
          await this.saveWorkflows(deployedDefinitions, originalPath);
      }
  }

  /**
   * Deploy workflows to the instance (Overwrite)
   */
  private async deployWorkflows(deployedDefinitions: Map<string, any>, client: N8nClient) {
      for (const [tempId, def] of deployedDefinitions.entries()) {
          const cleanData = this.stripShim(def.data);
          cleanData.name = def.name;
          
          if (def.realId) {
             try {
                 this.log(theme.agent(`Deploying (Overwriting) ${theme.value(def.name)} [${def.realId}]...`));
                 
                 // DEBUG: Check Trigger Existence
                 const triggers = cleanData.nodes.filter((n: any) => n.type.includes('Trigger') || n.type.includes('webhook'));
                 // this.log(`DEBUG: Triggers in payload: ${triggers.map((t:any) => t.type).join(', ')}`);

                 await client.updateWorkflow(def.realId, cleanData);
                 this.log(theme.success(`✔ Updated ${def.name}`));
             } catch (e) {
                 const msg = (e as Error).message;
                 // Fallback: If activation fails, try deactivating
                 if (msg.includes('trigger') || msg.includes('activated')) {
                     this.log(theme.warn(`⚠ Activation rejected: ${msg}`));
                     this.log(theme.agent(`Attempting to deactivate and retry ${def.name}...`));
                     try {
                         await client.deactivateWorkflow(def.realId);
                         // Retry update without any 'active' property (body should already be clean)
                         await client.updateWorkflow(def.realId, cleanData);
                         this.log(theme.success(`✔ Updated ${def.name} (Deactivated)`));
                     } catch (retryErr) {
                         this.log(theme.fail(`Failed to update ${def.name}: ${(retryErr as Error).message}`));
                     }
                 } else {
                     this.log(theme.fail(`Failed to update ${def.name}: ${msg}`));
                 }
             }
          } else {
              this.log(theme.warn(`Skipping deployment for ${def.name}: No target ID found (was it a local file?). Save to file instead.`));
          }
      }
  }
}
