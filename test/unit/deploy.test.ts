import { expect } from 'chai';
import Deploy from '../../src/commands/deploy.js';

// ---------------------------------------------------------------------------
// Deploy command — static metadata tests
//
// The interactive portions (inquirer prompts, n8n API calls) are not tested
// here. Instead, we verify the command's static definition and the presence
// and configuration of the new non-interactive flags added for CI use.
// ---------------------------------------------------------------------------

describe('Deploy command', () => {
  describe('static metadata', () => {
    it('has the correct description', () => {
      expect(Deploy.description).to.be.a('string').and.include('n8n');
    });

    it('accepts an optional workflow path argument', () => {
      expect(Deploy.args).to.have.property('workflow');
      expect(Deploy.args.workflow.required).to.equal(false);
    });
  });

  describe('flags', () => {
    it('defines an --activate flag', () => {
      expect(Deploy.flags).to.have.property('activate');
    });

    it('defines a --dir flag', () => {
      expect(Deploy.flags).to.have.property('dir');
    });

    it('defines an --update flag', () => {
      expect(Deploy.flags).to.have.property('update');
    });

    it('--update defaults to false', () => {
      expect((Deploy.flags.update as any).default).to.equal(false);
    });

    it('defines a --force-create flag', () => {
      expect(Deploy.flags).to.have.property('force-create');
    });

    it('--force-create defaults to false', () => {
      expect((Deploy.flags['force-create'] as any).default).to.equal(false);
    });

    it('--update and --force-create are boolean flags', () => {
      // Boolean oclif flags have a `type` of 'boolean'
      expect((Deploy.flags.update as any).type).to.equal('boolean');
      expect((Deploy.flags['force-create'] as any).type).to.equal('boolean');
    });
  });
});
