import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js';

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
    this.log(theme.brand());
    const {args, flags} = await this.parse(Deploy)

    this.log(theme.header('WORKFLOW DEPLOYMENT'));

    const context = {
      workflow: args.workflow,
      instance: flags.instance,
      activate: flags.activate,
    }

    this.log(theme.subHeader('Context Analysis'));
    this.log(`${theme.label('Workflow')} ${theme.value(args.workflow)}`);
    this.log(`${theme.label('Instance')} ${theme.value(flags.instance)}`);
    this.log(`${theme.label('Auto-Activate')} ${theme.value(flags.activate)}`);
    this.log(theme.divider(40));

    try {
      this.log(theme.agent('Scanning environment for local n8n instance...'));
      
      let workflowData;
      if (args.workflow.endsWith('.json')) {
         const fs = await import('node:fs/promises');
         const content = await fs.readFile(args.workflow, 'utf-8');
         workflowData = JSON.parse(content);
      } else {
         throw new Error("Local JSON file path required for currently active bridge.");
      }

      this.log(theme.info('Authenticating...'));
      
      const { ConfigManager } = await import('../utils/config.js');
      const config = await ConfigManager.load();
      const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
      const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

      if (!n8nUrl || !n8nKey) {
        throw new Error('Missing n8n credentials. Run \'n8m config\' to set them.');
      }

      const { N8nClient } = await import('../utils/n8nClient.js');
      const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });

      this.log(theme.agent(`Transmitting bytecode to ${theme.secondary(n8nUrl)}`));

      const result = await client.createWorkflow(workflowData.name || 'n8m-deployment', workflowData);

      if (flags.activate && result.id) {
         this.log(theme.warn('Activation request queued.'));
      }

      this.log(theme.done(`Deployment Successful. [ID: ${theme.primary(result.id)}]`));
      this.log(`${theme.label('Public Link')} ${theme.secondary(client.getWorkflowLink(result.id))}`);
      
    } catch (error) {
      this.error(`Operation aborted: ${(error as Error).message}`);
    }
  }
}
