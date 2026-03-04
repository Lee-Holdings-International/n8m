import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js';
import { runAgenticWorkflowStream } from '../agentic/graph.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import inquirer from 'inquirer';
import { randomUUID } from 'node:crypto';
import { graph, resumeAgenticWorkflow } from '../agentic/graph.js';
import { promptMultiline } from '../utils/multilinePrompt.js';
import { DocService } from '../services/doc.service.js';
import { ConfigManager } from '../utils/config.js';
import { N8nClient } from '../utils/n8nClient.js';

export default class Create extends Command {
  static args = {
    description: Args.string({
      description: 'Natural language description of the workflow',
      required: false,
    }),
  }

  static description = 'Generate n8n workflows from natural language using an AI Agent'

  static examples = [
    '<%= config.bin %> <%= command.id %> "Send a telegram alert when I receive an email"',
    'echo "Slack to Discord sync" | <%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --output ./my-workflow.json',
  ]

  static flags = {
    deploy: Flags.boolean({
      char: 'd',
      description: 'Deploy the generated workflow to n8n instance (Not yet fully integrated with agent)',
      default: false,
      hidden: true,
    }),
    output: Flags.string({
      char: 'o',
      description: 'Path to save the generated workflow JSON',
    }),
    multiline: Flags.boolean({
      char: 'm',
      description: 'Open editor for multiline workflow description',
      default: false,
    }),
  }

