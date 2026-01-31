import {Args, Command, Flags} from '@oclif/core'
import chalk from 'chalk'
import {N8nClient, type WorkflowExecutionResult} from '../utils/n8nClient.js'
import {ConfigManager} from '../utils/config.js'

export default class Test extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path to workflow JSON file (Testing ID directly is NOT supported for ephemeral tests)',
      required: true,
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
      description: 'Do not delete workflow if test fails (for debugging)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Test)

    this.log(chalk.blue('🧪 n8m Ephemeral Test'))
    this.log(chalk.gray('━'.repeat(60)))

    // 1. Load Credentials
    const config = await ConfigManager.load();
    const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
    const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

    if (!n8nUrl || !n8nKey) {
      this.error('Missing n8n credentials. Run \'n8m config\' to set them.');
    }

    const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
    let createdWorkflowId: string | null = null;

    try {
      // 2. Load Workflow
      this.log(chalk.cyan('Reading workflow file...'));
       // Check if it's a file path
      if (!args.workflow.endsWith('.json')) {
         this.error('Ephemeral testing requires a local JSON file path, not an ID.');
      }
      
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(args.workflow, 'utf-8');
      const workflowData = JSON.parse(content);

      // 3. Deploy (Create)
      this.log(chalk.cyan('Deploying temporary workflow...'));
      const { id } = await client.createWorkflow(`[TEST] ${workflowData.name || 'Untitled'}`, workflowData);
      createdWorkflowId = id;
      this.log(chalk.dim(`   ID: ${id}`));

      // 4. Activate (if needed) & Execute
      // For creating, n8n usually defaults to active: false
      // To test triggers, we need to execute manually or trigger it.
      // For now, we assume manual execution via API
      this.log(chalk.cyan('Executing workflow...'));
      
      const result = await client.executeWorkflow(id);
      
      if (result.success) {
        this.log(chalk.green('\n✅ Test passed!'));
        this.log(chalk.dim('   Execution ID: ') + result.executionId);
      } else {
        throw new Error(`Workflow execution failed: ${result.error}`);
      }

    } catch (error) {
      this.log(chalk.red(`\n❌ Test failed: ${(error as Error).message}`));
      if (flags['keep-on-fail'] && createdWorkflowId) {
         this.log(chalk.yellow(`⚠️  Workflow ${createdWorkflowId} PRESERVED for debugging.`));
         createdWorkflowId = null; // Prevent deletion
      }
    } finally {
      // 5. Cleanup (Delete)
      if (createdWorkflowId) {
        this.log(chalk.cyan('\nCleaning up...'));
        try {
          await client.deleteWorkflow(createdWorkflowId);
          this.log(chalk.green('✔ Temporary workflow deleted.'));
        } catch (cleanupError) {
          this.warn(`Failed to delete workflow ${createdWorkflowId}: ${(cleanupError as Error).message}`);
        }
      }
    }
  }
}
