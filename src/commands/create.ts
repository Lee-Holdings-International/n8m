import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js';
import { AIService } from '../services/ai.service.js';
import { ConfigManager } from '../utils/config.js';
import { N8nClient } from '../utils/n8nClient.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import inquirer from 'inquirer';
// import { render } from 'ink'; // Removed
// import React from 'react'; // Removed
// import { CreateChat } from '../ui/components/CreateChat.js'; // Removed

export default class Create extends Command {
  static args = {
    description: Args.string({
      description: 'Natural language description of the workflow',
      required: false,
    }),
  }

  static description = 'Generate n8n workflows from natural language using Gemini AI'

  static examples = [
    '<%= config.bin %> <%= command.id %> "Send a telegram alert when I receive an email"',
    'echo "Slack to Discord sync" | <%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --deploy --activate',
  ]

  static flags = {
    deploy: Flags.boolean({
      char: 'd',
      description: 'Deploy the generated workflow to n8n instance',
      default: false,
    }),
    activate: Flags.boolean({
      char: 'a',
      description: 'Activate workflow after deployment (requires --deploy)',
      default: false,
      dependsOn: ['deploy'],
    }),
    output: Flags.string({
      char: 'o',
      description: 'Path to save the generated workflow JSON',
    }),
    instance: Flags.string({
      char: 'i',
      description: 'n8n instance name (from config)',
      default: 'production',
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
        const { inputType } = await inquirer.prompt([{
            type: 'list',
            name: 'inputType',
            message: 'How would you like to provide the workflow description?',
            choices: [
                { name: 'Simple text prompt', value: 'simple' },
                { name: 'Multiline editor (e.g. for long complex goals)', value: 'editor' }
            ]
        }]);

        if (inputType === 'editor') {
            const response = await inquirer.prompt([{
                type: 'editor',
                name: 'description',
                message: 'Describe the workflow in detail (opens editor):',
                validate: (d: string) => d.trim().length > 0
            }]);
            description = response.description;
        } else {
            const response = await inquirer.prompt([{
                type: 'input',
                name: 'description',
                message: 'Describe the workflow you want to build:',
                validate: (d: string) => d.trim().length > 0
            }]);
            description = response.description;
        }
    }

    if (!description) {
        this.error('Description is required.');
    }

    const ai = AIService.getInstance();

    // 2. CLARIFY (PLANNING)
    let spec: any = null;
    let isApproved = false;
    let currentDescription = description;

    while (!isApproved) {
        this.log(theme.info('\nDrafting Blueprint...'));
        try {
            if (!spec) {
                spec = await ai.generateSpec(currentDescription);
            } else {
                spec = await ai.refineSpec(spec, currentDescription);
            }
        } catch (error) {
            this.error(`Failed to generate plan: ${(error as Error).message}`);
        }

        // Display Plan
        this.displaySpec(spec);

        // Check for required clarifications
        if (spec.questions && spec.questions.length > 0) {
            this.log(theme.warn('\nClarification Needed:'));
            spec.questions.forEach((q: string) => this.log(`- ${q}`));

            const { answer } = await inquirer.prompt([{
                type: 'input',
                name: 'answer',
                message: 'Please answer the above to refine the plan (or press Enter to skip):',
            }]);

            if (answer && answer.trim()) {
                currentDescription = answer;
                continue; // Loop back to refine
            }
        }

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'How would you like to proceed?',
            choices: [
                { name: 'Build this workflow', value: 'build' },
                { name: 'Refine/Modify plan', value: 'refine' },
                { name: 'Cancel', value: 'cancel' }
            ],
            default: 'build'
        }]);

        if (action === 'cancel') {
            this.log('Operation cancelled.');
            return;
        } else if (action === 'build') {
            isApproved = true;
        } else {
            const { feedback } = await inquirer.prompt([{
                type: 'input',
                name: 'feedback',
                message: 'What should be changed?',
            }]);
            currentDescription = feedback; // Use feedback as the new "prompt" for refinement
        }
    }

    // 3. BUILD
    this.log(theme.agent('\nSynthesizing Workflow...'));
    let generatedResult: any;
    try {
        generatedResult = await ai.generateWorkflowFromSpec(spec);
    } catch (error) {
        this.error(`Failed to build workflow: ${(error as Error).message}`);
    }

    // Normalize to array
    const workflows = generatedResult.workflows || [generatedResult];
    
    // 4. SAVE (Save All First)
    const savedResources: { path: string, name: string, original: any }[] = [];

    for (const workflow of workflows) {
        let workflowName = workflow.name || spec.suggestedName || 'generated-workflow';
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

    // 5. TEST (Test All After Saving)
    for (const resource of savedResources) {
        this.log(theme.info(`\nRunning QA Validation for ${resource.name}...`));
        try {
            const { spawn } = await import('child_process');
             await new Promise<void>((resolve) => {
                const args = [process.argv[1], 'test', resource.path, '--no-brand', '--validate-only'];
                
                const child = spawn(process.argv[0], args, {
                    stdio: 'inherit' 
                });

                child.on('error', (err) => {
                    this.warn(`Failed to start test runner: ${err.message}`);
                    resolve();
                });

                child.on('close', (code) => {
                    if (code === 0) {
                        this.log(theme.success(`QA Passed: ${resource.name}`));
                    } else {
                        this.log(theme.warn(`QA Finished with exit code ${code} for ${resource.name}.`));
                    }
                    resolve();
                });
            });
        } catch (error) {
            this.warn(`Could not run test runner: ${(error as Error).message}`);
        }
    }
  }

  private displaySpec(spec: any) {
    this.log(`\n${theme.secondary.bold('--- WORKFLOW SPECIFICATION ---')}`);
    if (spec.suggestedName) {
        this.log(`${theme.label('Title')} ${theme.value(spec.suggestedName)}`);
    }
    this.log(`${theme.label('Goal')} ${theme.value(spec.goal)}`);
    
    this.log(`\n${theme.secondary.bold('Proposed Tasks:')}`);
    (spec.tasks || []).forEach((task: any, i: number) => {
        let taskText = task;
        if (typeof task === 'object' && task !== null) {
            // Prioritize descriptive fields, then find any string, then JSON stringify
            taskText = task.description || task.task || task.summary || Object.values(task).find(v => typeof v === 'string') || JSON.stringify(task);
        }
        this.log(`${theme.primary('  ' + (i + 1) + '.')} ${theme.foreground(taskText)}`);
    });

    this.log(`\n${theme.secondary.bold('Building Blocks:')}`);
    this.log(`  ${(spec.nodes || []).join(' → ')}`);

    if (spec.assumptions && spec.assumptions.length > 0) {
        this.log(`\n${theme.warn('Assumptions:')}`);
        spec.assumptions.forEach((a: string) => this.log(`  - ${a}`));
    }
    this.log(theme.divider(40));
  }
}