  async run(): Promise<void> {
    this.log(theme.brand());
    const {args, flags} = await this.parse(Create);

    // 1. INPUT
    let description = args.description;
    
    // Handle piped input
    if (!description && !process.stdin.isTTY) {
        const chunks = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        description = Buffer.concat(chunks).toString('utf-8').trim();
    }

    // Handle multiline flag
    if (!description && flags.multiline) {
        const response = await inquirer.prompt([{
            type: 'editor',
            name: 'description',
            message: 'Describe the workflow you want to build (opens editor):',
            validate: (d: string) => d.trim().length > 0
        }]);
        description = response.description;
    }

    // Prompt if still empty
    if (!description) {
        description = await promptMultiline();
    }

    // Strip backticks if passed as a single block in argument or piped input
    if (description && description.startsWith('```') && description.endsWith('```')) {
        description = description.slice(3, -3).trim();
    }

    if (!description) {
        this.error('Description is required.');
    }

    // 2. AGENTIC EXECUTION
    const threadId = randomUUID();
    this.log(theme.info(`\nInitializing Agentic Workflow for: "${description}" (Session: ${threadId})`));
    
    let lastWorkflowJson: any = null;
    
    try {
        const stream = await runAgenticWorkflowStream(description, threadId);
        
        for await (const event of stream) {
            // event keys correspond to node names that just finished
            const nodeName = Object.keys(event)[0];
            const stateUpdate = (event as Record<string, any>)[nodeName];
            
            if (nodeName === 'architect') {
                this.log(theme.agent(`🏗️  Architect: Blueprint designed.`));
                if (stateUpdate.strategies && stateUpdate.strategies.length > 0) {
                    this.log(theme.header('\nPROPOSED STRATEGIES:'));
                    stateUpdate.strategies.forEach((s: any, i: number) => {
                        this.log(`${i === 0 ? theme.success('  [Primary]') : theme.info('  [Alternative]')} ${theme.value(s.suggestedName)}`);
                        this.log(`  Description: ${s.description}`);
                        if (s.nodes && s.nodes.length > 0) {
                            this.log(`  Proposed Nodes: ${s.nodes.map((n: any) => n.type.split('.').pop()).join(', ')}`);
                        }
                        this.log('');
                    });
                }
            } else if (nodeName === 'engineer') {
               this.log(theme.agent(`⚙️  Engineer: Workflow code generated/updated.`));
               if (stateUpdate.workflowJson) {
                   lastWorkflowJson = stateUpdate.workflowJson;
               }
            } else if (nodeName === 'qa') {
               const status = stateUpdate.validationStatus;
               if (status === 'passed') {
                   this.log(theme.success(`🧪 QA: Validation Passed!`));
               } else {
                   this.log(theme.fail(`🧪 QA: Validation Failed.`));
                   if (stateUpdate.validationErrors && stateUpdate.validationErrors.length > 0) {
                       stateUpdate.validationErrors.forEach((e: string) => this.log(theme.error(`   - ${e}`)));
                   }
                   this.log(theme.warn(`   Looping back to Engineer for repairs...`));
               }
            }
        }

        // Check for interrupt/pause
        let snapshot = await graph.getState({ configurable: { thread_id: threadId } });
        while (snapshot.next.length > 0) {
            const nextNode = snapshot.next[0];
            this.log(theme.warn(`\n⏸️  Workflow Paused at step: ${nextNode}`));
            
            if (nextNode === 'engineer') {
                const { action } = await inquirer.prompt([{
                    type: 'list',
                    name: 'action',
                    message: 'How would you like to proceed with the Blueprint?',
                    choices: [
                        { name: 'Approve and Generate Workflow', value: 'approve' },
                        { name: 'Provide Feedback / Refine Strategy', value: 'feedback' },
                        { name: 'Exit and Resume Later', value: 'exit' }
                    ]
                }]);

                if (action === 'approve') {
                    this.log(theme.agent("Approve! Proceeding to engineering..."));
                    await graph.updateState({ configurable: { thread_id: threadId } }, { userFeedback: undefined }, nextNode);
                    const stream = await graph.stream(null, { configurable: { thread_id: threadId } });
                    for await (const event of stream) {
                         const nodeName = Object.keys(event)[0];
                         const stateUpdate = (event as Record<string, any>)[nodeName];
                         if (nodeName === 'engineer') {
                            this.log(theme.agent(`⚙️  Engineer: Workflow code generated/updated.`));
                            if (stateUpdate.workflowJson) lastWorkflowJson = stateUpdate.workflowJson;
                         } else if (nodeName === 'qa') {
                            const status = stateUpdate.validationStatus;
                            if (status === 'passed') this.log(theme.success(`🧪 QA: Validation Passed!`));
                            else this.log(theme.fail(`🧪 QA: Validation Failed.`));
                         }
                    }
                } else if (action === 'feedback') {
                    const { feedback } = await inquirer.prompt([{
                        type: 'input',
                        name: 'feedback',
                        message: 'Enter your feedback/instructions:',
                    }]);
                    this.log(theme.agent("Updating strategy with your feedback..."));
                    // In a real implementation, we'd loop back to Architect or update the goal.
                    // For now, let's update userFeedback and resume. 
                    // To actually RE-ARCHITECT, we might need to jump back.
                    // LangGraph can handle this by updating state and using a conditional edge.
                    await graph.updateState({ configurable: { thread_id: threadId } }, { userFeedback: feedback }, nextNode);
                    // For now, just resume and let Engineer see the feedback.
                    const stream = await graph.stream(null, { configurable: { thread_id: threadId } });
                    for await (const event of stream) {
                        const nodeName = Object.keys(event)[0];
                        const stateUpdate = (event as Record<string, any>)[nodeName];
                        if (nodeName === 'engineer') {
                           this.log(theme.agent(`⚙️  Engineer: Workflow code generated/updated (Feedback incorporated).`));
                           if (stateUpdate.workflowJson) lastWorkflowJson = stateUpdate.workflowJson;
                        } else if (nodeName === 'qa') {
                            if (stateUpdate.validationStatus === 'passed') this.log(theme.success(`🧪 QA: Validation Passed!`));
                        }
                    }
                } else {
                    this.log(theme.info(`Session persisted. Resume later with: n8m resume ${threadId}`));
                    return;
                }
            } else {
                // Handle other interrupts (like QA)
                const { resume } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'resume',
                    message: `Review completed for ${nextNode}. Resume workflow execution?`,
                    default: true
                }]);

                if (resume) {
                    this.log(theme.agent("Resuming..."));
                    const result = await resumeAgenticWorkflow(threadId);
                    if (result.validationStatus === 'passed') {
                        this.log(theme.success(`🧪 QA (Resumed): Validation Passed!`));
                        if (result.workflowJson) lastWorkflowJson = result.workflowJson;
                    }
                } else {
                    this.log(theme.info(`Session persisted. Resume later with: n8m resume ${threadId}`));
                    return;
                }
            }
            snapshot = await graph.getState({ configurable: { thread_id: threadId } });
        }

    } catch (error) {
        this.error(`Agent ran into an unrecoverable error: ${(error as Error).message}`);
    }

    if (!lastWorkflowJson) {
        this.error('Agent finished but no workflow JSON was produced.');
    }

    // 3. SAVE
    // Normalize to array
    const workflows = lastWorkflowJson.workflows || [lastWorkflowJson];
    const savedResources: { path: string, name: string, original: any }[] = [];

    const docService = DocService.getInstance();
    for (const workflow of workflows) {
        const projectTitle = await docService.generateProjectTitle(workflow);
        workflow.name = projectTitle; // Standardize name
        
        const slug = docService.generateSlug(projectTitle);
        const workflowsDir = path.join(process.cwd(), 'workflows');
        const targetDir = path.join(workflowsDir, slug);
        const targetFile = path.join(targetDir, 'workflow.json');

        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(targetFile, JSON.stringify(workflow, null, 2));

        this.log(theme.success(`\nWorkflow organized at: ${targetDir}`));
        
        // Auto-Generate Documentation
        this.log(theme.agent("Generating initial documentation..."));
        const mermaid = docService.generateMermaid(workflow);
        const readmeContent = await docService.generateReadme(workflow);
        const fullDoc = `# ${projectTitle}\n\n## Visual Flow\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n${readmeContent}`;
        await fs.writeFile(path.join(targetDir, 'README.md'), fullDoc);

        savedResources.push({ path: targetFile, name: projectTitle, original: workflow });
    }
    
    // 4. DEPLOY PROMPT
    const deployConfig = await ConfigManager.load();
    const n8nUrl = process.env.N8N_API_URL || deployConfig.n8nUrl;
    const n8nKey = process.env.N8N_API_KEY || deployConfig.n8nKey;

    if (n8nUrl && n8nKey) {
        const { shouldDeploy } = await inquirer.prompt([{
            type: 'confirm',
            name: 'shouldDeploy',
            message: 'Deploy validated workflow to n8n?',
            default: true,
        }]);

        if (shouldDeploy) {
            const { activate } = await inquirer.prompt([{
                type: 'confirm',
                name: 'activate',
                message: 'Activate workflow after deployment?',
                default: false,
            }]);

            const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
            for (const { name, original } of savedResources) {
                try {
                    const result = await client.createWorkflow(name, original);
                    this.log(theme.done(`Deployed: ${name} [ID: ${result.id}]`));
                    this.log(`${theme.label('Link')} ${theme.secondary(client.getWorkflowLink(result.id))}`);
                    if (activate) {
                        await client.activateWorkflow(result.id);
                        this.log(theme.info('Workflow activated.'));
                    }
                } catch (err) {
                    this.log(theme.error(`Deploy failed for "${name}": ${(err as Error).message}`));
                }
            }
        }
    }

    this.log(theme.done('Agentic Workflow Complete.'));
    process.exit(0);
  }
}
