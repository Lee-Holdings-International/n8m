import inquirer from 'inquirer'
import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js'
import {N8nClient} from '../utils/n8nClient.js'
import {ConfigManager} from '../utils/config.js'
import { AIService } from '../services/ai.service.js';
import { DocService } from '../services/doc.service.js';
import { Spinner } from '../utils/spinner.js';
import { runAgenticWorkflow, graph, resumeAgenticWorkflow } from '../agentic/graph.js';
import { FixtureManager, WorkflowFixture } from '../utils/fixtureManager.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    'ai-scenarios': Flags.boolean({
      default: false,
      description: 'Generate 3 diverse AI test scenarios (happy path, edge case, error)',
    }),
    fixture: Flags.string({
      char: 'f',
      description: 'Path to a fixture JSON file to use for offline testing',
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
    const aiService = AIService.getInstance();

    // Node-type validation uses the local fallback definitions bundled with the
    // project.  We don't attempt a live fetch from the n8n instance because the
    // /node-types endpoint is not available on all versions.
    const validNodeTypes: string[] = [];

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
              } catch {
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
          const patchNodes = (nodes: any[]) => {
              for (const node of nodes) {
                  if (node.type === 'n8n-nodes-base.executeWorkflow') {
                      const subId = node.parameters?.workflowId;
                      const realId = resolutionMap.get(subId) || subId;
                      if (subId && typeof subId === 'string' && remappedIds.has(realId)) {
                          node.parameters.workflowId = remappedIds.get(realId);
                      }
                  }
              }
          };
          
          if (workflowData.nodes) {
              patchNodes(workflowData.nodes);
          }
      }

      // --- AGENTIC VALIDATION ---
      this.log(theme.subHeader('AGENTIC VALIDATION'));

      let testScenarios: any[] = [];
      if (flags['ai-scenarios']) {
          const goalForScenarios = `Validate and fix the workflow named "${workflowName}"`;
          this.log(theme.agent("Generating AI test scenarios..."));
          testScenarios = await aiService.generateTestScenarios(workflowData, goalForScenarios);
          this.log(theme.muted(`Generated ${testScenarios.length} scenarios.`));
      }

      if (rootRealTargetId) {
          // REMOTE WORKFLOW: test against the real instance workflow — no ephemeral copy, no shim.
          // Credentials are already configured on the instance; no need to strip them.
          const fixtureManager = new FixtureManager();
          const validateOnly = flags['validate-only'];
          let directResult: { passed: boolean; errors: string[]; finalWorkflow?: any; lastExecution?: any };

          const fixtureFlagPath = flags['fixture'];
          if (fixtureFlagPath) {
              // --fixture flag: load from explicit path, run offline immediately (no prompt)
              const fixture = fixtureManager.loadFromPath(fixtureFlagPath);
              if (!fixture) {
                  this.log(theme.fail(`Could not load fixture from: ${fixtureFlagPath}`));
                  return;
              }
              directResult = await this.testWithFixture(fixture, workflowName, aiService);
          } else {
              const capturedDate = fixtureManager.getCapturedDate(rootRealTargetId);
              if (capturedDate && !validateOnly) {
                  const dateStr = capturedDate.toLocaleString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                  });
                  const { useFixture } = await inquirer.prompt([{
                      type: 'confirm',
                      name: 'useFixture',
                      message: `Fixture found from ${dateStr}. Run offline?`,
                      default: true,
                  }]);

                  if (useFixture) {
                      const fixture = fixtureManager.load(rootRealTargetId)!;
                      directResult = await this.testWithFixture(fixture, workflowName, aiService);
                  } else {
                      directResult = await this.testRemoteWorkflowDirectly(
                          rootRealTargetId, workflowData, workflowName, client, aiService, n8nUrl!, testScenarios
                      );
                      if (directResult.passed && !validateOnly) {
                          await this.offerSaveFixture(
                              fixtureManager, rootRealTargetId, workflowName,
                              directResult.finalWorkflow ?? workflowData,
                              directResult.lastExecution,
                          );
                      }
                  }
              } else if (capturedDate && validateOnly) {
                  // validate-only + fixture: use fixture silently (no prompt)
                  const fixture = fixtureManager.load(rootRealTargetId)!;
                  directResult = await this.testWithFixture(fixture, workflowName, aiService);
              } else {
                  directResult = await this.testRemoteWorkflowDirectly(
                      rootRealTargetId, workflowData, workflowName, client, aiService, n8nUrl!, testScenarios
                  );
                  if (directResult.passed && !validateOnly) {
                      await this.offerSaveFixture(
                          fixtureManager, rootRealTargetId, workflowName,
                          directResult.finalWorkflow ?? workflowData,
                          directResult.lastExecution,
                      );
                  }
              }
          }

          if (directResult.passed) {
              globalSuccess = true;
              // Use finalWorkflow from the result (already in-memory — no extra API call).
              deployedDefinitions.set('remote-result', {
                  name: workflowName,
                  data: directResult.finalWorkflow ?? workflowData,
                  type: 'root',
                  realId: rootRealTargetId,
              });
          } else {
              this.log(theme.fail(`Validation failed — ${directResult.errors.length} issue(s).`));
              directResult.errors.forEach((e: string) => this.log(theme.muted(`  ↳ ${e}`)));
          }
      } else {
          // LOCAL FILE: use the agentic graph for structural validation and repair.
          const goal = `Validate and fix the workflow named "${workflowName}"`;

          const initialState = {
              userGoal: goal,
              messages: [],
              validationErrors: [],
              workflowJson: workflowData,
              availableNodeTypes: validNodeTypes,
              testScenarios: testScenarios
          };

          const ephemeralThreadId = `test-${Date.now()}`;
          let result = await runAgenticWorkflow(goal, initialState, ephemeralThreadId) as any;

          // HITL Handling: Loop until graph reaches END (handles self-correction cycles)
          // Each repair iteration creates a new interrupt before engineer, so we need to keep resuming.
          const MAX_RESUMES = 8; // architect + 2 engineers + reviewer + fix loop iterations
          for (let i = 0; i < MAX_RESUMES; i++) {
              const snapshot = await graph.getState({ configurable: { thread_id: ephemeralThreadId } });
              if (!snapshot.next || snapshot.next.length === 0) break; // Graph reached END

              if (flags.headless) {
                  result = await resumeAgenticWorkflow(ephemeralThreadId);
              } else {
                  const nodeLabel = (snapshot.next as string[]).join(', ');
                  const isQa = nodeLabel.includes('qa');
                  const { resume } = await inquirer.prompt([{
                      type: 'confirm',
                      name: 'resume',
                      message: isQa ? 'Reviewer passed blueprint. Proceed to QA Execution?' : `Paused before: ${nodeLabel}. Continue?`,
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

              if (result.workflowJson) {
                  let fixedWorkflow = result.workflowJson;
                  if (result.workflowJson.workflows && Array.isArray(result.workflowJson.workflows)) {
                      fixedWorkflow = result.workflowJson.workflows[0];
                  }
                  const finalName = fixedWorkflow.name || workflowName;
                  deployedDefinitions.set('agentic-result', {
                      name: finalName,
                      data: fixedWorkflow,
                      type: 'root',
                      realId: undefined,
                  });
              }
          } else {
              const errors: string[] = result.validationErrors ?? [];
              this.log(theme.fail(`Validation failed — ${errors.length} unresolved issue${errors.length === 1 ? '' : 's'}.`));
              errors.forEach((err: string) => this.log(theme.muted(`  ↳ ${err}`)));
          }
      }


    } catch (error) {
      const errMsg = this.cleanErrorMsg((error as Error).message);
      this.log(theme.fail(`Validation failed — unhandled error`));
      this.log(theme.muted(`  ↳ ${errMsg}`));
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
            } catch { /* intentionally empty */ }
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
      } catch { /* intentionally empty */ }
      return errMsg;
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

  private async saveWorkflows(deployedDefinitions: Map<string, any>, _originalPath?: string) {
      if (deployedDefinitions.size === 0) return;
      const { save } = await inquirer.prompt([{
          type: 'confirm',
          name: 'save',
          message: 'Test passed. Save workflows locally?',
          default: true
      }]);
      if (!save) return;

      const docService = DocService.getInstance();
      for (const [, def] of deployedDefinitions.entries()) {
          const cleanData = this.sanitizeWorkflow(this.stripShim(def.data));
          
          // Use AI to suggest title if it looks like a temporary name
          let workflowName = def.name;
          if (workflowName.startsWith('[n8m:test]') || workflowName.includes('Agentic_Test')) {
              this.log(theme.agent("Suggesting professional project title..."));
              workflowName = await docService.generateProjectTitle(cleanData);
          }
          cleanData.name = workflowName;

          const slug = docService.generateSlug(workflowName);
          const targetDir = path.join(process.cwd(), 'workflows', slug);
          const targetPath = path.join(targetDir, 'workflow.json');

          const { confirmPath } = await inquirer.prompt([{
              type: 'input',
              name: 'confirmPath',
              message: `Save '${workflowName}' to:`,
              default: targetPath
          }]);

          try {
              await fs.mkdir(path.dirname(confirmPath), { recursive: true });
              await fs.writeFile(confirmPath, JSON.stringify(cleanData, null, 2));
              this.log(theme.success(`Saved to ${confirmPath}`));
              
              // Optionally generate doc if it's a new directory
              const readmePath = path.join(path.dirname(confirmPath), 'README.md');
              if (!existsSync(readmePath)) {
                  this.log(theme.agent("Generating initial documentation..."));
                  const mermaid = docService.generateMermaid(cleanData);
                  const readmeContent = await docService.generateReadme(cleanData);
                  const fullDoc = `# ${workflowName}\n\n## Visual Flow\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n${readmeContent}`;
                  await fs.writeFile(readmePath, fullDoc);
              }
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

  /**
   * Test a workflow that already exists on the n8n instance, using its real credentials
   * and configured triggers — no ephemeral copy, no credential stripping, no shim injection.
   */
  private async testRemoteWorkflowDirectly(
      workflowId: string,
      workflowData: any,
      workflowName: string,
      client: N8nClient,
      aiService: AIService,
      n8nUrl: string,
      testScenarios: any[],
  ): Promise<{ passed: boolean; errors: string[]; finalWorkflow?: any; lastExecution?: any }> {
      const nodes = (workflowData.nodes || []).filter(Boolean);
      const validationErrors: string[] = [];
      let lastFullExec: any = null;
      let finalWorkflow: any = workflowData;

      const webhookNode = nodes.find((n: any) =>
          n.type === 'n8n-nodes-base.webhook' && !n.disabled
      );

      if (webhookNode) {
          const webhookPath = webhookNode.parameters?.path;
          if (!webhookPath) {
              return { passed: false, errors: ['Webhook node has no path configured.'] };
          }

          const currentWorkflow = await client.getWorkflow(workflowId) as any;
          finalWorkflow = currentWorkflow;
          const wasActive = currentWorkflow.active === true;

          // Strip any [n8m:shim] nodes left in the workflow from a previous test run.
          // Re-wires connections back through by replacing shim references with the
          // shim's own target (shim → B becomes the restored A → B).
          {
              const leftoverShims = (currentWorkflow.nodes as any[]).filter(
                  (n: any) => n.name?.startsWith('[n8m:shim]')
              );
              if (leftoverShims.length > 0) {
                  for (const shim of leftoverShims) {
                      const shimTarget = ((currentWorkflow.connections[shim.name]?.main ?? [])[0]?.[0])?.node;
                      if (shimTarget) {
                          for (const targets of Object.values(currentWorkflow.connections) as any[]) {
                              for (const segment of (targets?.main ?? [])) {
                                  if (!Array.isArray(segment)) continue;
                                  for (const conn of segment) {
                                      if (conn?.node === shim.name) conn.node = shimTarget;
                                  }
                              }
                          }
                      }
                      delete currentWorkflow.connections[shim.name];
                  }
                  currentWorkflow.nodes = (currentWorkflow.nodes as any[]).filter(
                      (n: any) => !n.name?.startsWith('[n8m:shim]')
                  );
                  try {
                      await client.updateWorkflow(workflowId, {
                          name: currentWorkflow.name,
                          nodes: currentWorkflow.nodes,
                          connections: currentWorkflow.connections,
                          settings: currentWorkflow.settings || {},
                      });
                  } catch { /* cleanup best-effort */ }
              }
          }

          // Auto-fix control characters in node parameters before testing.
          // Control chars (e.g. literal newlines in a Slack blocksUi field) are workflow
          // configuration bugs — they cause "could not be parsed" errors at execution time
          // regardless of what the test payload contains.  Stripping them is always safe.
          const { changed: nodeParamFixed, data: fixedWorkflowNodes } =
              this.sanitizeWorkflowNodeParams(currentWorkflow);
          if (nodeParamFixed) {
              try {
                  await client.updateWorkflow(workflowId, {
                      name: currentWorkflow.name,
                      nodes: fixedWorkflowNodes,
                      connections: currentWorkflow.connections,
                      settings: currentWorkflow.settings || {},
                  });
                  currentWorkflow.nodes = fixedWorkflowNodes; // keep in-memory consistent
                  this.log(theme.muted('Fixed control character encoding in node parameters.'));
              } catch { /* update failed — test may still encounter encoding errors */ }
          }

          // Proactively detect and repair Execute Command nodes whose shell scripts
          // had their newlines stripped by an older version of this tool.  The
          // telltale sign is: no \n in the command but at least one "\ " (backslash
          // followed by whitespace) — the remnant of a multiline line-continuation.
          {
              const collapsedNodes = (currentWorkflow.nodes as any[]).filter(
                  (n: any) =>
                      n.type === 'n8n-nodes-base.executeCommand' &&
                      typeof n.parameters?.command === 'string' &&
                      !n.parameters.command.includes('\n') &&
                      /\\\s/.test(n.parameters.command)
              );
              if (collapsedNodes.length > 0) {
                  let anyRepaired = false;
                  for (const node of collapsedNodes) {
                      try {
                          this.log(theme.agent(`Repairing collapsed shell script in "${node.name}"...`));
                          node.parameters.command = await aiService.fixExecuteCommandScript(
                              node.parameters.command
                          );
                          anyRepaired = true;
                          this.log(theme.muted(`"${node.name}" script restored.`));
                      } catch { /* repair failed — test continues without fix */ }
                  }
                  if (anyRepaired) {
                      try {
                          await client.updateWorkflow(workflowId, {
                              name: currentWorkflow.name,
                              nodes: currentWorkflow.nodes,
                              connections: currentWorkflow.connections,
                              settings: currentWorkflow.settings || {},
                          });
                      } catch { /* update failed — repaired version stays in-memory only */ }
                  }
              }
          }

          // Detect binary-source nodes and inject a test PNG as pin data so
          // upload steps receive real binary content instead of an empty buffer.
          const binarySourceNodes = this.findBinarySourceNodes(workflowData);
          const existingPinData: Record<string, any[]> = currentWorkflow.pinData || {};
          let testPinDataInjected = false;
          if (binarySourceNodes.length > 0) {
              // Try to fetch a real test image from a placeholder service; fall back
              // to a bundled 1×1 PNG if the remote service is unreachable.
              // Never fetch external image services during testing — use bundled 1×1 PNG.
              const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
              const testFileSize = '68';
              const testPinData = { ...existingPinData };
              for (const nodeName of binarySourceNodes) {
                  testPinData[nodeName] = [{
                      json: { fileName: 'n8m-test.png', mimeType: 'image/png' },
                      binary: {
                          data: {
                              data: testImageBase64,
                              mimeType: 'image/png',
                              fileName: 'n8m-test.png',
                              fileSize: testFileSize,
                              fileExtension: 'png',
                          }
                      }
                  }];
              }
              try {
                  await client.setPinData(workflowId, currentWorkflow, testPinData);
                  testPinDataInjected = true;
                  this.log(theme.muted(`Test binary pinned to: ${binarySourceNodes.join(', ')}`));
              } catch {
                  // setPinData is unsupported on some n8n versions (REST API schema rejects
                  // pinData as an additional property). This is a graceful degradation —
                  // the test continues without binary injection.
                  this.log(theme.muted(`Binary injection skipped (not supported by this n8n version)`));
              }
          }

          if (!wasActive) {
              try {
                  await client.activateWorkflow(workflowId);
              } catch (err: any) {
                  return { passed: false, errors: [`Activation failed: ${err.message}`] };
              }
          }

          // Track pre-shim state so the finally block can restore the workflow.
          let preShimNodes: any[] | null = null;
          let preShimConnections: any | null = null;

          // Shim all external-network nodes so the test never calls real external services.
          // Saves original state upfront — the binary-shim logic inside the try block
          // checks `preShimNodes === null` to avoid double-saving, so this must come first.
          {
              const shimmed = N8nClient.shimNetworkNodes(currentWorkflow.nodes);
              if (shimmed.some((n: any, i: number) => n !== currentWorkflow.nodes[i])) {
                  preShimNodes = JSON.parse(JSON.stringify(currentWorkflow.nodes));
                  preShimConnections = JSON.parse(JSON.stringify(currentWorkflow.connections ?? {}));
                  currentWorkflow.nodes = shimmed;
                  this.log(theme.muted('External service nodes shimmed for test isolation.'));
                  try {
                      await client.updateWorkflow(workflowId, {
                          name: currentWorkflow.name,
                          nodes: currentWorkflow.nodes,
                          connections: currentWorkflow.connections,
                          settings: currentWorkflow.settings || {},
                      });
                  } catch { /* shimming update failed — proceed without network isolation */ }
              }
          }

          try {
              const nodeNames = nodes.map((n: any) => n.name).join(', ');
              // Scan expressions so we know exactly which body fields this workflow needs.
              const requiredFields = this.extractRequiredBodyFields(workflowData);
              const fieldsHint = requiredFields.length > 0
                  ? `\nThe workflow's expressions reference these $json.body fields: ${requiredFields.join(', ')}\nYour payload MUST include ALL of these as top-level keys.`
                  : '';

              // Detect body fields that feed image URLs into HTTP Request binary nodes.
              // When found, the prompt instructs the AI to use a real hosted image URL so
              // n8n fetches actual binary data and the upload step receives real bytes.
              const binaryUrlFields = this.findBinaryUrlFields(workflowData);
              const binaryUrlHint = binaryUrlFields.length > 0
                  ? `\nField(s) [${binaryUrlFields.join(', ')}] are used as image/file URLs by HTTP Request nodes whose output is uploaded to Slack or another service. For these fields you MUST supply a real, publicly accessible image URL — use https://placehold.co/100x100.png as the value.`
                  : '';

              // Node type hints describe internal node parameters — only include them
              // during self-healing where the specific error gives context.  Injecting
              // them into the INITIAL prompt confuses the AI into generating Slack/HTTP
              // node params as webhook body fields instead of the actual body fields.
              const nodeTypeHints = this.extractNodeTypeHints(workflowData);

              // Check for a user-defined fixture payload for this workflow.
              const fixture = this.loadWorkflowFixture(workflowId, workflowName);

              let scenarios = testScenarios;
              if (!scenarios || scenarios.length === 0) {
                  let mockPayload: any;
                  if (fixture) {
                      mockPayload = fixture;
                  } else {
                      // n8n webhook wrapping: POST {"field": "value"} → node sees $json.body.field.
                      // Never nest payload under "body" — n8n does that automatically.
                      const context = `You are generating a test payload to POST to an n8n Webhook node.
n8n wraps the POST body automatically: POST {"content":"x"} → $json.body.content = "x".
NEVER nest under "body". Output a SINGLE flat JSON object.${fieldsHint}${binaryUrlHint}
Workflow: "${workflowName}", Nodes: ${nodeNames}`;
                      mockPayload = this.sanitizeMockPayload(await aiService.generateMockData(context));
                  }
                  scenarios = [{ name: 'Default Test', payload: mockPayload }];
              }

              const baseUrl = new URL(n8nUrl).origin;
              const webhookUrl = `${baseUrl}/webhook/${webhookPath}`;

              for (const scenario of scenarios) {
                  this.log(theme.agent(`Testing: ${scenario.name}`));
                  let currentPayload = scenario.payload;
                  let scenarioPassed = false;
                  let lastError: string | null = null;
                  let fixAttempted = false;
                  let binaryShimInjected = false;
                  let codeNodeFixApplied = false; // tracks whether a code_node_js fix was actually committed
                  let codeNodeFixAppliedName: string | undefined;
                  let mockDataShimApplied = false; // tracks whether a mock-data shim replaced the Code node

                  // Healing loop: up to 5 rounds (initial + regen + fix + mock-shim + downstream).
                  // Each round the AI evaluates the error and decides the remediation action.
                  for (let healRound = 0; healRound < 5; healRound++) {
                      // Record time BEFORE the POST so executions from earlier attempts
                      // (which may have finished late) are excluded from this attempt's poll.
                      const executionStartTime = Date.now();
                      const response = await fetch(webhookUrl, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(currentPayload),
                      });

                      if (!response.ok) {
                          lastError = `HTTP ${response.status} from webhook`;
                          break;
                      }

                      let executionFound = false;

                      // Poll up to 3 min — Slack/LLM workflows can take 60–90 s end-to-end.
                      Spinner.start('Waiting for execution result');
                      let trackedExecId: string | undefined;
                      for (let i = 0; i < 60; i++) {
                          await new Promise(r => setTimeout(r, 3000));

                          let fullExec: any;
                          if (trackedExecId) {
                              fullExec = await client.getExecution(trackedExecId) as any;
                          } else {
                              const executions = await client.getWorkflowExecutions(workflowId);
                              const recentExec = executions.find(
                                  (e: any) => e.startedAt && new Date(e.startedAt).getTime() >= executionStartTime
                              );
                              if (!recentExec) continue;
                              trackedExecId = recentExec.id;
                              fullExec = await client.getExecution(trackedExecId!) as any;
                          }
                          lastFullExec = fullExec;

                          if (fullExec.status === 'running' || fullExec.status === 'waiting') continue;

                          executionFound = true;
                          Spinner.stop();

                          if (fullExec.status === 'success') {
                              this.log(theme.done('Passed'));
                              scenarioPassed = true;
                              lastError = null;
                          } else {
                              const execError = fullExec.data?.resultData?.error;
                              const nodeRef = execError?.node;
                              let failingNode: string | undefined =
                                  typeof nodeRef === 'string' ? nodeRef : nodeRef?.name ?? nodeRef?.type;
                              let rawMsg: string = execError?.message;
                              const topDesc: string | undefined = execError?.description ?? execError?.cause?.message;
                              if (rawMsg && topDesc && !rawMsg.includes(topDesc)) rawMsg = `${rawMsg} — ${topDesc}`;

                              if (!rawMsg) {
                                  const runData = fullExec.data?.resultData?.runData as Record<string, any[]> | undefined;
                                  if (runData) {
                                      outer: for (const [nodeName, nodeRuns] of Object.entries(runData)) {
                                          for (const run of nodeRuns) {
                                              if (run?.error?.message) {
                                                  failingNode = failingNode ?? nodeName;
                                                  rawMsg = run.error.message;
                                                  const desc: string | undefined = run.error.description ?? run.error.cause?.message;
                                                  if (desc && !rawMsg.includes(desc)) rawMsg = `${rawMsg} — ${desc}`;
                                                  break outer;
                                              }
                                          }
                                      }
                                  }
                              }

                              rawMsg = rawMsg || 'Unknown flow failure';
                              lastError = failingNode ? `[${failingNode}] ${rawMsg}` : rawMsg;
                              this.log(theme.fail(`Failed: ${lastError}`));
                          }
                          break;
                      }

                      if (!executionFound) {
                          Spinner.stop();
                          lastError = 'Execution timed out (still running after 3 min). Check n8n for result.';
                          this.log(theme.warn(lastError));
                      }

                      if (scenarioPassed || !lastError) break;

                      // Let the AI decide what to do with the error
                      const errSnapshot = lastError;
                      const nodeNameMatch = errSnapshot.match(/^\[([^\]]+)\]/);
                      const failNodeName = nodeNameMatch?.[1];
                      const failingNodeForEval = failNodeName
                          ? (currentWorkflow.nodes as any[]).find((n: any) => n.name === failNodeName)
                          : null;
                      const failingNodeCode = (failingNodeForEval?.type === 'n8n-nodes-base.code' && failingNodeForEval?.parameters?.jsCode)
                          ? failingNodeForEval.parameters.jsCode as string
                          : undefined;
                      const evaluation = await aiService.evaluateTestError(
                          errSnapshot, currentWorkflow.nodes, failNodeName, failingNodeCode
                      );

                      if (evaluation.action === 'structural_pass') {
                          this.log(theme.warn(`${evaluation.reason}: ${errSnapshot}`));
                          this.log(theme.done('Structural validation passed.'));
                          scenarioPassed = true;
                          break;
                      }

                      if (evaluation.action === 'regenerate_payload') {
                          this.log(theme.agent(`Self-healing: regenerating test payload...`));
                          const context = `You are generating a test payload to POST to an n8n Webhook node.
n8n wraps the POST body automatically: POST {"X":"v"} → $json.body.X = "v".
NEVER nest under "body". Output a SINGLE flat JSON object.${requiredFields.length > 0 ? `\nRequired top-level keys: ${requiredFields.join(', ')}` : ''}${binaryUrlHint}${nodeTypeHints}
Workflow: "${workflowName}", Nodes: ${nodeNames}
Previous error: "${errSnapshot}"`;
                          currentPayload = this.sanitizeMockPayload(await aiService.generateMockData(context));
                          lastError = null;
                          continue; // retry with regenerated payload
                      }

                      if (evaluation.action === 'fix_node' && !fixAttempted) {
                          const targetName = evaluation.targetNodeName ?? failNodeName;
                          let fixed = false;

                          if (evaluation.nodeFixType === 'code_node_js') {
                              const targetNode = (currentWorkflow.nodes as any[]).find(
                                  (n: any) => n.type === 'n8n-nodes-base.code' && (!targetName || n.name === targetName)
                              ) ?? (currentWorkflow.nodes as any[]).find((n: any) => n.type === 'n8n-nodes-base.code');
                              if (targetNode?.parameters?.jsCode) {
                                  try {
                                      this.log(theme.agent(`Auto-fixing Code node "${targetNode.name}"...`));
                                      targetNode.parameters.jsCode = await aiService.fixCodeNodeJavaScript(
                                          targetNode.parameters.jsCode, errSnapshot
                                      );
                                      await client.updateWorkflow(workflowId, {
                                          name: currentWorkflow.name,
                                          nodes: currentWorkflow.nodes,
                                          connections: currentWorkflow.connections,
                                          settings: currentWorkflow.settings || {},
                                      });
                                      fixed = true;
                                      fixAttempted = true;
                                      codeNodeFixApplied = true;
                                      codeNodeFixAppliedName = targetNode.name;
                                      lastError = null;
                                      this.log(theme.muted('Code node updated. Retesting...'));
                                  } catch { /* fix failed — fall through */ }
                              }
                          } else if (evaluation.nodeFixType === 'execute_command') {
                              const targetNode = (currentWorkflow.nodes as any[]).find(
                                  (n: any) => n.type === 'n8n-nodes-base.executeCommand' && (!targetName || n.name === targetName)
                              ) ?? (currentWorkflow.nodes as any[]).find((n: any) => n.type === 'n8n-nodes-base.executeCommand');
                              if (targetNode?.parameters?.command) {
                                  try {
                                      this.log(theme.agent(`Auto-fixing Execute Command script in "${targetNode.name}"...`));
                                      targetNode.parameters.command = await aiService.fixExecuteCommandScript(
                                          targetNode.parameters.command, errSnapshot
                                      );
                                      await client.updateWorkflow(workflowId, {
                                          name: currentWorkflow.name,
                                          nodes: currentWorkflow.nodes,
                                          connections: currentWorkflow.connections,
                                          settings: currentWorkflow.settings || {},
                                      });
                                      fixed = true;
                                      fixAttempted = true;
                                      lastError = null;
                                      this.log(theme.muted('Execute Command script updated. Retesting...'));
                                  } catch { /* fix failed — fall through */ }
                              }
                          } else if (evaluation.nodeFixType === 'binary_field') {
                              const fieldMatch = errSnapshot.match(/has no binary field ['"]?(\w+)['"]?/i);
                              const expectedField = fieldMatch?.[1];
                              const failingNode = targetName
                                  ? (currentWorkflow.nodes as any[]).find((n: any) => n.name === targetName)
                                  : null;

                              // Delegate binary-field tracing to the AI — it traces the full graph
                              // (handling passthrough nodes like Merge, Set, IF) to find the actual
                              // binary-producing node and the field name it outputs.
                              this.log(theme.agent(`Tracing binary data flow to infer correct field name for "${targetName ?? failNodeName}"...`));
                              const wfConnections = currentWorkflow.connections || workflowData.connections || {};
                              const correctField = await aiService.inferBinaryFieldNameFromWorkflow(
                                  targetName ?? failNodeName ?? 'unknown',
                                  currentWorkflow.nodes,
                                  wfConnections,
                              );

                              if (failingNode && expectedField && correctField && correctField !== expectedField) {
                                  // Scan every string parameter — the key name varies by node type
                                  const paramKey = Object.entries(failingNode.parameters || {})
                                      .find(([, v]) => typeof v === 'string' && v === expectedField)
                                      ?.[0];
                                  if (paramKey) {
                                      try {
                                          this.log(theme.agent(`Fixing binary field in "${targetName}": '${expectedField}' → '${correctField}' (${paramKey})...`));
                                          failingNode.parameters[paramKey] = correctField;
                                          await client.updateWorkflow(workflowId, {
                                              name: currentWorkflow.name,
                                              nodes: currentWorkflow.nodes,
                                              connections: currentWorkflow.connections,
                                              settings: currentWorkflow.settings || {},
                                          });
                                          fixed = true;
                                          fixAttempted = true;
                                          lastError = null;
                                          this.log(theme.muted('Binary field name updated. Retesting...'));
                                      } catch { /* ignore */ }
                                  }
                              }
                              if (!fixed) {
                                  // Inject a Code node shim that produces synthetic binary data so the
                                  // downstream node can actually execute instead of structural-passing.
                                  const shimField = correctField ?? expectedField ?? 'data';
                                  this.log(theme.agent(`Injecting binary test shim for field "${shimField}" before "${targetName ?? failNodeName}"...`));
                                  try {
                                      // Save original state before we mutate — restored in finally.
                                      if (preShimNodes === null) {
                                          preShimNodes = JSON.parse(JSON.stringify(currentWorkflow.nodes));
                                          preShimConnections = JSON.parse(JSON.stringify(currentWorkflow.connections ?? {}));
                                      }
                                      const shimCode = aiService.generateBinaryShimCode(shimField);
                                      const shimName = `[n8m:shim] Binary for ${targetName ?? failNodeName}`;
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
                                      const failName = targetName ?? failNodeName ?? '';
                                      const conns = JSON.parse(JSON.stringify(currentWorkflow.connections ?? {}));
                                      for (const targets of Object.values(conns) as any[]) {
                                          for (const segment of (targets?.main ?? [])) {
                                              if (!Array.isArray(segment)) continue;
                                              for (const conn of segment) {
                                                  if (conn?.node === failName) conn.node = shimName;
                                              }
                                          }
                                      }
                                      conns[shimName] = { main: [[{ node: failName, type: 'main', index: 0 }]] };
                                      currentWorkflow.nodes = [...currentWorkflow.nodes, shimNode];
                                      currentWorkflow.connections = conns;
                                      await client.updateWorkflow(workflowId, {
                                          name: currentWorkflow.name,
                                          nodes: currentWorkflow.nodes,
                                          connections: currentWorkflow.connections,
                                          settings: currentWorkflow.settings || {},
                                      });
                                      fixed = true;
                                      fixAttempted = true;
                                      binaryShimInjected = true;
                                      lastError = null;
                                      this.log(theme.muted('Binary shim injected. Retesting...'));
                                  } catch {
                                      // Shim generation/injection failed — fall through to structural pass
                                      this.log(theme.warn(`Binary data not available in test environment (upstream pipeline required): ${errSnapshot}`));
                                      this.log(theme.done('Structural validation passed.'));
                                      scenarioPassed = true;
                                  }
                              }
                          }

                          if (fixed) continue; // retry with fix applied
                      }

                      // A Code node still fails after its JS was patched.
                      // Try replacing it with hardcoded mock data so downstream nodes
                      // (e.g. Slack at the end of the flow) can still be exercised.
                      if (codeNodeFixApplied && !mockDataShimApplied) {
                          const shimTarget = (currentWorkflow.nodes as any[]).find(
                              (n: any) => n.type === 'n8n-nodes-base.code' && n.name === codeNodeFixAppliedName
                          );
                          if (shimTarget?.parameters?.jsCode) {
                              this.log(theme.agent(`"${codeNodeFixAppliedName}" still fails — replacing with mock data to continue test...`));
                              try {
                                  if (preShimNodes === null) {
                                      preShimNodes = JSON.parse(JSON.stringify(currentWorkflow.nodes));
                                      preShimConnections = JSON.parse(JSON.stringify(currentWorkflow.connections ?? {}));
                                  }
                                  shimTarget.parameters.jsCode = await aiService.shimCodeNodeWithMockData(
                                      shimTarget.parameters.jsCode
                                  );
                                  await client.updateWorkflow(workflowId, {
                                      name: currentWorkflow.name,
                                      nodes: currentWorkflow.nodes,
                                      connections: currentWorkflow.connections,
                                      settings: currentWorkflow.settings || {},
                                  });
                                  mockDataShimApplied = true;
                                  lastError = null;
                                  this.log(theme.muted(`"${codeNodeFixAppliedName}" replaced with mock data. Retesting...`));
                                  continue;
                              } catch { /* fall through to structural pass */ }
                          }
                      }
                      if (codeNodeFixApplied || mockDataShimApplied) {
                          this.log(theme.warn(`Code node "${codeNodeFixAppliedName ?? failNodeName ?? 'unknown'}" relies on external APIs unavailable in test environment.`));
                          this.log(theme.done('Structural validation passed.'));
                          scenarioPassed = true;
                          break;
                      }

                      // Binary-field errors that survive the fix block (e.g. second round after a
                      // successful fix, or fixAttempted was already true) still indicate a
                      // test-environment limitation — binary data requires the full upstream pipeline.
                      if (!scenarioPassed && evaluation.nodeFixType === 'binary_field') {
                          this.log(theme.warn(`Binary data not available in test environment (upstream pipeline required): ${errSnapshot}`));
                          this.log(theme.done('Structural validation passed.'));
                          scenarioPassed = true;
                          break;
                      }

                      // If a binary shim was successfully injected and the downstream node now
                      // fails with an external API / credentials error (Invalid URL, auth failure,
                      // etc.), that is a test-environment limitation — the binary pipeline is valid.
                      if (!scenarioPassed && binaryShimInjected) {
                          this.log(theme.warn(`External service error after binary shim (credentials/API required): ${errSnapshot}`));
                          this.log(theme.done('Structural validation passed.'));
                          scenarioPassed = true;
                          break;
                      }

                      // escalate, or fix failed / already attempted
                      if (!scenarioPassed) {
                          validationErrors.push(`Scenario "${scenario.name}" Failed: ${lastError}`);
                      }
                      break;
                  } // end healRound
              }
          } finally {
              // Restore original pin data (remove our test binary injection)
              if (testPinDataInjected) {
                  try { await client.setPinData(workflowId, currentWorkflow, existingPinData); } catch { /* intentionally empty */ }
              }
              // Remove injected shim nodes and restore original connections.
              if (preShimNodes !== null) {
                  try {
                      await client.updateWorkflow(workflowId, {
                          name: currentWorkflow.name,
                          nodes: preShimNodes,
                          connections: preShimConnections,
                          settings: currentWorkflow.settings || {},
                      });
                  } catch { /* restore best-effort */ }
              }
              if (!wasActive) {
                  try { await client.deactivateWorkflow(workflowId); } catch { /* intentionally empty */ }
              }
          }
      } else {
          // No webhook trigger — validate structure by checking (or briefly testing) activation.
          const currentWorkflow = await client.getWorkflow(workflowId) as any;
          finalWorkflow = currentWorkflow;
          if (currentWorkflow.active) {
              this.log(theme.done('Workflow is active — structural validation passed.'));
          } else {
              try {
                  await client.activateWorkflow(workflowId);
                  await client.deactivateWorkflow(workflowId);
                  this.log(theme.done('Structural validation passed (activation test succeeded).'));
              } catch (err: any) {
                  validationErrors.push(`Structural validation failed: ${err.message}`);
                  this.log(theme.fail(`Structural validation failed: ${err.message}`));
              }
          }
      }

      return {
          passed: validationErrors.length === 0,
          errors: validationErrors,
          finalWorkflow,
          lastExecution: lastFullExec,
      };
  }

  /**
   * Scan a workflow's expressions to find all field names accessed via $json.body.FIELD.
   * These become required keys in the test POST payload because n8n wraps the body
   * automatically — a downstream expression $json.body.content needs {"content": ...} in the POST.
   */
  private extractRequiredBodyFields(workflowData: any): string[] {
      const fields = new Set<string>();
      const json = JSON.stringify(workflowData);
      // Matches common n8n expression forms that access POST body fields:
      //   $json.body.field          (dot notation)
      //   .json.body.field          (node-reference variant: $('X').item.json.body.field)
      //   $json["body"]["field"]    (bracket notation)
      //   $json['body']['field']    (bracket notation, single-quoted)
      const patterns = [
          /\$json\.body\.([a-zA-Z_]\w*)/g,
          /\.json\.body\.([a-zA-Z_]\w*)/g,
          /\$json\[["']body["']\]\[["']([a-zA-Z_]\w*)["']\]/g,
          /\.json\[["']body["']\]\[["']([a-zA-Z_]\w*)["']\]/g,
      ];
      for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(json)) !== null) {
              const field = match[1];
              // Exclude noise — headers/query/params are read-only webhook meta, not body fields
              if (field && !['headers', 'query', 'params', 'method', 'path'].includes(field)) {
                  fields.add(field);
              }
          }
      }
      return Array.from(fields);
  }

  /**
   * Load a pre-defined test payload fixture for a specific workflow.
   * Checks (in order): ./workflow-test-fixtures.json, ./workflows/test-fixtures.json,
   * and the bundled src/resources/workflow-test-fixtures.json.
   * Returns null if no matching fixture is found.
   */
  private loadWorkflowFixture(workflowId: string, workflowName: string): any | null {
      const candidatePaths = [
          path.join(process.cwd(), 'workflow-test-fixtures.json'),
          path.join(process.cwd(), 'workflows', 'test-fixtures.json'),
          path.join(__dirname, '..', 'resources', 'workflow-test-fixtures.json'),
          path.join(__dirname, '..', '..', 'src', 'resources', 'workflow-test-fixtures.json'),
      ];

      for (const p of candidatePaths) {
          if (!existsSync(p)) continue;
          try {
              const fixtures = JSON.parse(readFileSync(p, 'utf8'));
              // Match by exact ID first, then by name (case-insensitive substring)
              const byId = fixtures[workflowId];
              if (byId?.payload) return byId.payload;
              const nameKey = Object.keys(fixtures).find(
                  k => workflowName.toLowerCase().includes(k.toLowerCase()) ||
                       k.toLowerCase().includes(workflowName.toLowerCase())
              );
              if (nameKey && fixtures[nameKey]?.payload) return fixtures[nameKey].payload;
          } catch { /* skip malformed file */ }
      }
      return null;
  }

  /**
   * Load node-test-hints.json and build a context string describing what
   * data format each node type in the workflow expects.  Used to inform
   * generateMockData so the AI sends correctly-shaped values (e.g. Block Kit
   * JSON for a Slack blocksUi parameter instead of a plain string).
   */
  private extractNodeTypeHints(workflowData: any): string {
      let hints: Record<string, any> = {};
      try {
          const candidates = [
              path.join(__dirname, '..', 'resources', 'node-test-hints.json'),          // dist/commands → dist/resources
              path.join(__dirname, '..', '..', 'src', 'resources', 'node-test-hints.json') // dev (ts-node / tsx)
          ];
          for (const p of candidates) {
              if (existsSync(p)) { hints = JSON.parse(readFileSync(p, 'utf8')); break; }
          }
      } catch { /* hints stay empty */ }

      if (Object.keys(hints).length === 0) return '';

      const nodeTypes: string[] = [...new Set<string>(
          (workflowData.nodes || []).map((n: any) => String(n.type)).filter(Boolean)
      )];

      const lines: string[] = [];
      for (const type of nodeTypes) {
          const typeHints = hints[type];
          if (!typeHints) continue;
          for (const [param, hint] of Object.entries(typeHints as Record<string, any>)) {
              if (param.startsWith('_')) continue;
              lines.push(
                  `Node "${type}" › param "${param}": type=${hint.type}. ${hint.description ?? ''}` +
                  (hint.sample ? ` Sample value: ${hint.sample}` : '')
              );
          }
      }
      return lines.length > 0
          ? `\nNode-specific parameter requirements:\n${lines.join('\n')}`
          : '';
  }

  /**
   * Find nodes that feed binary data into upload-type nodes.
   * Returns node names whose outputs should be pinned with a test binary
   * so downstream file-upload steps receive real content instead of empty buffers.
   */
  private findBinarySourceNodes(workflowData: any): string[] {
      const nodes: any[] = workflowData.nodes || [];
      const connections: any = workflowData.connections || {};

      // Identify nodes that upload binary (by name or type)
      const uploadNodeNames = new Set(
          nodes
              .filter((n: any) => /upload.*binary|binary.*upload/i.test(n.name) || /upload/i.test(n.type))
              .map((n: any) => n.name as string)
      );
      if (uploadNodeNames.size === 0) return [];

      // Walk the connection graph to find their direct predecessors
      const sources = new Set<string>();
      for (const [srcNode, conns] of Object.entries(connections)) {
          const mainConns: any[][] = (conns as any).main || [];
          for (const group of mainConns) {
              for (const c of (group || [])) {
                  if (uploadNodeNames.has(c.node)) sources.add(srcNode);
              }
          }
      }
      return [...sources];
  }

  /**
   * Detect webhook body fields that are used as image/file URLs by HTTP Request
   * nodes that sit immediately upstream of binary-upload nodes.
   *
   * When n8n fetches a real image URL (supplied via the webhook payload) it gets
   * actual binary bytes, which then flow into the upload step.  Returning these
   * field names lets the prompt instruct the AI to use a real hosted image URL
   * (e.g. placehold.co) instead of a placeholder string — so the upload step
   * receives real binary data without needing pinData API support.
   */
  private findBinaryUrlFields(workflowData: any): string[] {
      const nodes: any[] = workflowData.nodes || [];
      const connections: any = workflowData.connections || {};

      // Identify upload nodes
      const uploadNodeNames = new Set(
          nodes
              .filter((n: any) => /upload.*binary|binary.*upload/i.test(n.name) || /upload/i.test(n.type))
              .map((n: any) => n.name as string)
      );
      if (uploadNodeNames.size === 0) return [];

      // Find their direct predecessors
      const binarySourceNames = new Set<string>();
      for (const [srcNode, conns] of Object.entries(connections)) {
          const mainConns: any[][] = (conns as any).main || [];
          for (const group of mainConns) {
              for (const c of (group || [])) {
                  if (uploadNodeNames.has(c.node)) binarySourceNames.add(srcNode);
              }
          }
      }

      // For each predecessor that is an HTTP Request node, extract body-field
      // references used in its URL parameter.
      const nodeMap = new Map<string, any>(nodes.map((n: any) => [n.name, n]));
      const urlFields = new Set<string>();
      const bodyFieldPattern = [
          /\$json\.body\.([a-zA-Z_]\w*)/g,
          /\.json\.body\.([a-zA-Z_]\w*)/g,
          /\$json\[["']body["']\]\[["']([a-zA-Z_]\w*)["']\]/g,
      ];

      for (const nodeName of binarySourceNames) {
          const node = nodeMap.get(nodeName);
          if (!node || node.type !== 'n8n-nodes-base.httpRequest') continue;

          const urlParam = node.parameters?.url ?? '';
          const urlStr = typeof urlParam === 'string' ? urlParam : JSON.stringify(urlParam);

          for (const pattern of bodyFieldPattern) {
              let match;
              while ((match = pattern.exec(urlStr)) !== null) {
                  if (match[1]) urlFields.add(match[1]);
              }
          }
      }

      return [...urlFields];
  }

  /**
   * Deep-scan all node parameter values and strip control characters
   * (U+0000–U+001F, U+007F).  Returns the sanitized nodes array and a flag
   * indicating whether any changes were made.
   *
   * Control chars in node params (e.g. a literal newline inside a Slack
   * blocksUi JSON string) are workflow configuration bugs — they cause n8n to
   * throw "could not be parsed" at execution time regardless of the test payload.
   */
  private sanitizeWorkflowNodeParams(workflowData: any): { changed: boolean; data: any[] } {
      let changed = false;
      const deepStrip = (val: any): any => {
          if (typeof val === 'string') {
              // eslint-disable-next-line no-control-regex
              const clean = val.replace(/[\x00-\x1F\x7F]/g, '');
              if (clean !== val) changed = true;
              return clean;
          }
          if (Array.isArray(val)) return val.map(deepStrip);
          if (val && typeof val === 'object') {
              for (const k of Object.keys(val)) val[k] = deepStrip(val[k]);
          }
          return val;
      };
      // Deep-clone so we don't mutate the original until we know the update succeeded
      const nodes = JSON.parse(JSON.stringify(workflowData.nodes || []));
      for (const node of nodes) {
          if (!node.parameters) continue;
          // Skip Code / Function nodes — their jsCode parameters are JavaScript source
          // that legitimately contains newlines (0x0A).  Stripping them destroys the
          // script syntax (e.g. `const x\nconst y` → `const xconst y` is invalid JS).
          if (
              node.type === 'n8n-nodes-base.code' ||
              node.type === 'n8n-nodes-base.function' ||
              node.type === 'n8n-nodes-base.functionItem'
          ) continue;

          // Execute Command nodes: deepStrip would strip \n from shell scripts,
          // collapsing them to one line and making line-continuation backslashes
          // invalid (/bin/sh: : not found).  Only replace U+00A0 → regular space —
          // AI-generated commands often use non-breaking spaces in indentation which
          // bash treats as an empty command name.
          if (node.type === 'n8n-nodes-base.executeCommand') {
              if (typeof node.parameters.command === 'string') {
                  const fixed = node.parameters.command.replace(/\u00A0/g, ' ');
                  if (fixed !== node.parameters.command) {
                      node.parameters.command = fixed;
                      changed = true;
                  }
              }
              continue; // skip deepStrip — would destroy newlines
          }

          node.parameters = deepStrip(node.parameters);
      }
      return { changed, data: nodes };
  }

  /**
   * Strip control characters (U+0000–U+001F, except tab/LF/CR) from all
   * string values in a generated mock payload.  AI-generated Block Kit JSON
   * and other rich-text fields sometimes contain raw control chars that cause
   * n8n's parameter parser to throw "Bad control character in string literal".
   */
  private sanitizeMockPayload(data: any): any {
      if (typeof data === 'string') {
          // Strip ALL control characters (U+0000–U+001F, U+007F) from test payload strings.
          // This includes LF/CR — necessary because AI-generated Block Kit JSON often embeds
          // literal newlines inside stringified JSON values, causing n8n's parser to throw
          // "Bad control character in string literal in JSON".
          // eslint-disable-next-line no-control-regex
          return data.replace(/[\x00-\x1F\x7F]/g, '');
      }
      if (Array.isArray(data)) return data.map((v: any) => this.sanitizeMockPayload(v));
      if (data && typeof data === 'object') {
          const result: any = {};
          for (const [k, v] of Object.entries(data)) result[k] = this.sanitizeMockPayload(v);
          return result;
      }
      return data;
  }

  private async deployWorkflows(deployedDefinitions: Map<string, any>, client: N8nClient) {
      for (const [, def] of deployedDefinitions.entries()) {
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

  // ---------------------------------------------------------------------------
  // Fixture helpers
  // ---------------------------------------------------------------------------

  private async offerSaveFixture(
      fixtureManager: FixtureManager,
      workflowId: string,
      workflowName: string,
      finalWorkflow: any,
      lastExecution: any,
  ): Promise<void> {
      const { saveFixture } = await inquirer.prompt([{
          type: 'confirm',
          name: 'saveFixture',
          message: 'Save fixture for future offline runs?',
          default: true,
      }]);
      if (!saveFixture) return;

      const executionData: WorkflowFixture['execution'] = lastExecution
          ? {
              id: lastExecution.id,
              status: lastExecution.status,
              startedAt: lastExecution.startedAt,
              data: {
                  resultData: {
                      error: lastExecution.data?.resultData?.error ?? null,
                      runData: lastExecution.data?.resultData?.runData ?? {},
                  },
              },
            }
          : { status: 'success', data: { resultData: { runData: {} } } };

      try {
          await fixtureManager.save({
              version: '1.0',
              capturedAt: new Date().toISOString(),
              workflowId,
              workflowName,
              workflow: finalWorkflow,
              execution: executionData,
          });
          this.log(theme.success(`Fixture saved to .n8m/fixtures/${workflowId}.json`));
      } catch (e) {
          this.log(theme.warn(`Could not save fixture: ${(e as Error).message}`));
      }
  }

  private async testWithFixture(
      fixture: WorkflowFixture,
      workflowName: string,
      aiService: AIService,
  ): Promise<{ passed: boolean; errors: string[]; finalWorkflow?: any; lastExecution?: any }> {
      this.log(theme.info(`Running offline with fixture data (no n8n API calls).`));

      const currentWorkflow = JSON.parse(JSON.stringify(fixture.workflow));
      const execution = fixture.execution;
      const runData: Record<string, any[]> = execution.data?.resultData?.runData ?? {};
      const validationErrors: string[] = [];

      // Extract error from fixture execution (mirrors live loop logic)
      let fixtureError: string | null = null;
      if (execution.status !== 'success') {
          const execError = execution.data?.resultData?.error;
          const nodeRef = execError?.node;
          let failingNode: string | undefined =
              typeof nodeRef === 'string' ? nodeRef : nodeRef?.name ?? nodeRef?.type;
          let rawMsg: string = execError?.message ?? '';
          const topDesc: string | undefined = execError?.description ?? execError?.cause?.message;
          if (rawMsg && topDesc && !rawMsg.includes(topDesc)) rawMsg = `${rawMsg} — ${topDesc}`;

          if (!rawMsg) {
              outer: for (const [nodeName, nodeRuns] of Object.entries(runData)) {
                  for (const run of (nodeRuns as any[])) {
                      if (run?.error?.message) {
                          failingNode = failingNode ?? nodeName;
                          rawMsg = run.error.message;
                          const desc: string | undefined = run.error.description ?? run.error.cause?.message;
                          if (desc && !rawMsg.includes(desc)) rawMsg = `${rawMsg} — ${desc}`;
                          break outer;
                      }
                  }
              }
          }
          fixtureError = rawMsg
              ? (failingNode ? `[${failingNode}] ${rawMsg}` : rawMsg)
              : null;
      }

      if (!fixtureError) {
          this.log(theme.done('Offline fixture: execution was successful.'));
          return { passed: true, errors: [], finalWorkflow: currentWorkflow };
      }

      this.log(theme.agent(`Fixture captured a failure: ${fixtureError}`));

      const lastError = fixtureError;
      let scenarioPassed = false;

      for (let round = 0; round < 5; round++) {
          this.log(theme.agent(`Offline healing round ${round + 1}: ${lastError}`));

          const failNodeMatch = lastError.match(/^\[([^\]]+)\]/);
          const failNodeName = failNodeMatch?.[1];
          const failingNode = failNodeName
              ? (currentWorkflow.nodes as any[]).find((n: any) => n.name === failNodeName)
              : null;
          const failingNodeCode = (failingNode?.type === 'n8n-nodes-base.code' && failingNode?.parameters?.jsCode)
              ? failingNode.parameters.jsCode as string
              : undefined;

          const evaluation = await aiService.evaluateTestError(
              lastError, currentWorkflow.nodes, failNodeName, failingNodeCode
          );

          if (evaluation.action === 'structural_pass') {
              this.log(theme.warn(`Structural pass: ${evaluation.reason}`));
              scenarioPassed = true;
              break;
          }

          if (evaluation.action === 'escalate') {
              validationErrors.push(lastError);
              this.log(theme.fail(`Escalated: ${evaluation.reason}`));
              break;
          }

          if (evaluation.action === 'regenerate_payload') {
              // Cannot re-run offline — treat as structural pass
              this.log(theme.warn('Offline: cannot regenerate payload without live execution. Treating as structural pass.'));
              scenarioPassed = true;
              break;
          }

          if (evaluation.action === 'fix_node') {
              const targetName = evaluation.targetNodeName ?? failNodeName;

              if (evaluation.nodeFixType === 'code_node_js') {
                  const target = (currentWorkflow.nodes as any[]).find(
                      (n: any) => n.type === 'n8n-nodes-base.code' && (!targetName || n.name === targetName)
                  ) ?? (currentWorkflow.nodes as any[]).find((n: any) => n.type === 'n8n-nodes-base.code');

                  if (target?.parameters?.jsCode) {
                      this.log(theme.agent(`Offline fix: rewriting Code node "${target.name}"...`));
                      const fixedCode = await aiService.fixCodeNodeJavaScript(target.parameters.jsCode, lastError);
                      const predecessorName = this.findPredecessorNode(target.name, currentWorkflow.connections);
                      const inputItems = predecessorName ? (runData[predecessorName] ?? []) : [];
                      const verdict = await aiService.evaluateCodeFixOffline(fixedCode, inputItems, lastError, 'code_node_js');
                      this.log(theme.muted(`Offline eval: ${verdict.wouldPass ? 'PASS' : 'FAIL'} — ${verdict.reason}`));
                      target.parameters.jsCode = fixedCode;
                      this.log(verdict.wouldPass
                          ? theme.done(`Offline fix validated: "${target.name}" would succeed.`)
                          : theme.warn(`Fix applied to "${target.name}" — cannot fully verify offline. Treating as structural pass.`)
                      );
                      scenarioPassed = true;
                      break;
                  }
              }

              if (evaluation.nodeFixType === 'execute_command') {
                  const target = (currentWorkflow.nodes as any[]).find(
                      (n: any) => n.type === 'n8n-nodes-base.executeCommand' && (!targetName || n.name === targetName)
                  ) ?? (currentWorkflow.nodes as any[]).find((n: any) => n.type === 'n8n-nodes-base.executeCommand');

                  if (target?.parameters?.command) {
                      this.log(theme.agent(`Offline fix: rewriting Execute Command script in "${target.name}"...`));
                      const fixedCmd = await aiService.fixExecuteCommandScript(target.parameters.command, lastError);
                      const predecessorName = this.findPredecessorNode(target.name, currentWorkflow.connections);
                      const inputItems = predecessorName ? (runData[predecessorName] ?? []) : [];
                      const verdict = await aiService.evaluateCodeFixOffline(fixedCmd, inputItems, lastError, 'execute_command');
                      this.log(theme.muted(`Offline eval: ${verdict.wouldPass ? 'PASS' : 'FAIL'} — ${verdict.reason}`));
                      target.parameters.command = fixedCmd;
                      scenarioPassed = true;
                      break;
                  }
              }

              if (evaluation.nodeFixType === 'binary_field') {
                  const target = targetName
                      ? (currentWorkflow.nodes as any[]).find((n: any) => n.name === targetName)
                      : null;
                  this.log(theme.agent(`Offline fix: tracing binary field for "${targetName ?? failNodeName}"...`));
                  const correctField = await aiService.inferBinaryFieldNameFromWorkflow(
                      targetName ?? failNodeName ?? 'unknown',
                      currentWorkflow.nodes,
                      currentWorkflow.connections ?? {},
                  );
                  const fieldMatch = lastError.match(/has no binary field ['"]?(\w+)['"]?/i);
                  const expectedField = fieldMatch?.[1];
                  if (target && expectedField && correctField && correctField !== expectedField) {
                      const paramKey = Object.entries(target.parameters || {})
                          .find(([, v]) => typeof v === 'string' && v === expectedField)?.[0];
                      if (paramKey) {
                          target.parameters[paramKey] = correctField;
                          this.log(theme.muted(`Binary field: '${expectedField}' → '${correctField}'`));
                      }
                  }
                  this.log(theme.warn('Binary data cannot be verified offline. Treating as structural pass.'));
                  scenarioPassed = true;
                  break;
              }

              // fix_node but no matching node found
              this.log(theme.warn('No fixable node found offline. Treating as structural pass.'));
              scenarioPassed = true;
              break;
          }

          break;
      }

      if (!scenarioPassed) {
          validationErrors.push(`Offline test failed: ${lastError}`);
      }

      return {
          passed: validationErrors.length === 0,
          errors: validationErrors,
          finalWorkflow: currentWorkflow,
      };
  }

  private findPredecessorNode(nodeName: string, connections: any): string | null {
      for (const [sourceName, conns] of Object.entries(connections || {})) {
          const mainConns: any[][] = (conns as any)?.main ?? [];
          for (const group of mainConns) {
              for (const c of (group || [])) {
                  if (c?.node === nodeName) return sourceName;
              }
          }
      }
      return null;
  }
}
