import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import fs from 'node:fs/promises';
import { theme } from '../utils/theme.js';
import { GitService, formatCommitChoice, diffWorkflowNodes } from '../services/git.service.js';
import type { GitCommit } from '../services/git.service.js';

export interface RollbackChoice {
  name: string;
  value: string;
}

/**
 * Build the interactive select choices from a list of git commits.
 * The most-recent commit is labelled "(HEAD)" to make it easy to identify.
 * Pure function — safe to unit test.
 */
export function buildRollbackChoices(commits: GitCommit[]): RollbackChoice[] {
  return commits.map((commit, index) => ({
    name: `${formatCommitChoice(commit)}${index === 0 ? '  (HEAD)' : ''}`,
    value: commit.hash,
  }));
}

/**
 * Build a human-readable diff preview comparing the current on-disk version
 * of a workflow against the version about to be restored.
 * Pure function — safe to unit test.
 */
export function buildRollbackPreview(currentJson: any, targetJson: any): string {
  const diff = diffWorkflowNodes(currentJson, targetJson);
  const lines: string[] = [];

  if (diff.added.length === 0 && diff.removed.length === 0) {
    lines.push(`  No node changes (${diff.unchanged} node${diff.unchanged !== 1 ? 's' : ''} unchanged)`);
  } else {
    if (diff.added.length > 0) {
      lines.push(`  + Nodes added back:   ${diff.added.join(', ')}`);
    }
    if (diff.removed.length > 0) {
      lines.push(`  - Nodes removed:      ${diff.removed.join(', ')}`);
    }
    if (diff.unchanged > 0) {
      lines.push(`    Unchanged nodes:    ${diff.unchanged}`);
    }
  }

  return lines.join('\n');
}

async function findWorkflowFiles(rootDir: string): Promise<{ name: string; value: string }[]> {
  const choices: { name: string; value: string }[] = [];

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
        let label = rel;
        try {
          const raw = await fs.readFile(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed.name) label = `${parsed.name}  (${rel})`;
        } catch {
          // use rel as label
        }
        choices.push({ name: label, value: fullPath });
      }
    }
  }

  await scan(rootDir);
  return choices;
}

export default class Rollback extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path to workflow JSON file (omit for interactive menu)',
      required: false,
    }),
  };

  static description = 'Restore a workflow to a previous git-tracked version';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> ./workflows/slack-notifier/workflow.json',
    '<%= config.bin %> <%= command.id %> ./workflows/slack-notifier/workflow.json --deploy',
  ];

  static flags = {
    instance: Flags.string({
      char: 'i',
      default: 'production',
      description: 'n8n instance name (from config)',
    }),
    deploy: Flags.boolean({
      char: 'd',
      default: false,
      description: 'Deploy the restored workflow to n8n after rollback',
    }),
    dir: Flags.string({
      description: 'Directory to scan for workflows (default: ./workflows)',
    }),
  };

  async run(): Promise<void> {
    this.log(theme.brand());
    const { args, flags } = await this.parse(Rollback);

    this.log(theme.header('WORKFLOW ROLLBACK'));

    const git = new GitService(process.cwd());

    // 1. Verify we are inside a git repo
    if (!(await git.isGitRepo())) {
      this.error('Not a git repository. Rollback requires git history to restore from.');
    }

    // 2. Resolve workflow file path
    let workflowPath = args.workflow;

    if (!workflowPath) {
      const { default: select } = await import('@inquirer/select');
      const workflowsDir = flags.dir ?? path.join(process.cwd(), 'workflows');

      this.log(theme.agent(`Scanning ${theme.secondary(workflowsDir)} for workflows...`));
      const choices = await findWorkflowFiles(workflowsDir);

      if (choices.length === 0) {
        this.error(
          `No workflow JSON files found in ${workflowsDir}. Pass a file path directly or use --dir to specify another directory.`
        );
      }

      workflowPath = await select({
        message: 'Select a workflow to roll back:',
        choices,
        pageSize: 15,
      });
    }

    // 3. Get path relative to repo root (needed for git commands)
    const relPath = await git.getRelativePath(path.resolve(workflowPath));
    if (!relPath) {
      this.error(`File "${workflowPath}" is outside the git repository and cannot be rolled back.`);
    }

    this.log(`\n${theme.label('Workflow')} ${theme.value(workflowPath)}`);
    this.log(theme.divider(40));

    // 4. Load git history for this file
    const history = await git.getFileHistory(relPath);

    if (history.length === 0) {
      this.error(
        `No git history found for "${relPath}". Commit the workflow first to enable rollback.`
      );
    }

    if (history.length === 1) {
      this.error(
        `Only one commit found for "${relPath}". There is no earlier version to roll back to.`
      );
    }

    // 5. Let user pick a commit to restore
    const { default: select } = await import('@inquirer/select');
    const commitChoices = buildRollbackChoices(history);

    this.log(theme.subHeader('Git History'));
    const targetHash = await select({
      message: 'Select the version to restore:',
      choices: commitChoices,
      pageSize: 15,
    });

    if (targetHash === history[0].hash) {
      this.log(theme.warn('That is already the current version (HEAD). Nothing to restore.'));
      return;
    }

    // 6. Preview the diff
    this.log(theme.subHeader('Change Preview'));
    try {
      const currentContent = await fs.readFile(path.resolve(workflowPath), 'utf-8');
      const targetContent = await git.getFileAtCommit(targetHash, relPath);
      const currentJson = JSON.parse(currentContent);
      const targetJson = JSON.parse(targetContent);
      const preview = buildRollbackPreview(currentJson, targetJson);
      this.log(preview);
    } catch {
      this.log(theme.muted('  (Could not generate diff preview)'));
    }
    this.log('');

    // 7. Confirm
    const { default: confirm } = await import('@inquirer/confirm');
    const selectedCommit = history.find(c => c.hash === targetHash)!;
    const proceed = await confirm({
      message: `Restore to commit ${targetHash.slice(0, 7)} — "${selectedCommit.message}"?`,
      default: false,
    });

    if (!proceed) {
      this.log(theme.muted('Rollback cancelled.'));
      return;
    }

    // 8. Restore — write file content from target commit, do NOT run git checkout
    this.log(theme.agent('Restoring file...'));
    const restoredContent = await git.getFileAtCommit(targetHash, relPath);
    await fs.writeFile(path.resolve(workflowPath), restoredContent, 'utf-8');
    this.log(theme.done(`Restored "${relPath}" to ${targetHash.slice(0, 7)} — "${selectedCommit.message}"`));

    // 9. Optionally deploy
    if (flags.deploy) {
      this.log(theme.info('Deploying restored workflow to n8n...'));
      try {
        await this.config.runCommand('deploy', [path.resolve(workflowPath), '--instance', flags.instance]);
      } catch (err) {
        this.log(theme.error(`Deploy failed: ${(err as Error).message}`));
        this.log(theme.muted('The file has been restored locally. Run `n8m deploy` manually to push it.'));
      }
    } else {
      this.log(theme.muted(`  Run \`n8m deploy ${workflowPath}\` to push the restored version to n8n.`));
    }
  }
}
