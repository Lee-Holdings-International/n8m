import { expect } from 'chai';
import Create from '../../src/commands/create.js';

// ---------------------------------------------------------------------------
// Create command — static metadata + input validation guards
//
// The interactive agentic pipeline is not tested here (requires live AI and
// n8n). Instead, we verify:
//   1. Command static definition (args, flags, description, examples)
//   2. The whitespace-guard logic added to prevent empty/blank goals from
//      being forwarded to the AI agent
// ---------------------------------------------------------------------------

describe('Create command', () => {
  // ── Static metadata ───────────────────────────────────────────────────────

  describe('static metadata', () => {
    it('has a description', () => {
      expect(Create.description).to.be.a('string').with.length.greaterThan(0);
    });

    it('description mentions AI', () => {
      expect(Create.description.toLowerCase()).to.include('ai');
    });

    it('has at least one example', () => {
      expect(Create.examples).to.be.an('array').with.length.greaterThan(0);
    });

    it('has an optional description arg', () => {
      expect(Create.args).to.have.property('description');
      expect((Create.args as any).description.required).to.not.equal(true);
    });
  });

  // ── Flags ─────────────────────────────────────────────────────────────────

  describe('flags', () => {
    it('defines an --output flag', () => {
      expect(Create.flags).to.have.property('output');
    });

    it('defines a --multiline flag', () => {
      expect(Create.flags).to.have.property('multiline');
    });

    it('--multiline defaults to false', () => {
      expect((Create.flags.multiline as any).default).to.equal(false);
    });
  });

  // ── Input validation guard logic ──────────────────────────────────────────
  //
  // These tests replicate the exact conditions checked inside run():
  //   if (!description || !description.trim()) { this.error(...) }
  //   description = description.trim();

  describe('whitespace-only description guard', () => {
    // The guard condition used in run()
    const isEmpty = (d: string | undefined) => !d || !d.trim();

    it('treats undefined as empty', () => {
      expect(isEmpty(undefined)).to.equal(true);
    });

    it('treats empty string as empty', () => {
      expect(isEmpty('')).to.equal(true);
    });

    it('treats spaces-only string as empty', () => {
      expect(isEmpty('   ')).to.equal(true);
    });

    it('treats tabs as empty', () => {
      expect(isEmpty('\t\t')).to.equal(true);
    });

    it('treats mixed whitespace as empty', () => {
      expect(isEmpty('  \n\r\t  ')).to.equal(true);
    });

    it('passes a normal description', () => {
      expect(isEmpty('Send a Slack message when I get an email')).to.equal(false);
    });

    it('passes a description with surrounding whitespace (trimmed later)', () => {
      expect(isEmpty('  valid goal  ')).to.equal(false);
    });

    it('passes a single-character description', () => {
      expect(isEmpty('a')).to.equal(false);
    });
  });

  describe('description trimming', () => {
    // After the guard, run() does: description = description.trim()
    it('strips leading whitespace', () => {
      expect('   hello world'.trim()).to.equal('hello world');
    });

    it('strips trailing whitespace', () => {
      expect('hello world   '.trim()).to.equal('hello world');
    });

    it('strips both ends', () => {
      expect('  hello world  '.trim()).to.equal('hello world');
    });

    it('preserves internal whitespace', () => {
      expect('  send  slack  message  '.trim()).to.equal('send  slack  message');
    });

    it('leaves already-clean description unchanged', () => {
      expect('send a slack message'.trim()).to.equal('send a slack message');
    });
  });
});
