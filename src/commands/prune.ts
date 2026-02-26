import {Command, Flags} from '@oclif/core'
import { theme } from '../utils/theme.js';
import { ConfigManager } from '../utils/config.js';
import { N8nClient } from '../utils/n8nClient.js';
import inquirer from 'inquirer';

export default class Prune extends Command {
  static description = 'Deduplicate workflows on the instance'

  static flags = {
    force: Flags.boolean({char: 'f', description: 'Force delete without confirmation'}),
    'dry-run': Flags.boolean({char: 'd', description: 'Show what would be deleted', default: false}),
  }

  async run(): Promise<void> {
    this.log(theme.brand());
    const {flags} = await this.parse(Prune);

    this.log(theme.header('WORKFLOW PRUNING'));

    const config = await ConfigManager.load();
    const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
    const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

    if (!n8nUrl || !n8nKey) {
      this.error('Credentials missing. Configure environment via \'n8m config\'.');
    }

    const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });

    try {
        this.log(theme.info('Fetching workflows...'));
        const workflows = await client.getWorkflows();
        
        // Group by name
        const grouped = new Map<string, typeof workflows>();
        for (const wf of workflows) {
            const list = grouped.get(wf.name) || [];
            list.push(wf);
            grouped.set(wf.name, list);
        }

        const toDelete: typeof workflows = [];
        const toKeep: typeof workflows = [];

        for (const [name, list] of grouped.entries()) {
            // Logic 1: Remove Test Artifacts via Regex
            if (/^\[n8m:.*\]/i.test(name) || /^\[test/i.test(name) || /^My Workflow/i.test(name)) {
                toDelete.push(...list);
                continue;
            }

            // Logic 2: Deduplicate by Name
            if (list.length > 1) {
                // Sort by updatedAt descending (newest first)
                list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                
                // Keep index 0, delete the rest
                toKeep.push(list[0]);
                toDelete.push(...list.slice(1));
            }
        }

        if (toDelete.length === 0) {
            this.log(theme.done('No duplicates found. Instance is clean.'));
            return;
        }

        this.log(theme.subHeader('Analysis Result'));
        this.log(`${theme.label('Total Workflows')} ${theme.value(workflows.length)}`);
        this.log(`${theme.label('Duplicates Found')} ${theme.error(toDelete.length.toString())}`);
        this.log(theme.divider(20));

        this.log(theme.info('Duplicates to be removed:'));
        for (const wf of toDelete) {
            const keeper = grouped.get(wf.name)?.[0];
            this.log(`${theme.muted('[DELETE]')} ${wf.name} (${wf.id}) ${theme.muted(`< updated ${wf.updatedAt}`)}`);
            this.log(`         ${theme.success('KEEPing')} ${keeper?.id} (updated ${keeper?.updatedAt})`);
        }

        if (flags['dry-run']) {
            this.log(theme.divider(20));
            this.log(theme.warn('DRY RUN: No actual changes made.'));
            return;
        }

        if (!flags.force) {
            const { confirm } = await inquirer.prompt([{
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete ${toDelete.length} workflows? This cannot be undone.`,
                default: false
            }]);
            
            if (!confirm) {
                this.log(theme.info('Aborted.'));
                return;
            }
        }

        this.log(theme.agent('Executing purge...'));
        for (const wf of toDelete) {
            try {
                process.stdout.write(`Deleting ${wf.id}... `);
                await client.deleteWorkflow(wf.id);
                console.log(theme.done('Deleted'));
            } catch {
                console.log(theme.fail('Failed'));
            }
        }
        
        this.log(theme.done('Pruning complete.'));

    } catch (error) {
        this.error(`Pruning failed: ${(error as Error).message}`);
    }
  }
}
