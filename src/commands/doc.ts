import { Args, Command, Flags } from '@oclif/core'
import { theme } from '../utils/theme.js'
import { N8nClient } from '../utils/n8nClient.js'
import { ConfigManager } from '../utils/config.js'
import { DocService } from '../services/doc.service.js'
import * as path from 'path'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import inquirer from 'inquirer'

export default class Doc extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path or Name of the workflow to document',
      required: false,
    }),
  }

  static description = 'Generate visual and text documentation for n8n workflows'

  static flags = {
    output: Flags.string({
      char: 'o',
      description: 'Output directory for documentation (defaults to ./docs)',
    }),
  }

  async run(): Promise<void> {
    const { args } = await this.parse(Doc)
    this.log(theme.brand());
    this.log(theme.header('WORKFLOW DOCUMENTATION'));

    // 1. Load Credentials & Client
    const config = await ConfigManager.load();
    const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
    const n8nKey = config.n8nKey || process.env.N8N_API_KEY;

    if (!n8nUrl || !n8nKey) {
      this.error('Credentials missing. Configure environment via \'n8m config\'.');
    }

    const client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
    const docService = DocService.getInstance();

    // 2. Resolve Workflow
    let workflowData: any;
    let workflowName = 'Untitled';
    let localPath: string | null = null;

    if (args.workflow && existsSync(args.workflow)) {
      const content = await fs.readFile(args.workflow, 'utf-8');
      workflowData = JSON.parse(content);
      workflowName = workflowData.name || path.basename(args.workflow, '.json');
      localPath = path.resolve(args.workflow);
    } else {
      this.log(theme.info('Searching for local and remote workflows...'));
      
      const localChoices: any[] = [];
      const workflowsDir = path.join(process.cwd(), 'workflows');
      
      if (existsSync(workflowsDir)) {
          // Scan for loose files AND directory-based workflows
          const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
          for (const entry of entries) {
              if (entry.isFile() && entry.name.endsWith('.json')) {
                  localChoices.push({
                      name: `${theme.value('[LOCAL]')} ${entry.name}`,
                      value: { type: 'local', path: path.join(workflowsDir, entry.name) }
                  });
              } else if (entry.isDirectory()) {
                  const subPath = path.join(workflowsDir, entry.name, 'workflow.json');
                  if (existsSync(subPath)) {
                      localChoices.push({
                          name: `${theme.value('[LOCAL]')} ${entry.name}/workflow.json`,
                          value: { type: 'local', path: subPath }
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

      if (choices.length === 0) this.error('No workflows found sequence.');

      const { selection } = await inquirer.prompt([{
        type: 'select',
        name: 'selection',
        message: 'Select a workflow to document:',
        choices,
        pageSize: 15
      }]);

      if (selection.type === 'local') {
        const content = await fs.readFile(selection.path, 'utf-8');
        workflowData = JSON.parse(content);
        workflowName = workflowData.name || path.basename(selection.path, '.json');
        localPath = selection.path;
      } else {
        workflowData = await client.getWorkflow(selection.id);
        workflowName = (workflowData as any).name || 'Remote Workflow';
      }
    }

    // 3. Prepare Folder Structure
    const slug = docService.generateSlug(workflowName);
    const workflowsDir = path.join(process.cwd(), 'workflows');
    const targetDir = path.join(workflowsDir, slug);
    const targetJsonPath = path.join(targetDir, 'workflow.json');
    const targetReadmePath = path.join(targetDir, 'README.md');

    await fs.mkdir(targetDir, { recursive: true });

    // Move or Save JSON
    if (localPath) {
        if (path.resolve(localPath) !== path.resolve(targetJsonPath)) {
            this.log(theme.info(`Moving workflow to: ${theme.value(targetJsonPath)}`));
            await fs.writeFile(targetJsonPath, JSON.stringify(workflowData, null, 2));
            // Only delete if it's a loose file in workflows/ or provided path
            if (path.resolve(localPath) !== path.resolve(targetJsonPath)) {
                await fs.unlink(localPath);
            }
        }
    } else {
        this.log(theme.info(`Saving remote workflow to: ${theme.value(targetJsonPath)}`));
        await fs.writeFile(targetJsonPath, JSON.stringify(workflowData, null, 2));
    }

    // 4. Generate & Save Documentation
    this.log(theme.agent(`Generating diagrams and summary for: "${workflowName}"...`));
    
    const mermaid = docService.generateMermaid(workflowData);
    const readme = await docService.generateReadme(workflowData);
    const fullDoc = `# ${workflowName}\n\n## Visual Flow\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n${readme}`;

    await fs.writeFile(targetReadmePath, fullDoc);

    this.log(theme.success(`✔ Documentation Generated & Organized.`));
    this.log(`${theme.label('Folder')} ${theme.value(targetDir)}`);
    
    this.log(theme.divider());
    this.log(theme.subHeader('Mermaid Diagram Preview:'));
    this.log(theme.muted(mermaid));
  }
}
