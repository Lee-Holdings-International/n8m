import {Args, Command, Flags} from '@oclif/core'
import chalk from 'chalk'

/**
 * Skill Bridge: Deploy Command
 * 
 * This command acts as a bridge between user input and the @n8n-api-manager skill.
 * It collects CLI arguments and delegates workflow deployment to Antigravity.
 */
export default class Deploy extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path to the workflow file or workflow ID',
      required: true,
    }),
  }

  static description = 'Push workflows to n8n instance via API'

  static examples = [
    '<%= config.bin %> <%= command.id %> ./workflows/slack-notifier.json',
    '<%= config.bin %> <%= command.id %> workflow-123 --instance staging',
  ]

  static flags = {
    instance: Flags.string({
      char: 'i',
      default: 'production',
      description: 'n8n instance name (from config)',
    }),
    activate: Flags.boolean({
      char: 'a',
      default: false,
      description: 'Activate workflow after deployment',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Deploy)

    this.log(chalk.blue('🚀 n8m Deploy - Skill Bridge Activated'))
    this.log(chalk.gray('━'.repeat(50)))

    // Collect context
    const context = {
      workflow: args.workflow,
      instance: flags.instance,
      activate: flags.activate,
    }

    this.log(chalk.yellow('📋 Context assembled:'))
    this.log(JSON.stringify(context, null, 2))
    this.log(chalk.gray('━'.repeat(50)))

    try {
      // Load workflow file
      let workflowData;
      if (context.workflow.endsWith('.json')) {
         const fs = await import('node:fs/promises');
         const content = await fs.readFile(context.workflow, 'utf-8');
         workflowData = JSON.parse(content);
      } else {
         // Assume ID passed, for MVP we might need to fetch it first or handle ID deployment logic on server
         // For now, let's assume file path for deployment
         throw new Error("For MVP, please provide a path to a workflow JSON file");
      }

      this.log(chalk.cyan('Authentication with local n8n...'));
      
      const { ConfigManager } = await import('../utils/config.js');
      const config = await ConfigManager.load();
      const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
      const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

      if (!n8nUrl || !n8nKey) {
        throw new Error('Missing n8n credentials. Run \'n8m config\' to set them.');
      }

      const { N8nClient } = await import('../utils/n8nClient.js');
      const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });

      this.log(chalk.cyan(`Deploying to ${n8nUrl}...`));

      const result = await client.createWorkflow(workflowData.name || 'n8m-deployment', workflowData);

      if (context.activate && result.id) {
         // Activation logic would go here if specific endpoint exists in Client
         // client.activate(result.id)
         this.log(chalk.yellow('Note: Activation request sent (mocked for now)'));
      }

      this.log(chalk.green('\n✅ Deployment Successful!'));
      this.log(chalk.cyan(`   🔗 Link: ${client.getWorkflowLink(result.id)}`));
      
    } catch (error) {
      this.error(chalk.red(`Deployment failed: ${(error as Error).message}`));
    }
  }
}
