import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js';
import { runAgenticWorkflowStream } from '../agentic/graph.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import inquirer from 'inquirer';
import { randomUUID } from 'node:crypto';
import { graph, resumeAgenticWorkflow } from '../agentic/graph.js';
import { promptMultiline } from '../ui/helpers/MultilinePrompt.js';

export default class Create extends Command {
  static args = {
    description: Args.string({
      description: 'Natural language description of the workflow',
      required: false,
    }),
  }

  static description = 'Generate n8n workflows from natural language using Gemini AI Agent'

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
    let lastSpec: any = null;
    
    try {
        const stream = await runAgenticWorkflowStream(description, threadId);
        
        for await (const event of stream) {
            // event keys correspond to node names that just finished
            const nodeName = Object.keys(event)[0];
            const stateUpdate = (event as Record<string, any>)[nodeName];
            
            if (nodeName === 'architect') {
                this.log(theme.agent(`🏗️  Architect: Blueprint designed.`));
                if (stateUpdate.spec?.suggestedName) {
                    this.log(`   Goal: ${theme.value(stateUpdate.spec.suggestedName)}`);
                    lastSpec = stateUpdate.spec;
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
        const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
        if (snapshot.next.length > 0) {
            this.log(theme.warn(`\n⏸️  Workflow Paused at step: ${snapshot.next.join(', ')}`));
            
             const { resume } = await inquirer.prompt([{
                type: 'confirm',
                name: 'resume',
                message: 'Review completed. Resume workflow execution?',
                default: true
            }]);

            if (resume) {
                 this.log(theme.agent("Resuming..."));
                 // Resume recursively/iteratively? 
                 // For now, simple resume call. ideally we'd stream again.
                 // But wait, resumeAgenticWorkflow returns the FINAL result, not a stream.
                 // We should probably loop if we want to stream again, but let's just create a simple resume handling here.
                 // Or we can just call resumeAgenticWorkflow and print the final result.
                 
                 const result = await resumeAgenticWorkflow(threadId);
                 if (result.validationStatus === 'passed') {
                     this.log(theme.success(`🧪 QA (Resumed): Validation Passed!`));
                     if (result.workflowJson) lastWorkflowJson = result.workflowJson;
                 } else {
                     this.log(theme.fail(`🧪 QA (Resumed): Final Status: ${result.validationStatus}`));
                 }
            } else {
                this.log(theme.info(`Session persisted. Resume later with: n8m resume ${threadId}`));
                return;
            }
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

    for (const workflow of workflows) {
        const workflowName = workflow.name || (lastSpec && lastSpec.suggestedName) || 'generated-workflow';
        const sanitizedName = workflowName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
        
        let targetFile = flags.output;
        // If multiple workflows and output provided, append name to avoid overwrite, unless it's a directory
        if (workflows.length > 1 && targetFile && !targetFile.endsWith('.json')) {
             targetFile = path.join(targetFile, `${sanitizedName}.json`);
        } else if (workflows.length > 1 && targetFile) {
             // If specific file given but we have multiple, suffix it
             targetFile = targetFile.replace('.json', `-${sanitizedName}.json`);
        } else if (!targetFile) {
            const targetDir = path.join(process.cwd(), 'workflows');
            if (!existsSync(targetDir)) { 
                await fs.mkdir(targetDir, { recursive: true });
            }
            targetFile = path.join(targetDir, `${sanitizedName}.json`);
        }

        await fs.writeFile(targetFile, JSON.stringify(workflow, null, 2));
        savedResources.push({ path: targetFile, name: workflowName, original: workflow });
        this.log(theme.success(`\nWorkflow saved to: ${targetFile}`));
    }
    
    this.log(theme.done('Agentic Workflow Complete.'));
    process.exit(0);
  }
}
