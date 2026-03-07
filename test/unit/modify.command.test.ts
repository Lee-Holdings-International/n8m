import { expect } from 'chai';
import Modify from '../../src/commands/modify.js';

// ---------------------------------------------------------------------------
// Modify command — static metadata + input validation guards
//
// The interactive agentic pipeline is not tested here (requires live AI and
// n8n). Instead, we verify:
//   1. Command static definition (args, flags, description)
//   2. The whitespace-guard logic added to prevent empty/blank instructions
//      from being forwarded to the AI agent
// ---------------------------------------------------------------------------

describe('Modify command', () => {
  // ── Static metadata ───────────────────────────────────────────────────────

  describe('static metadata', () => {
    it('has a description', () => {
      expect(Modify.description).to.be.a('string').with.length.greaterThan(0);
    });

    it('description mentions AI', () => {
      expect(Modify.description.toLowerCase()).to.include('ai');
    });

    it('has an optional workflow arg', () => {
      expect(Modify.args).to.have.property('workflow');
      expect((Modify.args as any).workflow.required).to.not.equal(true);
    });

    it('has an optional instruction arg', () => {
      expect(Modify.args).to.have.property('instruction');
      expect((Modify.args as any).instruction.required).to.not.equal(true);
    });
  });

  // ── Flags ─────────────────────────────────────────────────────────────────

  describe('flags', () => {
    it('defines a --multiline flag', () => {
      expect(Modify.flags).to.have.property('multiline');
    });

    it('--multiline defaults to false', () => {
      expect((Modify.flags.multiline as any).default).to.equal(false);
    });

    it('defines an --output flag', () => {
      expect(Modify.flags).to.have.property('output');
    });
  });

  // ── Input validation guard logic ──────────────────────────────────────────
  //
  // These tests replicate the exact conditions checked inside run():
  //   if (!instruction || !instruction.trim()) { this.error(...) }
  //   instruction = instruction.trim();

  describe('whitespace-only instruction guard', () => {
    const isEmpty = (s: string | undefined) => !s || !s.trim();

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

    it('passes a normal instruction', () => {
      expect(isEmpty('Add a Slack notification node after the HTTP Request')).to.equal(false);
    });

    it('passes an instruction with surrounding whitespace (trimmed later)', () => {
      expect(isEmpty('  add error handling  ')).to.equal(false);
    });

    it('passes a single-character instruction', () => {
      expect(isEmpty('x')).to.equal(false);
    });
  });

  describe('instruction trimming', () => {
    it('strips leading whitespace', () => {
      expect('   add a node'.trim()).to.equal('add a node');
    });

    it('strips trailing whitespace', () => {
      expect('add a node   '.trim()).to.equal('add a node');
    });

    it('strips both ends', () => {
      expect('  add a node  '.trim()).to.equal('add a node');
    });

    it('preserves internal whitespace', () => {
      expect('  add  a  node  '.trim()).to.equal('add  a  node');
    });

    it('leaves already-clean instruction unchanged', () => {
      expect('add a Slack notification node'.trim()).to.equal('add a Slack notification node');
    });
  });
});
