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
import { promptMultiline } from '../ui/helpers/MultilinePrompt.js';

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

  static description = 'Modify existing n8n workflows using Gemini AI Agent'

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
    if (!instruction && flags.multiline) {
        const response = await inquirer.prompt([{
            type: 'editor',
            name: 'instruction',
            message: 'Describe the modifications you want to apply (opens editor):',
            validate: (d: string) => d.trim().length > 0
        }]);
        instruction = response.instruction;
    }

    if (!instruction) {
        instruction = await promptMultiline('Describe the modifications you want to apply:');
    }

    if (!instruction) {
        this.error('Modification instructions are required.');
    }

    // 4. AGENTIC EXECUTION
    const threadId = randomUUID();
    this.log(theme.info(`\nInitializing Agentic Modification for: "${workflowName}"`));
    
    let lastWorkflowJson: any = workflowData;
    let lastSpec: any = null;
    
    const goal = `Modify the provided workflow based on these instructions: ${instruction}`;
    
    const initialState = {
        userGoal: goal,
        messages: [],
        validationErrors: [],
        workflowJson: workflowData,
        availableNodeTypes: validNodeTypes
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
                this.log(theme.agent(`🏗️  Architect: Analysis complete.`));
                if (stateUpdate.spec) {
                    this.log(`   Plan: ${theme.value(stateUpdate.spec.suggestedName || 'Modifying structure')}`);
                    lastSpec = stateUpdate.spec;
                }
            } else if (nodeName === 'engineer') {
               this.log(theme.agent(`⚙️  Engineer: Applying changes to workflow...`));
               if (stateUpdate.workflowJson) {
                   lastWorkflowJson = stateUpdate.workflowJson;
               }
            } else if (nodeName === 'qa') {
               const status = stateUpdate.validationStatus;
               if (status === 'passed') {
                   this.log(theme.success(`🧪 QA: Modification Validated.`));
               } else {
                   this.log(theme.fail(`🧪 QA: Validation Issues Found.`));
                   if (stateUpdate.validationErrors && stateUpdate.validationErrors.length > 0) {
                       stateUpdate.validationErrors.forEach((e: string) => this.log(theme.error(`   - ${e}`)));
                   }
                   this.log(theme.warn(`   Looping back for refinements...`));
               }
            }
        }

        // HITL Pause
        const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
        if (snapshot.next.length > 0) {
            this.log(theme.warn(`\n⏸️  Modification Paused at step: ${snapshot.next.join(', ')}`));
            
             const { resume } = await inquirer.prompt([{
                type: 'confirm',
                name: 'resume',
                message: 'Review pending changes. Proceed with finalization?',
                default: true
            }]);

            if (resume) {
                 this.log(theme.agent("Finalizing..."));
                 const result = await resumeAgenticWorkflow(threadId);
                 if (result.workflowJson) lastWorkflowJson = result.workflowJson;
            } else {
                this.log(theme.info(`Session persisted. Thread: ${threadId}`));
                return;
            }
        }

    } catch (error) {
        this.error(`Agent encountered an error: ${(error as Error).message}`);
    }

    // 5. POST-MODIFICATION ACTIONS
    const modifiedWorkflow = lastWorkflowJson.workflows ? lastWorkflowJson.workflows[0] : lastWorkflowJson;
    
    // Preserve ID if it existed in the original and is missing in the new
    if (workflowData.id) {
        modifiedWorkflow.id = workflowData.id;
    }
    
    // Standardize naming
    if (!modifiedWorkflow.name.toLowerCase().includes('modified')) {
        // maybe add a suffix? Or just keep it. 
    }

    const { action } = await inquirer.prompt([{
        type: 'select', 
        name: 'action',
        message: 'Modification complete. What would you like to do?',
        choices: [
            { name: 'Save locally', value: 'save' },
            { name: 'Deploy to n8n instance', value: 'deploy' },
            { name: 'Run ephemeral test (n8m test)', value: 'test' },
            { name: 'Discard changes', value: 'discard' }
        ]
    }]);

    if (action === 'save') {
        const defaultPath = flags.output || originalPath || path.join(process.cwd(), 'workflows', `${workflowName}-modified.json`);
        const { targetPath } = await inquirer.prompt([{
            type: 'input',
            name: 'targetPath',
            message: 'Save modified workflow to:',
            default: defaultPath
        }]);
        
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, JSON.stringify(modifiedWorkflow, null, 2));
        this.log(theme.success(`✔ Saved to ${targetPath}`));
    } else if (action === 'deploy') {
        if (remoteId) {
            this.log(theme.info(`Updating remote workflow ${remoteId}...`));
            await client.updateWorkflow(remoteId, modifiedWorkflow);
            this.log(theme.success(`✔ Remote workflow updated.`));
        } else {
            this.log(theme.info(`Creating new workflow on instance...`));
            const result = await client.createWorkflow(modifiedWorkflow.name, modifiedWorkflow);
            this.log(theme.success(`✔ Created workflow [ID: ${result.id}]`));
            this.log(`${theme.label('Link')} ${theme.secondary(client.getWorkflowLink(result.id))}`);
        }
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
  }
}
