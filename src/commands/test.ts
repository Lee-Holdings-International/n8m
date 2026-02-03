import inquirer from 'inquirer'
import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js'
import {N8nClient} from '../utils/n8nClient.js'
import {ConfigManager} from '../utils/config.js'
import { AIService } from '../services/ai.service.js';
import { runAgenticWorkflow, graph, resumeAgenticWorkflow } from '../agentic/graph.js';
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
    
    // 1a. Fetch Valid Node Types (New)
    let validNodeTypes: string[] = [];
    try {
        validNodeTypes = await client.getNodeTypes();
        if (validNodeTypes.length > 0) {
            this.log(theme.success(`✔ Loaded ${validNodeTypes.length} valid node types.`));
        } else {
            this.log(theme.warn('⚠ Could not load node types. Validation/Shimming will be limited.'));
        }
    } catch (e) {
         this.log(theme.warn(`⚠ Failed to fetch node types: ${(e as Error).message}`));
    }

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
                     const content = await fs.readFile(localPath, 'utf-8');
                     wf = JSON.parse(content);
                  } else if (id.toUpperCase().includes('SUBWORKFLOW') || id.toUpperCase().includes('ID')) {
                      // FUZZY MATCH: If it's a generic placeholder, look for ANY newly created workflow in the same dir
                      const dir = args.workflow ? path.dirname(args.workflow) : workflowsDir;
                      const dirFiles = await fs.readdir(dir);
                      const jsonFiles = dirFiles.filter(f => f.endsWith('.json') && !f.includes(path.basename(args.workflow || '')));
                      if (jsonFiles.length === 1) {
                          localPath = path.join(dir, jsonFiles[0]);
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
          if (!args.workflow.endsWith('.json')) this.error('Local JSON path required.');
          const content = await fs.readFile(args.workflow, 'utf-8');
          workflowData = JSON.parse(content);
          workflowName = workflowData.name || 'Untitled';
          if (workflowData.id) {
              rootRealTargetId = workflowData.id;
          }
          
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

      // --- 3. Deploy Dependencies Ephemerally ---
      const remappedIds = new Map<string, string>();
      
      if (dependencyMap.size > 0) {
          // this.log(theme.subHeader('DEPENDENCY LINKING'));
          // this.log(theme.info(`Found ${dependencyMap.size} dependencies. Deploying ephemeral copies...`));

          for (const [originalId, info] of dependencyMap.entries()) {
              try {
                  const depName = `[n8m:test:dep] ${info.name}`;
                  
                  // Strict sanitize for n8n API which is picky about extra fields
                  // Strict sanitize for n8n API which is picky about extra fields
                  // 'meta' often contains templateId/instanceId which are rejected on create
                  // 'staticData', 'pinData', and 'tags' can also trigger "additional properties" on strict/older APIs
                  const allowedKeys = ['name', 'nodes', 'connections', 'settings']; 
                  const depData: any = {};
                  for (const key of allowedKeys) {
                      if (info.data[key] !== undefined) {
                          depData[key] = info.data[key];
                      }
                  }
                  
                  // Ensure settings is clean
                  if (depData.settings) {
                      // Strictly allow only safe settings
                      const safeSettings = ['saveManualExecutions', 'callerPolicy', 'errorWorkflow', 'timezone', 'saveExecutionProgress', 'executionOrder'];
                      const cleanSettings: any = {};
                      for (const k of safeSettings) {
                           if (depData.settings[k] !== undefined) cleanSettings[k] = depData.settings[k];
                      }
                      depData.settings = cleanSettings;
                  }
                  
                  // Ensure settings exists
                  if (!depData.settings) {
                      depData.settings = {};
                  }
                  
                  // CRITICAL: Sub-workflows often don't have triggers, preventing activation. 
                  // But n8n requires referenced workflows to be "published" (active) in some contexts,
                  // or at least we want them active to be safe.
                  // So we INJECT a dummy trigger if one is missing, to satisfy the activation requirement.
                  const hasTrigger = (depData.nodes || []).some((n: any) => 
                      n.type.includes('Trigger') && !n.type.includes('executeWorkflowTrigger')
                  );

                  if (!hasTrigger) {
                      // Use the client's helper to inject a shim trigger
                      // We need to cast client to any or ensure the method is public (it is)
                      const shimmed = client.injectManualTrigger(depData);
                      depData.nodes = shimmed.nodes;
                      depData.connections = shimmed.connections;
                  }
                  
                  depData.name = depName;

                  let result;
                  try {
                      result = await client.createWorkflow(depName, depData);
                  } catch (createErr: any) {
                      if (createErr.message.includes('additional properties')) {
                           this.log(theme.warn(`  ⚠ Strict validation error. Retrying with minimal payload...`));
                           // Fallback: Drop settings entirely if it fails
                           delete depData.settings;
                           result = await client.createWorkflow(depName, depData);
                      } else {
                          throw createErr;
                      }
                  }

                  // this.log(theme.success(`✔ Linked dependency: ${theme.value(info.name)} -> ${result.id}`));
                  
                  // ACTIVATE the dependency so it can be called
                  try {
                      await client.activateWorkflow(result.id);
                      // this.log(theme.info(`  └─ Active`)); 
                  } catch (actErr: any) {
                       this.log(theme.warn(`  ⚠ Could not activate dependency: ${actErr.message}`));
                  }

                  remappedIds.set(originalId, result.id);
                  // Track for cleanup
                  if (!(this as any).createdWorkflowIds) (this as any).createdWorkflowIds = [];
                  (this as any).createdWorkflowIds.push(result.id);
                  
                  // Also handle the "Resolved" ID if it was different
                  // (e.g. valid-id in node -> resolved-id in file)
                  // The dependencyMap key *is* the ID from the node (or resolution map), so we should be good.
                  
              } catch (e) {
                  this.log(theme.warn(`⚠ Failed to deploy dependency ${info.name}: ${(e as Error).message}`));
              }
          }
      }

      // --- 4. Patch Root Workflow with New IDs ---
      if (remappedIds.size > 0) {
          let patchCount = 0;
          const patchNodes = (nodes: any[]) => {
              for (const node of nodes) {
                  if (node.type === 'n8n-nodes-base.executeWorkflow') {
                      const subId = node.parameters?.workflowId;
                      const realId = resolutionMap.get(subId) || subId;
                      if (subId && typeof subId === 'string' && remappedIds.has(realId)) {
                          node.parameters.workflowId = remappedIds.get(realId);
                          patchCount++;
                      }
                  }
              }
          };
          
          if (workflowData.nodes) {
              patchNodes(workflowData.nodes);
          }
      }

      // --- GLOBAL REPAIR LOOP (Structural + Logical) ---
      // --- AGENTIC WORKFLOW EXECUTION ---
      this.log(theme.subHeader('AGENTIC VALIDATION'));
      this.log(theme.agent("Initializing Agentic Workflow to validate/repair this workflow..."));

      const goal = `Validate and fix the workflow named "${workflowName}"`;
      
      const initialState = {
          userGoal: goal,
          messages: [],
          validationErrors: [],
          workflowJson: workflowData,
          availableNodeTypes: validNodeTypes
      };

      // We need to route the graph logger to our CLI logger if possible, or just let it print to stdout
      // The graph uses console.log currently, which is fine.
      
      // Run the graph
      // Note: We need to cast to any because TeamState might have stricter typing than what we pass
      const ephemeralThreadId = `test-${Date.now()}`;
      let result = await runAgenticWorkflow(goal, initialState, ephemeralThreadId) as any;
      
      // HITL Handling for Test Command
      // Check if paused
      let snapshot = await graph.getState({ configurable: { thread_id: ephemeralThreadId } });
      if (snapshot.next && snapshot.next.length > 0) {
          if (flags.headless) {
              this.log(theme.info("Headless mode active. Auto-resuming..."));
              result = await resumeAgenticWorkflow(ephemeralThreadId);
          } else {
             const { resume } = await inquirer.prompt([{
                type: 'confirm',
                name: 'resume',
                message: 'Reviewer passed blueprint. Proceed to QA Execution?',
                default: true
             }]);
             if (resume) {
                 result = await resumeAgenticWorkflow(ephemeralThreadId);
             } else {
                 this.log(theme.warn("Test aborted by user."));
                 return;
             }
          }
      }
      
      if (result.validationStatus === 'passed') {
          globalSuccess = true;
          // this.log(theme.success("Agentic Validation Passed!"));
          
          if (result.workflowJson) {
              // Extract the fixed/validated workflows
              // The graph result uses the same structure as Engineer: { workflows: [...] } or just workflowJson object
              let fixedWorkflow = result.workflowJson;
              
              // If it's wrapped in a workflows array (Multi-workflow support), take the first one for now
              if (result.workflowJson.workflows && Array.isArray(result.workflowJson.workflows)) {
                   fixedWorkflow = result.workflowJson.workflows[0];
              }
              
              const finalName = fixedWorkflow.name || workflowName;
              deployedDefinitions.set('agentic-result', { 
                  name: finalName, 
                  data: fixedWorkflow, 
                  type: 'root', 
                  realId: rootRealTargetId 
              });
          }
      } else {
          this.log(theme.fail("Agentic Validation Failed."));
          if (result.validationErrors && result.validationErrors.length > 0) {
              result.validationErrors.forEach((err: string) => this.log(theme.error(`Error: ${err}`)));
          }
      }


    } catch (error) {
      const errMsg = this.cleanErrorMsg((error as Error).message);

      this.log(theme.fail(`Validation Failed`));
      this.log(theme.error(errMsg));
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
      process.exit(0);
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
      // n8n API is extremely picky during UPDATE/CREATE.
      // properties like 'meta', 'pinData', 'tags', and 'versionId' often cause 400 Bad Request
      // 'request/body must NOT have additional properties'.
      // We only send the core structure.
      const allowedKeys = ['name', 'nodes', 'connections', 'settings'];
      const sanitized: any = {
          settings: data.settings || {}
      };
      for (const key of allowedKeys) {
          if (data[key] !== undefined && key !== 'settings') {
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
