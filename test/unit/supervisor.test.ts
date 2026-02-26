import { expect } from 'chai';
import { supervisorNode } from '../../src/agentic/nodes/supervisor.js';
import type { TeamState } from '../../src/agentic/state.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal TeamState for the supervisor
// ---------------------------------------------------------------------------
function makeState(overrides: Partial<typeof TeamState.State> = {}): typeof TeamState.State {
  return {
    userGoal: 'test goal',
    spec: null,
    workflowJson: null,
    validationErrors: [],
    messages: [],
    needsClarification: false,
    validationStatus: 'passed',
    availableNodeTypes: [],
    revisionCount: 0,
    strategies: [],
    candidates: [],
    customTools: {},
    ...overrides,
  } as typeof TeamState.State;
}

function makeCandidate(name: string, nodes: any[] = []) {
  return { name, nodes, connections: {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('supervisorNode', () => {
  describe('when no candidates are present', () => {
    it('returns an empty object (preserves existing workflowJson)', async () => {
      const result = await supervisorNode(makeState({ candidates: [] }));
      expect(result).to.deep.equal({});
    });

    it('returns empty object when candidates is undefined', async () => {
      const result = await supervisorNode(makeState({ candidates: undefined as any }));
      expect(result).to.deep.equal({});
    });
  });

  describe('with a single candidate', () => {
    it('selects the sole candidate as workflowJson', async () => {
      const candidate = makeCandidate('My Workflow');
      const result = await supervisorNode(makeState({ candidates: [candidate] }));
      expect(result.workflowJson).to.deep.equal(candidate);
    });

    it('preserves all candidate properties in workflowJson', async () => {
      const candidate = {
        name: 'Complex Workflow',
        nodes: [{ id: 'n1', name: 'Trigger', type: 'n8n-nodes-base.scheduleTrigger' }],
        connections: { Trigger: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
        settings: { executionOrder: 'v1' },
      };
      const result = await supervisorNode(makeState({ candidates: [candidate] }));
      expect(result.workflowJson).to.deep.equal(candidate);
    });
  });

  describe('with multiple candidates', () => {
    it('selects the first candidate (index 0)', async () => {
      const candidates = [
        makeCandidate('First Candidate'),
        makeCandidate('Second Candidate'),
        makeCandidate('Third Candidate'),
      ];
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.workflowJson!.name).to.equal('First Candidate');
    });

    it('ignores candidates beyond the first', async () => {
      const candidates = [
        makeCandidate('Winner'),
        makeCandidate('Ignored A'),
        makeCandidate('Ignored B'),
      ];
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.workflowJson!.name).to.equal('Winner');
    });

    it('returns exactly one workflowJson regardless of candidate count', async () => {
      const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`Candidate ${i}`));
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.workflowJson).to.exist;
      expect(Array.isArray(result.workflowJson)).to.be.false;
    });
  });

  describe('return shape', () => {
    it('returns an object with a workflowJson key when candidates exist', async () => {
      const result = await supervisorNode(makeState({ candidates: [makeCandidate('Test')] }));
      expect(result).to.have.key('workflowJson');
    });

    it('does not return other state keys (only workflowJson or empty)', async () => {
      const result = await supervisorNode(makeState({ candidates: [makeCandidate('Test')] }));
      const keys = Object.keys(result);
      expect(keys).to.deep.equal(['workflowJson']);
    });
  });
});
