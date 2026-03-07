import { Args, Command, Flags } from '@oclif/core';
import { theme } from '../utils/theme.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

interface GitHubEntry {
  name: string;
  type: 'file' | 'dir';
  download_url: string | null;
  path: string;
}

async function listGitHubPatterns(
  owner: string,
  repo: string,
  dirPath: string,
  branch: string,
  token?: string,
): Promise<GitHubEntry[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}${branch ? `?ref=${branch}` : ''}`;
  const headers: Record<string, string> = { 'User-Agent': 'n8m-cli', Accept: 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  const entries = await res.json() as GitHubEntry[];
  return entries;
}

async function fetchRaw(url: string, token?: string): Promise<string> {
  const headers: Record<string, string> = { 'User-Agent': 'n8m-cli' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

interface WorkflowChoice {
  name: string;
  value: string;
}

async function findWorkflowFiles(rootDir: string): Promise<WorkflowChoice[]> {
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

export default class Learn extends Command {
  static args = {
    workflow: Args.string({
      description: 'Path to workflow JSON file (omit for interactive menu)',
      required: false,
    }),
  }

  static description = 'Extract reusable patterns from a validated workflow into the pattern library'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> ./workflows/my-workflow/workflow.json',
    '<%= config.bin %> <%= command.id %> --github owner/repo',
    '<%= config.bin %> <%= command.id %> --github owner/repo --github-path patterns/google',
  ]

  static flags = {
    dir: Flags.string({
      char: 'd',
      description: 'Directory to scan for workflows (default: ./workflows)',
    }),
    all: Flags.boolean({
      description: 'Generate patterns for all workflows in the directory',
      default: false,
    }),
    github: Flags.string({
      description: 'Import patterns from a GitHub repo (format: owner/repo or owner/repo@branch)',
    }),
    'github-path': Flags.string({
      description: 'Path within the GitHub repo to import from (default: patterns)',
      default: 'patterns',
    }),
    token: Flags.string({
      description: 'GitHub personal access token (increases rate limit for public repos)',
      env: 'GITHUB_TOKEN',
    }),
  }

  async run(): Promise<void> {
    this.log(theme.brand());
    const { args, flags } = await this.parse(Learn);

    this.log(theme.header('PATTERN LEARNING'));

    const patternsDir = path.join(process.cwd(), '.n8m', 'patterns');
    await fs.mkdir(patternsDir, { recursive: true });

    // GitHub import mode
    if (flags.github) {
      await this.runGitHubImport(flags.github, flags['github-path'], flags.token, patternsDir);
      return;
    }

    // Local workflow → AI generation mode
    const { AIService } = await import('../services/ai.service.js');
    const aiService = AIService.getInstance();

    const workflowsDir = flags.dir ?? path.join(process.cwd(), 'workflows');
    let workflowPaths: string[] = [];

    if (args.workflow) {
      workflowPaths = [args.workflow];
    } else if (flags.all) {
      this.log(theme.agent(`Scanning ${theme.secondary(workflowsDir)} for workflows...`));
      const choices = await findWorkflowFiles(workflowsDir);
      if (choices.length === 0) {
        this.error(`No workflow JSON files found in ${workflowsDir}.`);
      }
      workflowPaths = choices.map(c => c.value);
      this.log(theme.info(`Found ${workflowPaths.length} workflow(s).`));
    } else {
      const { default: select } = await import('@inquirer/select');
      this.log(theme.agent(`Scanning ${theme.secondary(workflowsDir)} for workflows...`));
      const choices = await findWorkflowFiles(workflowsDir);

      if (choices.length === 0) {
        this.error(`No workflow JSON files found in ${workflowsDir}. Pass a file path directly or use --dir to specify another directory.`);
      }

      const selected = await select({
        message: 'Select a workflow to learn from:',
        choices,
        pageSize: 15,
      });
      workflowPaths = [selected];
    }

    for (const workflowPath of workflowPaths) {
      await this.processWorkflow(workflowPath, patternsDir, aiService);
    }
  }

  private async runGitHubImport(repoArg: string, dirPath: string, token: string | undefined, patternsDir: string): Promise<void> {
    // Parse owner/repo@branch
    const [repoPart, branch = ''] = repoArg.split('@');
    const [owner, repo] = repoPart.split('/');
    if (!owner || !repo) {
      this.error('--github must be in the format owner/repo or owner/repo@branch');
    }

    this.log(theme.agent(`Fetching pattern list from ${theme.secondary(`github.com/${owner}/${repo}/${dirPath}`)}...`));

    let entries: GitHubEntry[];
    try {
      entries = await listGitHubPatterns(owner, repo, dirPath, branch, token);
    } catch (err) {
      this.error(`Could not reach GitHub: ${(err as Error).message}`);
    }

    // Collect all .md files, recursing into subdirectories
    const mdFiles = await this.collectMdFiles(entries, owner, repo, branch, token);

    if (mdFiles.length === 0) {
      this.log(theme.warn(`No .md pattern files found at ${dirPath} in ${owner}/${repo}.`));
      return;
    }

    this.log(theme.info(`Found ${mdFiles.length} pattern(s).`));

    const { checkbox } = await import('inquirer');
    const selected: string[] = await checkbox({
      message: 'Select patterns to import:',
      choices: mdFiles.map(f => ({ name: f.path, value: f.path, checked: true })),
      pageSize: 20,
    });

    if (selected.length === 0) {
      this.log(theme.muted('Nothing selected.'));
      return;
    }

    const toDownload = mdFiles.filter(f => selected.includes(f.path));

    for (const file of toDownload) {
      if (!file.download_url) continue;
      this.log(theme.agent(`Downloading ${theme.secondary(file.name)}...`));
      const content = await fetchRaw(file.download_url, token);
      const outPath = path.join(patternsDir, file.name);

      if (existsSync(outPath)) {
        const { default: select } = await import('@inquirer/select');
        const action = await select({
          message: `"${file.name}" already exists locally. Overwrite?`,
          choices: [
            { name: 'Overwrite', value: 'overwrite' },
            { name: 'Skip', value: 'skip' },
          ],
        });
        if (action === 'skip') {
          this.log(theme.muted(`Skipped ${file.name}.`));
          continue;
        }
      }

      await fs.writeFile(outPath, content, 'utf-8');
      this.log(theme.done(`Saved: ${theme.primary(outPath)}`));
    }

    this.log(theme.done(`Import complete. ${toDownload.length} pattern(s) added to ${theme.primary(patternsDir)}`));
  }

  private async collectMdFiles(
    entries: GitHubEntry[],
    owner: string,
    repo: string,
    branch: string,
    token: string | undefined,
  ): Promise<GitHubEntry[]> {
    const result: GitHubEntry[] = [];
    for (const entry of entries) {
      if (entry.type === 'file' && entry.name.endsWith('.md')) {
        result.push(entry);
      } else if (entry.type === 'dir') {
        try {
          const sub = await listGitHubPatterns(owner, repo, entry.path, branch, token);
          const subFiles = await this.collectMdFiles(sub, owner, repo, branch, token);
          result.push(...subFiles);
        } catch {
          // skip unreadable subdirs
        }
      }
    }
    return result;
  }

  private async processWorkflow(workflowPath: string, patternsDir: string, aiService: any): Promise<void> {
    this.log(theme.divider(40));
    this.log(`${theme.label('Workflow')} ${theme.value(workflowPath)}`);

    let workflowJson: any;
    try {
      const raw = await fs.readFile(workflowPath, 'utf-8');
      workflowJson = JSON.parse(raw);
    } catch {
      this.log(theme.fail(`Could not read or parse ${workflowPath} — skipping.`));
      return;
    }

    this.log(theme.agent(`Analyzing ${theme.secondary(workflowJson.name || 'workflow')}...`));

    const { content, slug } = await aiService.generatePattern(workflowJson);

    // Show preview
    this.log(theme.subHeader('Generated Pattern Preview'));
    const previewLines = content.split('\n').slice(0, 20);
    previewLines.forEach((line: string) => this.log(theme.muted(line)));
    if (content.split('\n').length > 20) {
      this.log(theme.muted(`  ... (${content.split('\n').length - 20} more lines)`));
    }
    this.log('');

    const outPath = path.join(patternsDir, `${slug}.md`);
    const alreadyExists = existsSync(outPath);

    const { default: select } = await import('@inquirer/select');
    const action = await select({
      message: alreadyExists
        ? `Pattern file "${slug}.md" already exists. What would you like to do?`
        : `Save pattern as "${slug}.md"?`,
      choices: alreadyExists
        ? [
            { name: 'Overwrite existing pattern', value: 'save' },
            { name: 'Save with a new name', value: 'rename' },
            { name: 'Skip', value: 'skip' },
          ]
        : [
            { name: 'Save pattern', value: 'save' },
            { name: 'Save with a different name', value: 'rename' },
            { name: 'Skip', value: 'skip' },
          ],
    });

    if (action === 'skip') {
      this.log(theme.muted('Skipped.'));
      return;
    }

    let finalPath = outPath;
    if (action === 'rename') {
      const { default: input } = await import('@inquirer/input');
      const customName = await input({
        message: 'Enter filename (without .md):',
        default: slug,
      });
      finalPath = path.join(patternsDir, `${customName.replace(/\.md$/, '')}.md`);
    }

    await fs.writeFile(finalPath, content, 'utf-8');
    this.log(theme.done(`Pattern saved: ${theme.primary(finalPath)}`));
  }
}
