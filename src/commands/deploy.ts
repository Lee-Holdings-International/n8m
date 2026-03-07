import {Args, Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js';
import path from 'node:path';

interface WorkflowChoice {
  name: string;
  value: string;
}

async function findWorkflowFiles(rootDir: string): Promise<WorkflowChoice[]> {
  const fs = await import('node:fs/promises');
  const choices: WorkflowChoice[] = [];

  async function scan(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.name.endsWith('.json')) {
        const rel = path.relative(rootDir, fullPath);
        // Try to read workflow name from JSON
        let label = rel;
        try {
          const raw = await fs.readFile(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed.name) label = `${parsed.name}  (${rel})`;
        } catch {
          // use rel path as label
        }
        choices.push({ name: label, value: fullPath });
      }
    }
  }

  await scan(rootDir);
  return choices;
}

export default class Deploy extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path to workflow JSON file (omit for interactive menu)',
      required: false,
    }),
  }

  static description = 'Push workflows to n8n instance via API'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
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
    dir: Flags.string({
      char: 'd',
      description: 'Directory to scan for workflows (default: ./workflows)',
    }),
  }

  async run(): Promise<void> {
    this.log(theme.brand());
    const {args, flags} = await this.parse(Deploy)

    this.log(theme.header('WORKFLOW DEPLOYMENT'));

    try {
      let workflowPath = args.workflow;

      if (!workflowPath) {
        const { default: select } = await import('@inquirer/select');
        const workflowsDir = flags.dir ?? path.join(process.cwd(), 'workflows');

        this.log(theme.agent(`Scanning ${theme.secondary(workflowsDir)} for workflows...`));
        const choices = await findWorkflowFiles(workflowsDir);

        if (choices.length === 0) {
          this.error(`No workflow JSON files found in ${workflowsDir}. Pass a file path directly or use --dir to specify another directory.`);
        }

        workflowPath = await select({
          message: 'Select a workflow to deploy:',
          choices,
          pageSize: 15,
        });
      }

      const resolvedPath = workflowPath as string;

      this.log(theme.subHeader('Context Analysis'));
      this.log(`${theme.label('Workflow')} ${theme.value(resolvedPath)}`);
      this.log(`${theme.label('Instance')} ${theme.value(flags.instance)}`);
      this.log(`${theme.label('Auto-Activate')} ${theme.value(flags.activate)}`);
      this.log(theme.divider(40));

      if (!resolvedPath.endsWith('.json')) {
        throw new Error('Selected file must be a .json workflow file.');
      }

      const fs = await import('node:fs/promises');
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const workflowData = JSON.parse(content);

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

      const saveIdToFile = async (id: string) => {
        if (workflowData.id !== id) {
          workflowData.id = id;
          await fs.writeFile(resolvedPath, JSON.stringify(workflowData, null, 2), 'utf-8');
          this.log(theme.muted(`  Local file updated with ID: ${id}`));
        }
      };

      let deployedId: string;

      if (workflowData.id) {
        let existsRemotely = false;
        try {
          await client.getWorkflow(workflowData.id);
          existsRemotely = true;
        } catch {
          // not found — will create
        }

        if (existsRemotely) {
          const { default: select } = await import('@inquirer/select');
          const action = await select({
            message: `Workflow "${workflowData.name}" already exists in n8n (ID: ${workflowData.id}). What would you like to do?`,
            choices: [
              { name: 'Update existing workflow', value: 'update' },
              { name: 'Create as new workflow', value: 'create' },
            ],
          });

          if (action === 'update') {
            await client.updateWorkflow(workflowData.id, workflowData);
            deployedId = workflowData.id;
          } else {
            const result = await client.createWorkflow(workflowData.name || 'n8m-deployment', workflowData);
            deployedId = result.id;
            await saveIdToFile(deployedId);
          }
        } else {
          const result = await client.createWorkflow(workflowData.name || 'n8m-deployment', workflowData);
          deployedId = result.id;
          await saveIdToFile(deployedId);
        }
      } else {
        const result = await client.createWorkflow(workflowData.name || 'n8m-deployment', workflowData);
        deployedId = result.id;
        await saveIdToFile(deployedId);
      }

      if (flags.activate && deployedId) {
        this.log(theme.warn('Activation request queued.'));
      }

      this.log(theme.done(`Deployment Successful. [ID: ${theme.primary(deployedId)}]`));
      this.log(`${theme.label('Public Link')} ${theme.secondary(client.getWorkflowLink(deployedId))}`);

    } catch (error) {
      this.error(`Operation aborted: ${(error as Error).message}`);
    }
  }
}
