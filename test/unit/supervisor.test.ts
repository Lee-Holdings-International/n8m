import { expect } from 'chai';
import { supervisorNode } from '../../src/agentic/nodes/supervisor.js';
import { AIService } from '../../src/services/ai.service.js';
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
    collaborationLog: [],
    ...overrides,
  } as typeof TeamState.State;
}

function makeCandidate(name: string, nodes: any[] = []) {
  return { name, nodes, connections: {} };
}

/**
 * Stub AIService.evaluateCandidates on the current singleton so tests
 * don't hit the real LLM API.
 */
function stubEvaluateCandidates(selectedIndex: number, reason = 'Test selection') {
  const service = AIService.getInstance();
  (service as any).evaluateCandidates = async () => ({ selectedIndex, reason });
}

// ---------------------------------------------------------------------------
// Lifecycle: reset the AIService singleton around each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  (AIService as any).instance = undefined;
  process.env.AI_API_KEY = 'test-key-only';
});

afterEach(() => {
  delete process.env.AI_API_KEY;
  (AIService as any).instance = undefined;
});

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
      stubEvaluateCandidates(0);
      const candidate = makeCandidate('My Workflow');
      const result = await supervisorNode(makeState({ candidates: [candidate] }));
      expect(result.workflowJson).to.deep.equal(candidate);
    });

    it('preserves all candidate properties in workflowJson', async () => {
      stubEvaluateCandidates(0);
      const candidate = {
        name: 'Complex Workflow',
        nodes: [{ id: 'n1', name: 'Trigger', type: 'n8n-nodes-base.scheduleTrigger' }],
        connections: { Trigger: { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
        settings: { executionOrder: 'v1' },
      };
      const result = await supervisorNode(makeState({ candidates: [candidate] }));
      expect(result.workflowJson).to.deep.equal(candidate);
    });

    it('includes a collaborationLog entry', async () => {
      stubEvaluateCandidates(0, 'Single candidate reason');
      const result = await supervisorNode(makeState({ candidates: [makeCandidate('My Workflow')] }));
      expect(result.collaborationLog).to.be.an('array').with.length(1);
      expect(result.collaborationLog![0]).to.include('Supervisor');
    });
  });

  describe('with multiple candidates', () => {
    it('selects the candidate at the index chosen by the LLM', async () => {
      stubEvaluateCandidates(1);
      const candidates = [
        makeCandidate('First Candidate'),
        makeCandidate('Second Candidate'),
        makeCandidate('Third Candidate'),
      ];
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.workflowJson!.name).to.equal('Second Candidate');
    });

    it('selects the first candidate when LLM returns index 0', async () => {
      stubEvaluateCandidates(0);
      const candidates = [
        makeCandidate('Winner'),
        makeCandidate('Runner-up'),
      ];
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.workflowJson!.name).to.equal('Winner');
    });

    it('falls back to candidates[0] when LLM returns undefined index', async () => {
      const service = AIService.getInstance();
      (service as any).evaluateCandidates = async () => ({ selectedIndex: undefined, reason: 'fallback' });
      const candidates = [makeCandidate('Fallback'), makeCandidate('Other')];
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.workflowJson!.name).to.equal('Fallback');
    });

    it('records the evaluation reason in collaborationLog', async () => {
      stubEvaluateCandidates(0, 'The first workflow is more complete.');
      const result = await supervisorNode(makeState({ candidates: [makeCandidate('A'), makeCandidate('B')] }));
      expect(result.collaborationLog![0]).to.include('The first workflow is more complete.');
    });

    it('includes the candidate count in the collaborationLog entry', async () => {
      stubEvaluateCandidates(1);
      const candidates = [makeCandidate('A'), makeCandidate('B'), makeCandidate('C')];
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.collaborationLog![0]).to.include('3');
    });

    it('returns exactly one workflowJson regardless of candidate count', async () => {
      stubEvaluateCandidates(0);
      const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`Candidate ${i}`));
      const result = await supervisorNode(makeState({ candidates }));
      expect(result.workflowJson).to.exist;
      expect(Array.isArray(result.workflowJson)).to.be.false;
    });
  });

  describe('return shape', () => {
    it('returns workflowJson and collaborationLog when candidates exist', async () => {
      stubEvaluateCandidates(0);
      const result = await supervisorNode(makeState({ candidates: [makeCandidate('Test')] }));
      expect(result).to.have.keys(['workflowJson', 'collaborationLog']);
    });

    it('collaborationLog is an array with one entry', async () => {
      stubEvaluateCandidates(0);
      const result = await supervisorNode(makeState({ candidates: [makeCandidate('Test')] }));
      expect(result.collaborationLog).to.be.an('array').with.length(1);
    });
  });
});
