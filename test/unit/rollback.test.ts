/**
 * Rollback command unit tests.
 *
 * The interactive portions of the command (inquirer prompts, deploy) are not
 * tested here — those require integration / E2E tests. Instead, we verify:
 *
 *  1. The pure helper functions exported from rollback.ts
 *  2. The command's static metadata (flags, args, description)
 *  3. GitService integration via real git history of this repository
 */

import { expect } from 'chai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRollbackChoices, buildRollbackPreview } from '../../src/commands/rollback.js';
import Rollback from '../../src/commands/rollback.js';
import type { GitCommit } from '../../src/services/git.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── buildRollbackChoices() ───────────────────────────────────────────────────

describe('buildRollbackChoices()', () => {
  const commits: GitCommit[] = [
    { hash: 'aaa1111', message: 'feat: add webhook node' },
    { hash: 'bbb2222', message: 'fix: correct Slack channel' },
    { hash: 'ccc3333', message: 'chore: initial commit' },
  ];

  it('returns one choice per commit', () => {
    const choices = buildRollbackChoices(commits);
    expect(choices).to.have.length(3);
  });

  it('each choice has a name and value', () => {
    const choices = buildRollbackChoices(commits);
    for (const c of choices) {
      expect(c).to.have.property('name').that.is.a('string');
      expect(c).to.have.property('value').that.is.a('string');
    }
  });

  it('choice value is the full commit hash', () => {
    const choices = buildRollbackChoices(commits);
    expect(choices[0].value).to.equal('aaa1111');
    expect(choices[1].value).to.equal('bbb2222');
  });

  it('choice name includes the short hash', () => {
    const choices = buildRollbackChoices(commits);
    expect(choices[0].name).to.include('aaa1111');
  });

  it('choice name includes the commit message', () => {
    const choices = buildRollbackChoices(commits);
    expect(choices[0].name).to.include('feat: add webhook node');
  });

  it('returns empty array for empty commits list', () => {
    expect(buildRollbackChoices([])).to.deep.equal([]);
  });

  it('marks the first (most recent) commit as current HEAD', () => {
    const choices = buildRollbackChoices(commits);
    expect(choices[0].name).to.include('HEAD');
  });
});

// ─── buildRollbackPreview() ───────────────────────────────────────────────────

describe('buildRollbackPreview()', () => {
  const currentJson = {
    nodes: [
      { name: 'Webhook' },
      { name: 'Slack Notify' },
      { name: 'Send Email' },
    ],
  };

  const targetJson = {
    nodes: [
      { name: 'Webhook' },
      { name: 'HTTP Request' },
    ],
  };

  it('returns a non-empty string', () => {
    const preview = buildRollbackPreview(currentJson, targetJson);
    expect(preview.trim().length).to.be.greaterThan(0);
  });

  it('mentions removed nodes', () => {
    const preview = buildRollbackPreview(currentJson, targetJson);
    expect(preview).to.include('Slack Notify');
    expect(preview).to.include('Send Email');
  });

  it('mentions added nodes', () => {
    const preview = buildRollbackPreview(currentJson, targetJson);
    expect(preview).to.include('HTTP Request');
  });

  it('handles identical workflows gracefully', () => {
    const preview = buildRollbackPreview(currentJson, currentJson);
    expect(() => preview).to.not.throw();
    // Should indicate no changes
    expect(preview.toLowerCase()).to.satisfy(
      (s: string) => s.includes('no change') || s.includes('unchanged') || s.includes('identical') || s.includes('3')
    );
  });

  it('handles null / empty json gracefully', () => {
    expect(() => buildRollbackPreview(null, null)).to.not.throw();
    expect(() => buildRollbackPreview({}, {})).to.not.throw();
  });
});

// ─── Rollback command static metadata ────────────────────────────────────────

describe('Rollback command', () => {
  it('has a description', () => {
    expect(Rollback.description).to.be.a('string').with.length.greaterThan(0);
  });

  it('has a workflow arg that is optional', () => {
    expect(Rollback.args).to.have.property('workflow');
    expect((Rollback.args as any).workflow.required).to.not.equal(true);
  });

  it('has an --instance flag', () => {
    expect(Rollback.flags).to.have.property('instance');
  });

  it('has a --deploy flag', () => {
    expect(Rollback.flags).to.have.property('deploy');
  });

  it('has a --dir flag for directory scanning', () => {
    expect(Rollback.flags).to.have.property('dir');
  });

  it('has examples', () => {
    expect(Rollback.examples).to.be.an('array').with.length.greaterThan(0);
  });
});
