import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  message: string;
}

export interface WorkflowDiff {
  added: string[];
  removed: string[];
  unchanged: number;
}

/**
 * Parse the output of `git log --oneline` into structured commits.
 * Pure function — safe to unit test without I/O.
 */
export function parseGitLog(raw: string): GitCommit[] {
  return GitService.parseGitLog(raw);
}

/**
 * Format a commit for display in an interactive select list.
 * Shows the 7-char short hash followed by the commit message.
 */
export function formatCommitChoice(commit: GitCommit): string {
  return `${commit.hash.slice(0, 7)}  ${commit.message}`;
}

/**
 * Diff two workflow JSON objects by node names.
 * Returns which node names were added, removed, and how many are unchanged.
 */
export function diffWorkflowNodes(oldJson: any, newJson: any): WorkflowDiff {
  const oldNodes: string[] = (oldJson?.nodes ?? []).map((n: any) => n.name);
  const newNodes: string[] = (newJson?.nodes ?? []).map((n: any) => n.name);
  const oldSet = new Set(oldNodes);
  const newSet = new Set(newNodes);

  const added = newNodes.filter(n => !oldSet.has(n));
  const removed = oldNodes.filter(n => !newSet.has(n));
  const unchanged = newNodes.filter(n => oldSet.has(n)).length;

  return { added, removed, unchanged };
}

export class GitService {
  constructor(private cwd: string = process.cwd()) {}

  /**
   * Parse the raw stdout of `git log --oneline` into GitCommit objects.
   * Static so it can be called without instantiation in tests.
   */
  static parseGitLog(raw: string): GitCommit[] {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .flatMap(line => {
        const spaceIdx = line.indexOf(' ');
        if (spaceIdx === -1) return [];
        const hash = line.slice(0, spaceIdx).trim();
        const message = line.slice(spaceIdx + 1).trim();
        if (!hash || !message) return [];
        return [{ hash, message }];
      });
  }

  /** Returns true if `cwd` is inside a git repository. */
  async isGitRepo(): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }

  /** Returns the absolute path to the repository root. */
  async getRepoRoot(): Promise<string> {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: this.cwd });
    return stdout.trim();
  }

  /**
   * Converts an absolute path to a path relative to the repo root.
   * Returns null if the path is outside the repository.
   */
  async getRelativePath(absolutePath: string): Promise<string | null> {
    try {
      const root = await this.getRepoRoot();
      const rel = path.relative(root, absolutePath);
      if (rel.startsWith('..')) return null;
      return rel;
    } catch {
      return null;
    }
  }

  /**
   * Returns git commit history for a file (newest first).
   * Returns [] if the file is untracked or has no commits.
   */
  async getFileHistory(relativePath: string): Promise<GitCommit[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '--', relativePath],
        { cwd: this.cwd }
      );
      return GitService.parseGitLog(stdout);
    } catch {
      return [];
    }
  }

  /**
   * Retrieves the content of a file at a specific git commit.
   * Throws if the hash is invalid or the file did not exist at that commit.
   */
  async getFileAtCommit(hash: string, relativePath: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'git',
      ['show', `${hash}:${relativePath}`],
      { cwd: this.cwd }
    );
    return stdout;
  }
}
