import inquirer from 'inquirer'
import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js'
import {N8nClient} from '../utils/n8nClient.js'
import {ConfigManager} from '../utils/config.js'
import { AIService } from '../services/ai.service.js';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

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
    'no-brand': Flags.boolean({
      default: false,
      hidden: true,
      description: 'Suppress branding header',
    }),
    'validate-only': Flags.boolean({
      default: false,
      hidden: true,
      description: 'Execute test but do not prompt for deploy/save actions',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Test)
    if (!flags['no-brand']) {
        this.log(theme.brand());
    }

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
    let globalSuccess = false;

    try {
      let workflowData: any;
      let workflowName = 'Untitled';
      let rootRealTargetId: string | undefined = undefined;

      const dependencyMap = new Map<string, { name: string, data: any }>();
      const visited = new Set<string>();
      const resolutionMap = new Map<string, string>(); 
      let workflowChoices: any[] = [];

      const fetchDependencies = async (id: string, contextNodeName: string = 'Unknown') => {
          const realId = resolutionMap.get(id) || id;
          if (visited.has(realId)) return;
          visited.add(realId);

          let wf: any;

          // 1. Check local filesystem FIRST (prioritize local over instance)
          let localPath = '';
          const searchDirs = [
              ...(args.workflow ? [path.dirname(args.workflow)] : []),
              path.join(process.cwd(), 'workflows'),
              process.cwd()
          ];
          
          const sanitized = id.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
          const candidates = [];
          for (const dir of searchDirs) {
              candidates.push(path.join(dir, `${id}.json`));
              candidates.push(path.join(dir, `${sanitized}.json`));
              candidates.push(path.join(dir, `${id.replace(/\s+/g, '-')}.json`));
          }
          
          for (const candidate of candidates) {
              if (existsSync(candidate)) {
                  localPath = candidate;
                  break;
              }
          }

          if (localPath) {
              this.log(theme.agent(`Found local dependency for ${theme.value(id)} at ${theme.value(localPath)}`));
              const content = await fs.readFile(localPath, 'utf-8');
              wf = JSON.parse(content);
          } else {
              // Case-insensitive search in workflows/
              const workflowsDir = path.join(process.cwd(), 'workflows');
              if (existsSync(workflowsDir)) {
                  const files = await fs.readdir(workflowsDir);
                  const match = files.find(f => f.toLowerCase() === `${sanitized}.json` || f.toLowerCase() === `${id.toLowerCase()}.json`);
                  if (match) {
                     localPath = path.join(workflowsDir, match);
                     this.log(theme.agent(`Found local match for ${theme.value(id)}: ${theme.value(localPath)}`));
                     const content = await fs.readFile(localPath, 'utf-8');
                     wf = JSON.parse(content);
                  } else if (id.toUpperCase().includes('SUBWORKFLOW') || id.toUpperCase().includes('ID')) {
                      // FUZZY MATCH: If it's a generic placeholder, look for ANY newly created workflow in the same dir
                      const dir = args.workflow ? path.dirname(args.workflow) : workflowsDir;
                      const dirFiles = await fs.readdir(dir);
                      const jsonFiles = dirFiles.filter(f => f.endsWith('.json') && !f.includes(path.basename(args.workflow || '')));
                      if (jsonFiles.length === 1) {
                          localPath = path.join(dir, jsonFiles[0]);
                          this.log(theme.agent(`Fuzzy matched placeholder ${theme.value(id)} to ${theme.value(localPath)}`));
                          const content = await fs.readFile(localPath, 'utf-8');
                          wf = JSON.parse(content);
                      }
                  }
              }
          }

          // 2. If not local, try fetching from instance
          if (!wf) {
              try {
                  wf = await client.getWorkflow(realId) as any;
              } catch (e) {
                  this.log(theme.warn(`Dependency ${theme.value(id)} referenced in node [${contextNodeName}] could not be found.`));
                  if (workflowChoices.length === 0) {
                      const workflowsList = await client.getWorkflows();
                      workflowChoices = workflowsList.map(w => ({ name: w.name, value: w.id }));
                  }
                  const { resolvedId } = await inquirer.prompt([{
                      type: 'select',
                      name: 'resolvedId',
                      message: `Select replacement for missing dependency ${id}:`,
                      choices: workflowChoices,
                      pageSize: 15
                  }]);
                  resolutionMap.set(id, resolvedId);
                  await fetchDependencies(resolvedId, contextNodeName);
                  return;
              }
          }
          dependencyMap.set(realId, { name: wf.name, data: wf });
          const nodes = wf.nodes || [];
          for (const node of nodes) {
              if (node.type === 'n8n-nodes-base.executeWorkflow') {
                  const subId = node.parameters?.workflowId;
                  if (subId && typeof subId === 'string' && !subId.startsWith('=')) {
                       await fetchDependencies(subId, node.name);
                  }
              }
          }
      };

      if (args.workflow) {
          this.log(theme.agent(`Initializing virtual orchestrator for ${theme.value(args.workflow)}`));
          if (!args.workflow.endsWith('.json')) this.error('Local JSON path required.');
          const content = await fs.readFile(args.workflow, 'utf-8');
          workflowData = JSON.parse(content);
          workflowName = workflowData.name || 'Untitled';
          
          this.log(theme.agent(`Tracing dependencies for local file...`));
          const nodes = workflowData.nodes || [];
          for (const node of nodes) {
              if (node.type === 'n8n-nodes-base.executeWorkflow') {
                  const subId = node.parameters?.workflowId;
                  if (subId && typeof subId === 'string' && !subId.startsWith('=')) {
                       await fetchDependencies(subId, node.name);
                  }
              }
          }
      } else {
          this.log(theme.info('Searching for local and remote workflows...'));
          
          const localChoices: any[] = [];
          const workflowsDir = path.join(process.cwd(), 'workflows');
          const searchDirs = [workflowsDir, process.cwd()];
          
          for (const dir of searchDirs) {
              if (existsSync(dir)) {
                  const files = await fs.readdir(dir);
                  for (const file of files) {
                      if (file.endsWith('.json')) {
                          localChoices.push({
                              name: `${theme.value('[LOCAL]')} ${file}`,
                              value: { type: 'local', path: path.join(dir, file) }
                          });
                      }
                  }
              }
          }

          const remoteWorkflows = await client.getWorkflows();
          const remoteChoices = remoteWorkflows
            .filter(w => !w.name.startsWith('[TEST'))
            .map(w => ({
                name: `${theme.info('[n8n]')} ${w.name} (${w.id}) ${w.active ? '[Active]' : ''}`,
                value: { type: 'remote', id: w.id }
            }));

          const choices = [
              ...(localChoices.length > 0 ? [new inquirer.Separator('--- Local Files ---'), ...localChoices] : []),
              ...(remoteChoices.length > 0 ? [new inquirer.Separator('--- n8n Instance ---'), ...remoteChoices] : []),
          ];

          if (choices.length === 0) this.error('No workflows found locally or on n8n instance.');

          const { selection } = await inquirer.prompt([{
              type: 'select',
              name: 'selection',
              message: 'Select a workflow to test:',
              choices,
              pageSize: 15
          }]);

          if (selection.type === 'local') {
              this.log(theme.agent(`Initializing virtual orchestrator for ${theme.value(selection.path)}`));
              const content = await fs.readFile(selection.path, 'utf-8');
              workflowData = JSON.parse(content);
              workflowName = workflowData.name || 'Untitled';
              
              this.log(theme.agent(`Tracing dependencies for local file...`));
              const nodes = workflowData.nodes || [];
              for (const node of nodes) {
                  if (node.type === 'n8n-nodes-base.executeWorkflow') {
                      const subId = node.parameters?.workflowId;
                      if (subId && typeof subId === 'string' && !subId.startsWith('=')) {
                           await fetchDependencies(subId, node.name);
                      }
                  }
              }
          } else {
              this.log(theme.agent(`Tracing dependencies for ${theme.value(selection.id)}...`));
              await fetchDependencies(selection.id, 'ROOT');
              
              const rootRealId = resolutionMap.get(selection.id) || selection.id;
              const rootInfo = dependencyMap.get(rootRealId);
              if (rootInfo) {
                  workflowName = rootInfo.name;
                  workflowData = rootInfo.data;
                  dependencyMap.delete(rootRealId);
              }
              rootRealTargetId = rootRealId;
          }
      }

      // --- GLOBAL REPAIR LOOP (Structural + Logical) ---
      let globalAttempts = 0;
      const maxGlobalAttempts = 10;
      let globalRepairHistory: string[] = [];
      const errorCounts = new Map<string, number>();

      while (globalAttempts < maxGlobalAttempts && !globalSuccess) {
          globalAttempts++;
          
          if (globalAttempts > 1) {
              this.log(theme.agent(`${theme.warn('Global Repair Loop')} Attempt ${globalAttempts}/${maxGlobalAttempts}...`));
          }

          try {
              // 1b. Stage dependencies
              const idMap = new Map<string, string>(); 
              (this as any).createdWorkflowIds = (this as any).createdWorkflowIds || []; 

              for (const [realId, info] of dependencyMap.entries()) {
                   this.log(theme.agent(`Staging dependency: ${info.name} (ID: ${realId})...`));
                   let depData = {
                       nodes: info.data.nodes,
                       connections: info.data.connections,
                       settings: info.data.settings || {},
                       staticData: info.data.staticData || {}
                   };
                   const hasActivatableTrigger = depData.nodes.some((n: any) => n.type === 'n8n-nodes-base.webhook' && !n.disabled);
                   if (!hasActivatableTrigger) {
                       this.log(theme.warn(`Dependency ${info.name} missing activatable trigger. Injecting webhook shim...`));
                       depData = client.injectManualTrigger(depData);
                   }
                   
                   try {
                       const { id: tempId } = await client.createWorkflow(`[n8m:dep] ${info.name}`, depData);
                       (this as any).createdWorkflowIds.push(tempId);
                       await client.executeWorkflow(tempId);
                       deployedDefinitions.set(tempId, { name: info.name, data: depData, type: 'dependency', realId: realId });
                       idMap.set(realId, tempId);
                   } catch (err) {
                       const errorMsg = this.cleanErrorMsg((err as Error).message);
                       this.log(theme.error(`Staging Failed for ${info.name}: ${errorMsg}`));
                       
                       this.log(theme.agent(`Initiating auto-repair for structural failure...`));
                       const ai = AIService.getInstance();
                       const fixedWf = await ai.generateWorkflowFix(depData, `Staging Error: ${errorMsg}\nHistory: ${globalRepairHistory.join('\n')}`);
                       dependencyMap.set(realId, { name: info.name, data: fixedWf });
                       
                       globalRepairHistory.push(`[Staging] ${info.name} failed: ${errorMsg}`);
                       throw new Error("RETRY_STAGING");
                   }
              }
      
              const patchWorkflow = (wf: any, map: Map<string, string>) => {
                  let str = JSON.stringify(wf);
                  for (const [oldId, newId] of map.entries()) {
                      str = str.split(oldId).join(newId);
                  }
                  return JSON.parse(str);
              };

              let currentWorkflowData = patchWorkflow(workflowData, idMap);

              // 2. COMMON: Stage Ephemeral Root and Test
              const rootPayload = {
                  nodes: currentWorkflowData.nodes,
                  connections: currentWorkflowData.connections,
                  settings: currentWorkflowData.settings || {},
                  staticData: currentWorkflowData.staticData || {}
              };

              const hasRootManualTrigger = rootPayload.nodes.some((n: any) => 
                (n.type === 'n8n-nodes-base.manualTrigger' || n.type === 'n8n-nodes-base.webhook') && !n.disabled
              );
              
              if (!hasRootManualTrigger) {
                   this.log(theme.warn(`Root workflow missing manual/webhook trigger. Injecting shim...`));
                   const shimmed = client.injectManualTrigger(rootPayload);
                   rootPayload.nodes = shimmed.nodes;
                   rootPayload.connections = shimmed.connections;
              }

              this.log(theme.agent(`Deploying ephemeral root: [n8m:test] ${workflowName}...`));
              
              let currentRootId: string;
              try {
                  const { id } = await client.createWorkflow(`[n8m:test] ${workflowName}`, rootPayload);
                  currentRootId = id;
                  (this as any).createdWorkflowIds.push(currentRootId);
                  createdWorkflowId = currentRootId;
              } catch (err) {
                  const errorMsg = (err as Error).message;
                  this.log(theme.error(`Staging Failed for Root: ${errorMsg}`));
                  
                  this.log(theme.agent(`Initiating auto-repair for structural failure...`));
                  const ai = AIService.getInstance();
                  const normMsg = this.normalizeError(errorMsg);
                  const count = (errorCounts.get(normMsg) || 0) + 1;
                  errorCounts.set(normMsg, count);
                  const useSearch = count > 1;

                  if (useSearch) {
                    this.log(theme.agent(`${theme.warn('Grounding Active')}: Searching the web for n8n node metadata...`));
                  }

                  workflowData = await ai.generateWorkflowFix(rootPayload, `Staging Error: ${errorMsg}\nHistory: ${globalRepairHistory.join('\n')}`, 'gemini-3-flash-preview', useSearch);
                  
                  globalRepairHistory.push(`[Staging] Root failed: ${errorMsg}`);
                  throw new Error("RETRY_STAGING");
              }

              deployedDefinitions.set(currentRootId, { name: workflowName, data: rootPayload, type: 'root', realId: rootRealTargetId });

              this.log(theme.success('Environment Ready. Validating...'));
              try {
                  await client.executeWorkflow(currentRootId);
              } catch (execErr) {
                  const errorMsg = this.cleanErrorMsg((execErr as Error).message);
                  this.log(theme.error(`Validation Activation Failed: ${errorMsg}`));
                  
                  this.log(theme.agent(`Initiating auto-repair for activation failure...`));
                  const ai = AIService.getInstance();
                  const normMsg = this.normalizeError(errorMsg);
                  const count = (errorCounts.get(normMsg) || 0) + 1;
                  errorCounts.set(normMsg, count);
                  const useSearch = count > 1;

                  if (useSearch) {
                    this.log(theme.agent(`${theme.warn('Grounding Active')}: Searching the web for n8n node metadata...`));
                  }

                  workflowData = await ai.generateWorkflowFix(rootPayload, `Activation/Execution Error: ${errorMsg}\nHistory: ${globalRepairHistory.join('\n')}`, 'gemini-3-flash-preview', useSearch);
                  
                  globalRepairHistory.push(`[Activation] Failed: ${errorMsg}`);
                  throw new Error("RETRY_STAGING");
              }

              // 3. Trigger Execution (E2E)
              const webhookNode = rootPayload.nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook');
              if (webhookNode) {
                  const path = webhookNode.parameters?.path;
                  
                  if (path) {
                      const ai = AIService.getInstance();
                      
                      const nodeNames = rootPayload.nodes.map((n: any) => n.name).join(', ');
                      const context = `Workflow Name: "${workflowName}"
                      Nodes: ${nodeNames}
                      Generate a SINGLE JSON object payload that effectively tests this workflow.`;

                      this.log(theme.agent('Generating Mock Data...'));
                      let mockPayload = await ai.generateMockData(context, 'gemini-3-flash-preview', globalRepairHistory);
                      
                      this.log(theme.agent('Triggering Entry Point...'));
                      const baseUrl = new URL(n8nUrl).origin;
                      const webhookUrl = `${baseUrl}/webhook/${path}`;
                      
                      const response = await fetch(webhookUrl, {
                          method: 'POST', 
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(mockPayload)
                      });
                      
                      if (response.ok) {
                          const executionStartTime = Date.now();
                          this.log(theme.done('Workflow Triggered Successfully.'));
                          this.log(theme.subHeader('Live Execution Trace'));
                          
                          let executionFound = false;
                          const reportedNodes = new Set<string>();
                          
                          const maxPoll = 50; 
                          for (let i = 0; i < maxPoll; i++) {
                              await new Promise(r => setTimeout(r, 2000));
                              const executions = await client.getWorkflowExecutions(currentRootId);
                              const recentExec = executions.find((e: any) => new Date(e.startedAt).getTime() > (executionStartTime - 5000));
                              
                              if (recentExec) {
                                  executionFound = true;
                                  const fullExec = await client.getExecution(recentExec.id) as any;
                                  const runData = fullExec.data?.resultData?.runData || {};
                                  let currentError: string | null = null;
                                  
                                  Object.entries(runData).forEach(([nodeName, runs]: [string, any]) => {
                                      for (const [runIndex, run] of runs.entries()) {
                                          const uniqueKey = `${nodeName}-${runIndex}`;
                                          if (!reportedNodes.has(uniqueKey)) {
                                              reportedNodes.add(uniqueKey);
                                              if (nodeName.includes('Shim_Flattener')) continue;
                                              
                                              const outputData = run.data?.main?.[0]?.[0]?.json;
                                              let displayName = nodeName === 'N8M_Shim_Webhook' ? theme.label('[Trigger]') : theme.label(nodeName);
                                              const paddedName = displayName.padEnd(25, ' ');
                                              if (outputData) {
                                                   const keys = Object.keys(outputData).join(', ');
                                                   this.log(`${theme.agent('•')} ${paddedName} ${theme.success('✔')} (1 item) ${theme.muted(keys.substring(0, 60))}${keys.length > 60 ? '...' : ''}`);
                                              } else {
                                                   currentError = `Flow stopped at ${displayName} (0 items)`;
                                                   this.log(`${theme.agent('•')} ${paddedName} ${theme.warn('🛑 Flow stopped (0 items)')}`);
                                              }
                                          }
                                      }
                                  });

                                  if (fullExec.status === 'success' || fullExec.status === 'failed' || currentError) {
                                      if (fullExec.status === 'success' && !currentError) {
                                          this.log(theme.success(`Execution Finished Successfully. (ID: ${recentExec.id})`));
                                          globalSuccess = true;
                                      } else {
                                          const errorMsg = currentError || (fullExec.data?.resultData?.error?.message || "Unknown flow failure");
                                          this.log(theme.error(`Execution Failed/Stopped: ${errorMsg}`));
                                          
                                          this.log(theme.agent(`Initiating auto-repair for logical failure...`));
                                          const normMsg = this.normalizeError(errorMsg);
                                          const count = (errorCounts.get(normMsg) || 0) + 1;
                                          errorCounts.set(normMsg, count);
                                          const useSearch = count > 1;

                                          if (useSearch) {
                                            this.log(theme.agent(`${theme.warn('Grounding Active')}: Searching the web for n8n node metadata...`));
                                          }

                                          workflowData = await ai.generateWorkflowFix(workflowData, `Execution Failed/Stopped: ${errorMsg}\nPayload was: ${JSON.stringify(mockPayload)}\nHistory: ${globalRepairHistory.join('\n')}`, 'gemini-3-flash-preview', useSearch);
                                          globalRepairHistory.push(`[Execution] Failed: ${errorMsg}`);
                                          throw new Error("RETRY_STAGING");
                                      }
                                      break;
                                  }
                              }
                          }
                          
                          if (!executionFound) {
                              this.log(theme.warn('No execution found after webhook trigger.'));
                              globalRepairHistory.push("[Execution] No execution triggered.");
                              throw new Error("RETRY_STAGING");
                          }
                      }
                  }
              } else {
                  this.log(theme.done('Workflow Validated Successfully (No webhook trigger needed).'));
                  globalSuccess = true;
              }

          } catch (err) {
              if ((err as Error).message === "RETRY_STAGING") {
                  if ((this as any).createdWorkflowIds) {
                      for (const id of (this as any).createdWorkflowIds) {
                          try { await client.deleteWorkflow(id); } catch (e) {}
                      }
                      (this as any).createdWorkflowIds = [];
                  }
                  continue;
              }
              throw err;
          }
      }

      if (!globalSuccess) {
          this.error(`Workflow test failed after ${maxGlobalAttempts} repair attempts.`);
      }

    } catch (error) {
      const errMsg = this.cleanErrorMsg((error as Error).message);

      this.log(theme.fail(`Validation Failed`));
      this.log(theme.brand() + ' ' + theme.error(errMsg));
      process.exitCode = 1;
      
      if (flags['keep-on-fail'] && createdWorkflowId) {
         this.log(theme.warn(`PRESERVATION ACTIVE: Workflow ${createdWorkflowId} persists.`));
         createdWorkflowId = null; 
      }
    } finally {
        if (deployedDefinitions.size > 0 && globalSuccess) {
            if (flags['validate-only']) {
                if (args.workflow && args.workflow.endsWith('.json')) {
                    const rootDef = Array.from(deployedDefinitions.values()).find(d => d.type === 'root');
                    if (rootDef) {
                        const cleanData = this.sanitizeWorkflow(this.stripShim(rootDef.data));
                        cleanData.name = rootDef.name;
                        try {
                            await fs.writeFile(args.workflow, JSON.stringify(cleanData, null, 2));
                            this.log(theme.muted(`[Repair-Sync] Updated local file with latest repairs.`));
                        } catch (e) {
                            this.warn(`Failed to sync repairs: ${(e as Error).message}`);
                        }
                    }
                }
            } else {
                await this.handlePostTestActions(deployedDefinitions, args.workflow, client);
            }
        }

       const allIds = [createdWorkflowId, ...((this as any).createdWorkflowIds || [])].filter(Boolean);
       const uniqueIds = [...new Set(allIds)];
      
       if (uniqueIds.length > 0) {
        this.log(theme.info(`Purging ${uniqueIds.length} temporary assets...`));
        for (const wid of uniqueIds) {
            try {
              if (wid) await client.deleteWorkflow(wid);
            } catch (cleanupError) {}
        }
        this.log(theme.done('Environment clean.'));
      }
    }
  }

  /**
   * Extract clean error message from n8n API responses
   */
  private cleanErrorMsg(errMsg: any): string {
      if (!errMsg || typeof errMsg !== 'string') return String(errMsg || 'Unknown Error');
      try {
        const jsonMatch = errMsg.match(/\{.*\}/);
        if (jsonMatch) {
            const errorObj = JSON.parse(jsonMatch[0]);
            if (errorObj.message) {
                return errorObj.message;
            }
        }
      } catch (e) {}
      return errMsg;
  }

  /**
   * Normalize error messages to catch "similar" errors (masking IDs/numbers)
   */
  private normalizeError(msg: string): string {
      let normalized = msg.toLowerCase();
      // Group all unrecognized node type errors
      if (normalized.includes('unrecognized node type')) {
          return 'unrecognized node type';
      }
      return normalized
          .replace(/\b[a-f0-9-]{36}\b/g, 'ID')
          .replace(/\b[a-f0-9]{24}\b/g, 'ID')
          .replace(/\b\d+\b/g, 'N')
          .replace(/\s+/g, ' ')
          .trim();
  }

  private sanitizeWorkflow(data: any): any {
      const allowedKeys = ['name', 'nodes', 'connections', 'settings', 'staticData', 'pinData', 'meta'];
      const sanitized: any = {};
      for (const key of allowedKeys) {
          if (data[key] !== undefined) {
              sanitized[key] = data[key];
          }
      }
      return sanitized;
  }

  private stripShim(workflowData: any): any {
      if (!workflowData.nodes) return workflowData;
      const nodes = workflowData.nodes.filter((n: any) => 
          n.name !== 'N8M_Shim_Webhook' && 
          n.name !== 'Shim_Flattener'
      );
      const connections: any = {};
      for (const [nodeName, conns] of Object.entries(workflowData.connections || {})) {
          if (nodeName === 'N8M_Shim_Webhook' || nodeName === 'Shim_Flattener') continue;
          connections[nodeName] = conns;
      }
      return { ...workflowData, nodes, connections };
  }

  private async saveWorkflows(deployedDefinitions: Map<string, any>, originalPath?: string) {
      if (deployedDefinitions.size === 0) return;
      const { save } = await inquirer.prompt([{
          type: 'confirm',
          name: 'save',
          message: 'Test passed. Save workflows locally?',
          default: true
      }]);
      if (!save) return;

      for (const [id, def] of deployedDefinitions.entries()) {
          const cleanData = this.sanitizeWorkflow(this.stripShim(def.data));
          cleanData.name = def.name;
          let targetPath = originalPath && def.type === 'root' ? originalPath : path.join(process.cwd(), 'workflows', `${def.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`);

          const { confirmPath } = await inquirer.prompt([{
              type: 'input',
              name: 'confirmPath',
              message: `Save '${def.name}' to:`,
              default: targetPath
          }]);

          try {
              await fs.mkdir(path.dirname(confirmPath), { recursive: true });
              await fs.writeFile(confirmPath, JSON.stringify(cleanData, null, 2));
              this.log(theme.success(`Saved to ${confirmPath}`));
          } catch (e) {
              this.log(theme.fail(`Failed to save: ${(e as Error).message}`));
          }
      }
  }

  private async handlePostTestActions(deployedDefinitions: Map<string, any>, originalPath: string | undefined, client: N8nClient) {
      if (deployedDefinitions.size === 0) return;
      const { action } = await inquirer.prompt([{
          type: 'confirm',
          name: 'action',
          message: 'Test completed. Deploy changes to instance? (Y = Deploy, n = Save to file)',
          default: true
      }]);
      if (action) {
          await this.deployWorkflows(deployedDefinitions, client);
      } else {
          await this.saveWorkflows(deployedDefinitions, originalPath);
      }
  }

  private async deployWorkflows(deployedDefinitions: Map<string, any>, client: N8nClient) {
      for (const [tempId, def] of deployedDefinitions.entries()) {
          const cleanData = this.sanitizeWorkflow(this.stripShim(def.data));
          cleanData.name = def.name;
          if (def.realId) {
             try {
                  this.log(theme.agent(`Deploying (Overwriting) ${theme.value(def.name)} [${def.realId}]...`));
                  await client.updateWorkflow(def.realId, cleanData);
                  this.log(theme.success(`✔ Updated ${def.name}`));
             } catch (e) {
                  const msg = (e as Error).message;
                  if (msg.includes('trigger') || msg.includes('activated')) {
                      try {
                          await client.deactivateWorkflow(def.realId);
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
                try {
                    this.log(theme.agent(`Deploying (Creating New) ${theme.value(def.name)}...`));
                    const result = await client.createWorkflow(def.name, cleanData);
                    this.log(theme.success(`✔ Created ${def.name} [ID: ${result.id}]`));
                    this.log(`${theme.label('Link')} ${theme.secondary(client.getWorkflowLink(result.id))}`);
                } catch (e) {
                    this.log(theme.fail(`Failed to create ${def.name}: ${(e as Error).message}`));
                }
            }
        }
     }
}
