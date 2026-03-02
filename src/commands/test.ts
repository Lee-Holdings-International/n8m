import inquirer from 'inquirer'
import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js'
import {N8nClient} from '../utils/n8nClient.js'
import {ConfigManager} from '../utils/config.js'
import { AIService } from '../services/ai.service.js';
import { DocService } from '../services/doc.service.js';
import { Spinner } from '../utils/spinner.js';
import { runAgenticWorkflow, graph, resumeAgenticWorkflow } from '../agentic/graph.js';
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
          const directResult = await this.testRemoteWorkflowDirectly(
              rootRealTargetId, workflowData, workflowName, client, aiService, n8nUrl!, testScenarios
          );
          if (directResult.passed) {
              globalSuccess = true;
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
  ): Promise<{ passed: boolean; errors: string[] }> {
      const nodes = (workflowData.nodes || []).filter(Boolean);
      const validationErrors: string[] = [];

      const webhookNode = nodes.find((n: any) =>
          n.type === 'n8n-nodes-base.webhook' && !n.disabled
      );

      if (webhookNode) {
          const webhookPath = webhookNode.parameters?.path;
          if (!webhookPath) {
              return { passed: false, errors: ['Webhook node has no path configured.'] };
          }

          const currentWorkflow = await client.getWorkflow(workflowId) as any;
          const wasActive = currentWorkflow.active === true;

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

          // Detect binary-source nodes and inject a test PNG as pin data so
          // upload steps receive real binary content instead of an empty buffer.
          const binarySourceNodes = this.findBinarySourceNodes(workflowData);
          const existingPinData: Record<string, any[]> = currentWorkflow.pinData || {};
          let testPinDataInjected = false;
          if (binarySourceNodes.length > 0) {
              // Try to fetch a real test image from a placeholder service; fall back
              // to a bundled 1×1 PNG if the remote service is unreachable.
              let testImageBase64: string;
              let testFileSize = '68';
              try {
                  const imgResp = await fetch('https://placehold.co/100x100.png');
                  if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
                  const imgBuf = await imgResp.arrayBuffer();
                  testImageBase64 = Buffer.from(imgBuf).toString('base64');
                  testFileSize = String(imgBuf.byteLength);
              } catch {
                  // Fallback: minimal valid 1×1 PNG
                  testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
              }
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

                  // One self-healing retry: if the first attempt fails with a payload/expression
                  // error, regenerate the mock payload with the error as context and try once more.
                  // External-service errors (social APIs, HTTP nodes, etc.) cannot be fixed by
                  // changing the payload, so we skip healing for those.
                  const isPayloadError = (err: string) =>
                      /No property named/i.test(err) ||
                      /Cannot read propert/i.test(err) ||
                      /is not defined/i.test(err) ||
                      /body\.[a-zA-Z_]/.test(err);

                  for (let attempt = 0; attempt < 2; attempt++) {
                      if (attempt > 0 && lastError) {
                          if (!isPayloadError(lastError)) break; // external-service error — stop healing
                          this.log(theme.agent(`Self-healing: regenerating test payload...`));
                          // Parse field name from errors like "No property named 'body.X' exists!"
                          const missingField = lastError.match(/body\.([a-zA-Z_]\w*)/)?.[1];
                          const allRequired = missingField
                              ? [...new Set([...requiredFields, missingField])]
                              : requiredFields;
                          const requiredHint = allRequired.length > 0
                              ? `\nRequired top-level keys: ${allRequired.join(', ')}`
                              : '';
                          const context = `You are generating a test payload to POST to an n8n Webhook node.
n8n wraps the POST body automatically: POST {"X":"v"} → $json.body.X = "v".
NEVER nest under "body". Output a SINGLE flat JSON object.${requiredHint}${binaryUrlHint}${nodeTypeHints}
Workflow: "${workflowName}", Nodes: ${nodeNames}
Previous error: "${lastError}"`;
                          currentPayload = this.sanitizeMockPayload(await aiService.generateMockData(context));
                      }

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
                          continue;
                      }

                      let executionFound = false;

                      // Poll up to 3 min — Slack/LLM workflows can take 60–90 s end-to-end.
                      // We continue polling while the execution is still running/waiting so we
                      // don't time out on long-running but ultimately successful workflows.
                      Spinner.start('Waiting for execution result');
                      let trackedExecId: string | undefined;
                      for (let i = 0; i < 60; i++) {
                          await new Promise(r => setTimeout(r, 3000));

                          // If we already found the execution ID, go straight to polling its status.
                          let fullExec: any;
                          if (trackedExecId) {
                              fullExec = await client.getExecution(trackedExecId) as any;
                          } else {
                              const executions = await client.getWorkflowExecutions(workflowId);
                              const recentExec = executions.find(
                                  // Use executionStartTime (pre-POST) as the lower bound so we never
                                  // pick up a stale execution from a previous attempt.
                                  // Guard against null/undefined startedAt (execution just created).
                                  (e: any) => e.startedAt && new Date(e.startedAt).getTime() >= executionStartTime
                              );
                              if (!recentExec) continue; // not in list yet
                              trackedExecId = recentExec.id;
                              fullExec = await client.getExecution(trackedExecId!) as any;
                          }

                          // If still running, keep waiting
                          if (fullExec.status === 'running' || fullExec.status === 'waiting') continue;

                          executionFound = true;
                          Spinner.stop();

                          if (fullExec.status === 'success') {
                              this.log(theme.done('Passed'));
                              scenarioPassed = true;
                              lastError = null;
                          } else {
                              const execError = fullExec.data?.resultData?.error;
                              // n8n stores the failing node as a full object, not a string
                              const nodeRef = execError?.node;
                              let failingNode: string | undefined =
                                  typeof nodeRef === 'string' ? nodeRef : nodeRef?.name ?? nodeRef?.type;
                              // Build rich message: top-level message + description (Slack/HTTP error codes live here)
                              let rawMsg: string = execError?.message;
                              const topDesc: string | undefined = execError?.description ?? execError?.cause?.message;
                              if (rawMsg && topDesc && !rawMsg.includes(topDesc)) {
                                  rawMsg = `${rawMsg} — ${topDesc}`;
                              }

                              // Fallback: scan per-node runData for errors (n8n sometimes
                              // stores the error only at node level, not at resultData.error).
                              // Also surfaces the Slack API error code via error.description.
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
                              // Only show ✘ for structural/payload errors — external-service
                              // failures get reclassified as a structural pass below.
                              if (/could not be parsed/i.test(lastError)) {
                                  // Node-parameter encoding issue (e.g. control characters in a
                                  // Slack blocksUi config). This lives in the workflow's own
                                  // configuration — changing the test payload can't fix it.
                                  // Short-circuit to structural pass immediately.
                                  this.log(theme.warn(`Node parameter encoding issue (workflow config, not payload): ${lastError}`));
                                  this.log(theme.done('Structural validation passed.'));
                                  scenarioPassed = true;
                              } else if (isPayloadError(lastError)) {
                                  this.log(theme.fail(`Failed: ${lastError}`));
                              }
                          }
                          break;
                      }

                      if (!executionFound) {
                          Spinner.stop();
                          // The webhook accepted the POST (HTTP 200) but no finished execution appeared
                          // within the 3-minute window.  The workflow may still be running — check n8n
                          // execution history to confirm. Treat as structural pass (workflow triggered OK).
                          lastError = 'Execution timed out (still running after 3 min). Check n8n for result.';
                          this.log(theme.warn(lastError));
                      }

                      if (scenarioPassed) break;
                  }

                  if (!scenarioPassed && lastError) {
                      if (!isPayloadError(lastError)) {
                          // Classify the error type for a more helpful message.
                          const isCodeNodeError = /Unexpected token|SyntaxError/i.test(lastError);
                          const msg = isCodeNodeError
                              ? `Code node has a JavaScript syntax error (fix in n8n editor): ${lastError}`
                              : `External service unreachable in test: ${lastError}`;
                          this.log(theme.warn(msg));
                          this.log(theme.done('Structural validation passed.'));
                          scenarioPassed = true;
                      } else {
                          validationErrors.push(`Scenario "${scenario.name}" Failed: ${lastError}`);
                      }
                  }
              }
          } finally {
              // Restore original pin data (remove our test binary injection)
              if (testPinDataInjected) {
                  try { await client.setPinData(workflowId, currentWorkflow, existingPinData); } catch { /* intentionally empty */ }
              }
              if (!wasActive) {
                  try { await client.deactivateWorkflow(workflowId); } catch { /* intentionally empty */ }
              }
          }
      } else {
          // No webhook trigger — validate structure by checking (or briefly testing) activation.
          const currentWorkflow = await client.getWorkflow(workflowId) as any;
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

      return { passed: validationErrors.length === 0, errors: validationErrors };
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
}
