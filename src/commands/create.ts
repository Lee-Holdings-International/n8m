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
import { AIService } from '../services/ai.service.js';

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
            }
        }

        // Handle interrupt/pause loop
        let snapshot = await graph.getState({ configurable: { thread_id: threadId } });
        while (snapshot.next.length > 0) {
            const nextNode = snapshot.next[0];

            if (nextNode === 'engineer') {
                const isRepair = (snapshot.values.validationErrors as string[] || []).length > 0;

                if (isRepair) {
                    // Repair iteration — auto-continue without asking the user
                    const repairStream = await graph.stream(null, { configurable: { thread_id: threadId } });
                    for await (const event of repairStream) {
                        const n = Object.keys(event)[0];
                        const u = (event as Record<string, any>)[n];
                        if (n === 'engineer') {
                            this.log(theme.agent(`⚙️  Engineer: Applying fixes...`));
                            if (u.workflowJson) lastWorkflowJson = u.workflowJson;
                        } else if (n === 'supervisor' && u.workflowJson) {
                            lastWorkflowJson = u.workflowJson;
                        }
                    }
                } else {
                    // Initial build — let user choose which strategy to use
                    const strategies = (snapshot.values.strategies as any[]) || [];
                    const spec = snapshot.values.spec;

                    const choices: any[] = [];
                    if (strategies.length > 0) {
                        strategies.forEach((s: any, i: number) => {
                            const tag = i === 0 ? 'Primary' : 'Alternative';
                            const nodes = (s.nodes as any[] | undefined)
                                ?.map((n: any) => n.type?.split('.').pop())
                                .join(', ');
                            choices.push({
                                name: `[${tag}] ${s.suggestedName}${nodes ? `  ·  ${nodes}` : ''}`,
                                value: { type: 'build', strategy: s },
                                short: s.suggestedName,
                            });
                        });
                    } else if (spec) {
                        choices.push({
                            name: spec.suggestedName,
                            value: { type: 'build', strategy: spec },
                            short: spec.suggestedName,
                        });
                    }

                    choices.push(new inquirer.Separator());
                    choices.push({
                        name: 'Discuss details with the Engineer',
                        value: { type: 'chat' },
                        short: 'Discuss',
                    });
                    choices.push({
                        name: 'Add feedback before building',
                        value: { type: 'feedback' },
                        short: 'Add feedback',
                    });
                    choices.push({
                        name: 'Exit (save session to resume later)',
                        value: { type: 'exit' },
                        short: 'Exit',
                    });

                    const { choice } = await inquirer.prompt([{
                        type: 'list',
                        name: 'choice',
                        message: strategies.length > 1
                            ? 'The Architect designed two approaches — which should the Engineer build?'
                            : 'Blueprint ready. How would you like to proceed?',
                        choices,
                    }]);

                    if (choice.type === 'exit') {
                        this.log(theme.info(`\nSession saved. Resume later with: n8m resume ${threadId}`));
                        return;
                    }

                    let chosenSpec = choice.strategy ?? spec;
                    let stateUpdate: Record<string, any> = { spec: chosenSpec, userFeedback: undefined };

                    if (choice.type === 'chat') {
                        const aiService = AIService.getInstance();
                        const chatHistory: { role: 'user' | 'assistant'; content: string }[] = [];
                        let currentSpec = chosenSpec ?? strategies[0] ?? spec;

                        this.log(theme.header('\nCHATTING WITH THE ENGINEER'));
                        this.log(theme.muted(`  Plan: ${currentSpec?.suggestedName}`));
                        this.log(theme.muted(`  Type your question or request. Enter "done" when ready to build.\n`));

                        while (true) {
                            const { message } = await inquirer.prompt([{
                                type: 'input',
                                name: 'message',
                                message: 'You:',
                            }]);

                            const trimmed = (message as string).trim();
                            if (!trimmed || /^(done|build|approve|go|ok|yes)$/i.test(trimmed)) {
                                this.log(theme.agent(`Understood. Building "${currentSpec?.suggestedName}"...\n`));
                                break;
                            }

                            const { reply, updatedSpec } = await aiService.chatAboutSpec(currentSpec, chatHistory, trimmed);
                            chatHistory.push({ role: 'user', content: trimmed });
                            chatHistory.push({ role: 'assistant', content: reply });
                            currentSpec = updatedSpec;

                            this.log(`\n${theme.agent('Engineer:')} ${reply}\n`);

                            if (updatedSpec.suggestedName !== (chosenSpec ?? spec)?.suggestedName) {
                                this.log(theme.muted(`  (Plan updated: ${updatedSpec.suggestedName})`));
                            }
                        }

                        chosenSpec = currentSpec;
                        stateUpdate = { spec: chosenSpec, userFeedback: undefined };
                    } else if (choice.type === 'feedback') {
                        const { feedback } = await inquirer.prompt([{
                            type: 'input',
                            name: 'feedback',
                            message: 'Describe your refinements (the Engineer will incorporate them):',
                        }]);
                        chosenSpec = strategies[0] ?? spec;
                        stateUpdate = { spec: chosenSpec, userFeedback: feedback };
                        this.log(theme.agent(`Feedback noted. Building "${chosenSpec?.suggestedName}" with your refinements...`));
                    } else {
                        this.log(theme.agent(`Building "${chosenSpec?.suggestedName}"...`));
                    }

                    await graph.updateState({ configurable: { thread_id: threadId } }, stateUpdate);

                    const buildStream = await graph.stream(null, { configurable: { thread_id: threadId } });
                    for await (const event of buildStream) {
                        const n = Object.keys(event)[0];
                        const u = (event as Record<string, any>)[n];
                        if (n === 'engineer') {
                            this.log(theme.agent(`⚙️  Engineer: Building workflow...`));
                            if (u.workflowJson) lastWorkflowJson = u.workflowJson;
                        } else if (n === 'supervisor' && u.workflowJson) {
                            lastWorkflowJson = u.workflowJson;
                        } else if (n === 'reviewer' && u.validationStatus === 'failed') {
                            this.log(theme.warn(`   Reviewer flagged issues — Engineer will revise...`));
                        }
                    }
                }

            } else if (nextNode === 'qa') {
                const { proceed } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'proceed',
                    message: 'Workflow generated! Ready to run QA tests?',
                    default: true,
                }]);

                if (!proceed) {
                    this.log(theme.info(`\nSession saved. Resume later with: n8m resume ${threadId}`));
                    return;
                }

                const qaStream = await graph.stream(null, { configurable: { thread_id: threadId } });
                for await (const event of qaStream) {
                    const n = Object.keys(event)[0];
                    const u = (event as Record<string, any>)[n];
                    if (n === 'qa') {
                        if (u.validationStatus === 'passed') {
                            this.log(theme.success(`🧪 QA: Validation Passed!`));
                            if (u.workflowJson) lastWorkflowJson = u.workflowJson;
                        } else {
                            this.log(theme.fail(`🧪 QA: Validation Failed.`));
                            if (u.validationErrors?.length) {
                                (u.validationErrors as string[]).forEach(e => this.log(theme.error(`   - ${e}`)));
                            }
                            this.log(theme.warn(`   Looping back to Engineer for repairs...`));
                        }
                    } else if (n === 'supervisor' && u.workflowJson) {
                        lastWorkflowJson = u.workflowJson;
                    }
                }

            } else {
                // Unknown interrupt — auto-resume
                const result = await resumeAgenticWorkflow(threadId);
                if (result.workflowJson) lastWorkflowJson = result.workflowJson;
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
        // Use the workflow's own name (set by the Engineer from the spec's suggestedName).
        // Only call generateProjectTitle as a fallback when the name is missing or generic.
        const projectTitle = workflow.name || await docService.generateProjectTitle(workflow);
        workflow.name = projectTitle;

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
