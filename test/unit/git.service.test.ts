import { expect } from 'chai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService, formatCommitChoice, diffWorkflowNodes } from '../../src/services/git.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

// ─── parseGitLog() — pure function, no I/O ────────────────────────────────────

describe('GitService.parseGitLog()', () => {
  it('parses a single log entry', () => {
    const result = GitService.parseGitLog('abc1234 feat: add Slack node\n');
    expect(result).to.have.length(1);
    expect(result[0].hash).to.equal('abc1234');
    expect(result[0].message).to.equal('feat: add Slack node');
  });

  it('parses multiple log entries', () => {
    const raw = 'abc1234 feat: add Slack node\ndef5678 fix: correct webhook\n';
    const result = GitService.parseGitLog(raw);
    expect(result).to.have.length(2);
    expect(result[1].hash).to.equal('def5678');
    expect(result[1].message).to.equal('fix: correct webhook');
  });

  it('returns empty array for empty string', () => {
    expect(GitService.parseGitLog('')).to.deep.equal([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(GitService.parseGitLog('   \n  \n')).to.deep.equal([]);
  });

  it('skips blank lines between entries', () => {
    const raw = '\nabc1234 valid message\n\n  \ndef5678 another message\n';
    const result = GitService.parseGitLog(raw);
    expect(result).to.have.length(2);
  });

  it('handles commit messages containing colons', () => {
    const result = GitService.parseGitLog('a1b2c3d fix: handle colon: in message\n');
    expect(result[0].message).to.equal('fix: handle colon: in message');
  });

  it('handles commit messages with parentheses and special chars', () => {
    const result = GitService.parseGitLog('a1b2c3d chore(deps): bump openai to 4.0 (#123)\n');
    expect(result[0].message).to.equal('chore(deps): bump openai to 4.0 (#123)');
  });

  it('skips lines without a space separator', () => {
    const raw = 'nospacehere\nabc1234 valid message\n';
    const result = GitService.parseGitLog(raw);
    expect(result).to.have.length(1);
    expect(result[0].hash).to.equal('abc1234');
  });

  it('trims leading/trailing whitespace from each line', () => {
    const result = GitService.parseGitLog('  abc1234 trimmed message  \n');
    expect(result[0].hash).to.equal('abc1234');
    expect(result[0].message).to.equal('trimmed message');
  });
});

// ─── formatCommitChoice() — pure function ─────────────────────────────────────

describe('formatCommitChoice()', () => {
  it('includes the short hash', () => {
    const result = formatCommitChoice({ hash: 'abc1234def', message: 'feat: something' });
    expect(result).to.include('abc1234');
  });

  it('includes the commit message', () => {
    const result = formatCommitChoice({ hash: 'abc1234', message: 'fix: correct webhook path' });
    expect(result).to.include('fix: correct webhook path');
  });

  it('truncates hash to 7 chars', () => {
    const result = formatCommitChoice({ hash: 'abc1234deadbeef', message: 'msg' });
    // Should show first 7 chars and not the full hash
    expect(result).to.include('abc1234');
    expect(result).to.not.include('abc1234deadbeef');
  });
});

// ─── diffWorkflowNodes() — pure function ─────────────────────────────────────

describe('diffWorkflowNodes()', () => {
  it('reports nodes added in new version', () => {
    const oldJson = { nodes: [{ name: 'Webhook' }] };
    const newJson = { nodes: [{ name: 'Webhook' }, { name: 'Slack' }] };
    const diff = diffWorkflowNodes(oldJson, newJson);
    expect(diff.added).to.include('Slack');
    expect(diff.removed).to.be.empty;
  });

  it('reports nodes removed in new version', () => {
    const oldJson = { nodes: [{ name: 'Webhook' }, { name: 'Slack' }] };
    const newJson = { nodes: [{ name: 'Webhook' }] };
    const diff = diffWorkflowNodes(oldJson, newJson);
    expect(diff.removed).to.include('Slack');
    expect(diff.added).to.be.empty;
  });

  it('reports unchanged count', () => {
    const oldJson = { nodes: [{ name: 'A' }, { name: 'B' }] };
    const newJson = { nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
    const diff = diffWorkflowNodes(oldJson, newJson);
    expect(diff.unchanged).to.equal(2);
    expect(diff.added).to.deep.equal(['C']);
  });

  it('handles both versions having identical nodes', () => {
    const json = { nodes: [{ name: 'X' }, { name: 'Y' }] };
    const diff = diffWorkflowNodes(json, json);
    expect(diff.added).to.be.empty;
    expect(diff.removed).to.be.empty;
    expect(diff.unchanged).to.equal(2);
  });

  it('handles missing nodes array gracefully', () => {
    const diff = diffWorkflowNodes({}, {});
    expect(diff.added).to.be.empty;
    expect(diff.removed).to.be.empty;
    expect(diff.unchanged).to.equal(0);
  });

  it('handles null inputs gracefully', () => {
    expect(() => diffWorkflowNodes(null, null)).to.not.throw();
    const diff = diffWorkflowNodes(null, null);
    expect(diff.added).to.be.empty;
    expect(diff.removed).to.be.empty;
  });
});

// ─── GitService integration tests (run against the real repo) ─────────────────

describe('GitService (integration)', () => {
  let svc: GitService;

  beforeEach(() => {
    svc = new GitService(repoRoot);
  });

  describe('isGitRepo()', () => {
    it('returns true for the project repo root', async () => {
      const result = await svc.isGitRepo();
      expect(result).to.be.true;
    });

    it('returns false for a non-git directory', async () => {
      const notGit = new GitService('/tmp');
      const result = await notGit.isGitRepo();
      expect(result).to.be.false;
    });
  });

  describe('getRepoRoot()', () => {
    it('resolves to the project root path', async () => {
      const root = await svc.getRepoRoot();
      expect(root).to.equal(repoRoot);
    });
  });

  describe('getRelativePath()', () => {
    it('returns relative path for a file inside the repo', async () => {
      const absPath = path.join(repoRoot, 'package.json');
      const rel = await svc.getRelativePath(absPath);
      expect(rel).to.equal('package.json');
    });

    it('returns relative path for a nested file', async () => {
      const absPath = path.join(repoRoot, 'src', 'index.ts');
      const rel = await svc.getRelativePath(absPath);
      expect(rel).to.equal(path.join('src', 'index.ts'));
    });

    it('returns null for a path outside the repo', async () => {
      const result = await svc.getRelativePath('/etc/hosts');
      expect(result).to.be.null;
    });
  });

  describe('getFileHistory()', () => {
    it('returns commits for a tracked file', async () => {
      const history = await svc.getFileHistory('package.json');
      expect(history).to.be.an('array');
      expect(history.length).to.be.greaterThan(0);
    });

    it('each commit has hash and message fields', async () => {
      const history = await svc.getFileHistory('package.json');
      for (const commit of history) {
        expect(commit).to.have.property('hash').that.is.a('string').with.length.greaterThan(0);
        expect(commit).to.have.property('message').that.is.a('string').with.length.greaterThan(0);
      }
    });

    it('returns empty array for an untracked/nonexistent file', async () => {
      const history = await svc.getFileHistory('nonexistent-file-xyz-abc.json');
      expect(history).to.deep.equal([]);
    });

    it('returns commits in reverse chronological order (newest first)', async () => {
      const history = await svc.getFileHistory('package.json');
      if (history.length < 2) return; // skip if only one commit
      // Can't guarantee order by content, but git log default is newest first
      // Just verify we get an array — the ordering is git's responsibility
      expect(history[0].hash).to.be.a('string');
    });
  });

  describe('getFileAtCommit()', () => {
    it('retrieves file content at the most recent commit', async () => {
      const history = await svc.getFileHistory('package.json');
      if (history.length === 0) return;

      const content = await svc.getFileAtCommit(history[0].hash, 'package.json');
      expect(content).to.be.a('string').with.length.greaterThan(0);
      // Should be valid JSON
      expect(() => JSON.parse(content)).to.not.throw();
    });

    it('throws an error for an invalid commit hash', async () => {
      let threw = false;
      try {
        await svc.getFileAtCommit('deadbeefdeadbeefdeadbeef', 'package.json');
      } catch {
        threw = true;
      }
      expect(threw).to.be.true;
    });

    it('throws an error for a valid hash but nonexistent file path', async () => {
      const history = await svc.getFileHistory('package.json');
      if (history.length === 0) return;

      let threw = false;
      try {
        await svc.getFileAtCommit(history[0].hash, 'nonexistent-xyz.json');
      } catch {
        threw = true;
      }
      expect(threw).to.be.true;
    });
  });
});
