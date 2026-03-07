import inquirer from 'inquirer'
import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js'
import {N8nClient} from '../utils/n8nClient.js'
import {ConfigManager} from '../utils/config.js'
import { graph, resumeAgenticWorkflow } from '../agentic/graph.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'node:crypto';
import { promptMultiline } from '../utils/multilinePrompt.js';

export default class Modify extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path or Name of the workflow to modify',
      required: false,
    }),
    instruction: Args.string({
      description: 'Modification instructions',
      required: false,
    }),
  }

  static description = 'Modify existing n8n workflows using an AI Agent'

  static flags = {
    multiline: Flags.boolean({
      char: 'm',
      description: 'Open editor for multiline modification instructions',
      default: false,
    }),
    output: Flags.string({
      char: 'o',
      description: 'Path to save the modified workflow JSON (defaults to overwriting if local file)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Modify)
    this.log(theme.brand());
    this.log(theme.header('WORKFLOW MODIFICATION'));

    // 1. Load Credentials & Client
    const config = await ConfigManager.load();
    const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
    const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

    if (!n8nUrl || !n8nKey) {
      this.error('Credentials missing. Configure environment via \'n8m config\'.');
    }

    const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
    
    // 1a. Fetch Valid Node Types
    let validNodeTypes: string[] = [];
    try {
        validNodeTypes = await client.getNodeTypes();
        if (validNodeTypes.length > 0) {
            this.log(theme.muted(`✔ Loaded ${validNodeTypes.length} valid node types for validation.`));
        }
    } catch (e) {
         this.log(theme.warn(`⚠ Failed to fetch node types: ${(e as Error).message}`));
    }

    // 1b. Fetch available credentials for AI guidance
    let availableCredentials: any[] = [];
    try {
        availableCredentials = await client.getCredentials();
        if (availableCredentials.length > 0) {
            this.log(theme.muted(`  Found ${availableCredentials.length} credential(s) — AI will use these for node selection.`));
        }
    } catch {
        // Non-fatal — proceed without credential context
    }

    // 2. Resolve Workflow
    let workflowData: any;
    let workflowName = 'Untitled';
    let originalPath: string | undefined = undefined;
    let remoteId: string | undefined = undefined;

    if (args.workflow && existsSync(args.workflow)) {
        // Direct file path
        originalPath = path.resolve(args.workflow);
        const content = await fs.readFile(originalPath, 'utf-8');
        workflowData = JSON.parse(content);
        workflowName = workflowData.name || path.basename(args.workflow, '.json');
    } else {
        // Selection Logic (similar to test.ts)
        this.log(theme.info('Searching for local and remote workflows...'));
        
        const localChoices: any[] = [];
        const workflowsDir = path.join(process.cwd(), 'workflows');

        const scanDir = async (dir: string, rootDir: string): Promise<void> => {
            let entries;
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await scanDir(fullPath, rootDir);
                } else if (entry.name.endsWith('.json')) {
                    let label = path.relative(rootDir, fullPath);
                    try {
                        const raw = await fs.readFile(fullPath, 'utf-8');
                        const parsed = JSON.parse(raw);
                        if (parsed.name) label = `${parsed.name}  (${label})`;
                    } catch { /* use path as label */ }
                    localChoices.push({
                        name: `${theme.value('[LOCAL]')} ${label}`,
                        value: { type: 'local', path: fullPath }
                    });
                }
            }
        };

        if (existsSync(workflowsDir)) await scanDir(workflowsDir, workflowsDir);

        const remoteWorkflows = await client.getWorkflows();
        const remoteChoices = remoteWorkflows
          .map(w => ({
              name: `${theme.info('[n8n]')} ${w.name} (${w.id}) ${w.active ? '[Active]' : ''}`,
              value: { type: 'remote', id: w.id, data: w }
          }));

        const choices = [
            ...(localChoices.length > 0 ? [new inquirer.Separator('--- Local Files ---'), ...localChoices] : []),
            ...(remoteChoices.length > 0 ? [new inquirer.Separator('--- n8n Instance ---'), ...remoteChoices] : []),
        ];

        if (choices.length === 0) this.error('No workflows found locally or on n8n instance.');

        const { selection } = await inquirer.prompt([{
            type: 'select',
            name: 'selection',
            message: 'Select a workflow to modify:',
            choices,
            pageSize: 15
        }]);

        if (selection.type === 'local') {
            originalPath = selection.path;
            const content = await fs.readFile(originalPath!, 'utf-8');
            workflowData = JSON.parse(content);
            workflowName = workflowData.name || path.basename(originalPath!, '.json');
        } else {
            remoteId = selection.id;
            workflowData = await client.getWorkflow(remoteId!);
            workflowName = (workflowData as any).name || 'Remote Workflow';
        }
    }

    // 3. Get Instruction
    let instruction = args.instruction;

    if (!instruction) {
        instruction = await promptMultiline('Describe the modifications you want to apply (use ``` for multiline): ');
    }

    if (!instruction) {
        this.error('Modification instructions are required.');
    }

    // 4. AGENTIC EXECUTION
    const threadId = randomUUID();
    this.log(theme.info(`\nInitializing Agentic Modification for: "${workflowName}"`));
    
    let lastWorkflowJson: any = workflowData;

    const goal = `Modify the provided workflow based on these instructions: ${instruction}`;
    
    const initialState = {
        userGoal: goal,
        messages: [],
        validationErrors: [],
        workflowJson: workflowData,
        availableNodeTypes: validNodeTypes,
        availableCredentials,
    };

    try {
        const stream = await graph.stream({
            ...initialState,
            revisionCount: 0,
        }, {
            configurable: { thread_id: threadId }
        });

        for await (const event of stream) {
            const nodeName = Object.keys(event)[0];
            const stateUpdate = (event as Record<string, any>)[nodeName];

            if (nodeName === 'architect') {
                this.log(theme.agent(`🏗️  Architect: Modification plan ready.`));
            } else if (nodeName === 'engineer') {
                this.log(theme.agent(`⚙️  Engineer: Applying changes to workflow...`));
                if (stateUpdate.workflowJson) lastWorkflowJson = stateUpdate.workflowJson;
            } else if (nodeName === 'qa') {
                if (stateUpdate.validationStatus === 'passed') {
                    this.log(theme.success(`🧪 QA: Modification Validated.`));
                } else {
                    this.log(theme.fail(`🧪 QA: Validation Issues Found.`));
                    if (stateUpdate.validationErrors?.length) {
                        stateUpdate.validationErrors.forEach((e: string) => this.log(theme.error(`   - ${e}`)));
                    }
                    this.log(theme.warn(`   Looping back for refinements...`));
                }
            }
        }

        // HITL loop — same pattern as create.ts
        let snapshot = await graph.getState({ configurable: { thread_id: threadId } });
        while (snapshot.next.length > 0) {
            const nextNode = snapshot.next[0];

            if (nextNode === 'engineer') {
                const isRepair = (snapshot.values.validationErrors as string[] || []).length > 0;

                if (isRepair) {
                    // Repair iteration — auto-continue
                    const repairStream = await graph.stream(null, { configurable: { thread_id: threadId } });
                    for await (const event of repairStream) {
                        const n = Object.keys(event)[0];
                        const u = (event as Record<string, any>)[n];
                        if (n === 'engineer' && u.workflowJson) lastWorkflowJson = u.workflowJson;
                    }
                } else {
                    // Show modification plan and give options
                    const plan = snapshot.values.spec;
                    if (plan) {
                        this.log(theme.header('\nMODIFICATION PLAN:'));
                        this.log(`  ${theme.value(plan.description || '')}`);
                        if (plan.proposedChanges?.length) {
                            this.log(theme.info('\nProposed Changes:'));
                            (plan.proposedChanges as string[]).forEach(c => this.log(`  ${theme.muted('•')} ${c}`));
                        }
                        if (plan.affectedNodes?.length) {
                            this.log(`\n${theme.label('Affected Nodes')} ${(plan.affectedNodes as string[]).join(', ')}`);
                        }
                        this.log('');
                    }

                    const choices: any[] = [
                        { name: 'Proceed with this plan', value: { type: 'proceed' } },
                        { name: 'Add feedback before modifying', value: { type: 'feedback' } },
                        new inquirer.Separator(),
                        { name: 'Exit (discard)', value: { type: 'exit' } },
                    ];

                    const { choice } = await inquirer.prompt([{
                        type: 'list',
                        name: 'choice',
                        message: 'Blueprint ready. How would you like to proceed?',
                        choices,
                    }]);

                    if (choice.type === 'exit') {
                        this.log(theme.info(`\nSession saved. Resume later with: n8m resume ${threadId}`));
                        return;
                    }

                    let stateUpdate: Record<string, any> = {};
                    if (choice.type === 'feedback') {
                        const { feedback } = await inquirer.prompt([{
                            type: 'input',
                            name: 'feedback',
                            message: 'Describe your refinements:',
                        }]);
                        stateUpdate = { userFeedback: feedback };
                        this.log(theme.agent(`Feedback noted. Applying modifications with your refinements...`));
                    } else {
                        this.log(theme.agent(`⚙️  Engineer: Applying modifications...`));
                    }

                    if (Object.keys(stateUpdate).length > 0) {
                        await graph.updateState({ configurable: { thread_id: threadId } }, stateUpdate);
                    }

                    const engineerStream = await graph.stream(null, { configurable: { thread_id: threadId } });
                    for await (const event of engineerStream) {
                        const n = Object.keys(event)[0];
                        const u = (event as Record<string, any>)[n];
                        if (n === 'engineer' && u.workflowJson) lastWorkflowJson = u.workflowJson;
                        else if (n === 'reviewer' && u.validationStatus === 'failed') {
                            this.log(theme.warn(`   Reviewer flagged issues — Engineer will revise...`));
                        }
                    }
                }

            } else if (nextNode === 'qa') {
                this.log(theme.agent(`⚙️  Running QA validation...`));
                const qaStream = await graph.stream(null, { configurable: { thread_id: threadId } });
                for await (const event of qaStream) {
                    const n = Object.keys(event)[0];
                    const u = (event as Record<string, any>)[n];
                    if (n === 'qa') {
                        if (u.validationStatus === 'passed') {
                            this.log(theme.success(`🧪 QA: Validation Passed.`));
                            if (u.workflowJson) lastWorkflowJson = u.workflowJson;
                        } else {
                            this.log(theme.fail(`🧪 QA: Validation Failed.`));
                            if (u.validationErrors?.length) {
                                (u.validationErrors as string[]).forEach(e => this.log(theme.error(`   - ${e}`)));
                            }
                            this.log(theme.warn(`   Looping back to Engineer for repairs...`));
                        }
                    }
                }

            } else {
                // Unknown interrupt — auto-resume
                const result = await resumeAgenticWorkflow(threadId, null);
                if (result.workflowJson) lastWorkflowJson = result.workflowJson;
            }

            snapshot = await graph.getState({ configurable: { thread_id: threadId } });
        }

    } catch (error) {
        this.error(`Agent encountered an error: ${(error as Error).message}`);
    }

    // 5. POST-MODIFICATION ACTIONS
    const modifiedWorkflow = lastWorkflowJson.workflows ? lastWorkflowJson.workflows[0] : lastWorkflowJson;
    
    // Self-Healing: Ensure settings and staticData exist for API compatibility
    if (!modifiedWorkflow.settings) modifiedWorkflow.settings = { executionOrder: 'v1' };
    if (!modifiedWorkflow.staticData) modifiedWorkflow.staticData = null;
    
    // Preserve ID if it existed in the original and is missing in the new
    if (workflowData.id) {
        modifiedWorkflow.id = workflowData.id;
    }
    
    // Standardize naming
    if (!modifiedWorkflow.name.toLowerCase().includes('modified')) {
        // maybe add a suffix? Or just keep it. 
    }

    // Find an existing local file matching by workflow ID or name
    const findExistingLocalPath = async (): Promise<string | undefined> => {
        const workflowsDir = path.join(process.cwd(), 'workflows');
        const searchId = modifiedWorkflow.id || workflowData.id;
        const searchName = modifiedWorkflow.name || workflowName;
        const search = async (dir: string): Promise<string | undefined> => {
            let entries;
            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return undefined; }
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    const found = await search(fullPath);
                    if (found) return found;
                } else if (entry.name.endsWith('.json')) {
                    try {
                        const parsed = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
                        if ((searchId && parsed.id === searchId) || parsed.name === searchName) return fullPath;
                    } catch { /* skip */ }
                }
            }
        };
        return search(workflowsDir);
    };

    const saveLocally = async (promptPath = true) => {
        const existingPath = originalPath || await findExistingLocalPath();
        const defaultPath = flags.output || existingPath || path.join(process.cwd(), 'workflows', `${workflowName}.json`);
        let targetPath = defaultPath;
        if (promptPath && !existingPath) {
            const { p } = await inquirer.prompt([{
                type: 'input',
                name: 'p',
                message: 'Save modified workflow to:',
                default: defaultPath
            }]);
            targetPath = p;
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, JSON.stringify(modifiedWorkflow, null, 2));
        this.log(theme.success(`✔ Saved to ${targetPath}`));
    };

    const { action } = await inquirer.prompt([{
        type: 'select',
        name: 'action',
        message: 'Modification complete. What would you like to do?',
        choices: [
            { name: 'Deploy to n8n instance (also saves locally)', value: 'deploy' },
            { name: 'Save locally only', value: 'save' },
            { name: 'Run ephemeral test (n8m test)', value: 'test' },
            { name: 'Discard changes', value: 'discard' }
        ]
    }]);

    if (action === 'save') {
        await saveLocally();
    } else if (action === 'deploy') {
        const targetId = remoteId || modifiedWorkflow.id;
        if (targetId) {
            let existsRemotely = false;
            try {
                await client.getWorkflow(targetId);
                existsRemotely = true;
            } catch { /* not found */ }

            if (existsRemotely) {
                this.log(theme.info(`Updating remote workflow ${targetId}...`));
                await client.updateWorkflow(targetId, modifiedWorkflow);
                this.log(theme.success(`✔ Remote workflow updated.`));
                this.log(`${theme.label('Link')} ${theme.secondary(client.getWorkflowLink(targetId))}`);
            } else {
                const result = await client.createWorkflow(modifiedWorkflow.name, modifiedWorkflow);
                modifiedWorkflow.id = result.id;
                this.log(theme.success(`✔ Created workflow [ID: ${result.id}]`));
                this.log(`${theme.label('Link')} ${theme.secondary(client.getWorkflowLink(result.id))}`);
            }
        } else {
            const result = await client.createWorkflow(modifiedWorkflow.name, modifiedWorkflow);
            modifiedWorkflow.id = result.id;
            this.log(theme.success(`✔ Created workflow [ID: ${result.id}]`));
            this.log(`${theme.label('Link')} ${theme.secondary(client.getWorkflowLink(result.id))}`);
        }
        await saveLocally(false);
    } else if (action === 'test') {
        // Automatically run the test command
        const tempPath = path.join(process.cwd(), '.n8m-temp-modified.json');
        await fs.writeFile(tempPath, JSON.stringify(modifiedWorkflow, null, 2));
        this.log(theme.info(`Workflow staged. Running ephemeral test...`));
        
        // Execute Test command
        // We import Test to avoid circular dependency issues if we just used runCommand with string?
        // Actually runCommand is cleaner.
        await this.config.runCommand('test', [tempPath]);
    }

    this.log(theme.done('Modification Process Complete.'));
    process.exit(0);
  }
}
