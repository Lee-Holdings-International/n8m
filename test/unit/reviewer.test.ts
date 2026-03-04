import { expect } from 'chai';
import { reviewerNode } from '../../src/agentic/nodes/reviewer.js';
import type { TeamState } from '../../src/agentic/state.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal valid TeamState for the reviewer
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

// Build a simple valid workflow JSON with two connected nodes
function makeValidWorkflow(options: { nodes?: any[]; connections?: any } = {}) {
  const nodes = options.nodes ?? [
    {
      id: 'n1',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      position: [0, 0],
      parameters: {},
    },
    {
      id: 'n2',
      name: 'Send Email',
      type: 'n8n-nodes-base.emailSend',
      position: [200, 0],
      parameters: {},
    },
  ];
  const connections = options.connections ?? {
    'Schedule Trigger': { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] },
  };
  return { nodes, connections };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reviewerNode', () => {
  describe('when workflowJson is null/undefined', () => {
    it('returns failed with a descriptive error', async () => {
      const result = await reviewerNode(makeState({ workflowJson: null }));
      expect(result.validationStatus).to.equal('failed');
      expect(result.validationErrors).to.have.length.greaterThan(0);
      expect(result.validationErrors![0]).to.include('No workflow JSON');
    });
  });

  // -------------------------------------------------------------------------
  describe('hallucinated node type detection', () => {
    const hallucinatedTypes = [
      'rssFeed',
      'n8n-nodes-base.rssFeed',
      'openai',
      'n8n-nodes-base.openai',
      'n8n-nodes-base.gpt',
      'n8n-nodes-base.gemini',
      'cheerioHtml',
      'n8n-nodes-base.cheerioHtml',
    ];

    for (const badType of hallucinatedTypes) {
      it(`flags "${badType}" as a hallucinated type`, async () => {
        const wf = {
          nodes: [
            { id: 'n0', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
            { id: 'n1', name: 'BadNode', type: badType, position: [200, 0], parameters: {} },
          ],
          connections: {
            Webhook: { main: [[{ node: 'BadNode', type: 'main', index: 0 }]] },
          },
        };
        const result = await reviewerNode(makeState({ workflowJson: wf }));
        expect(result.validationStatus).to.equal('failed');
        const errors = result.validationErrors!.join(' ');
        expect(errors).to.include('Hallucinated node type');
      });
    }

    it('passes for valid built-in node types', async () => {
      const result = await reviewerNode(makeState({ workflowJson: makeValidWorkflow() }));
      expect(result.validationStatus).to.equal('passed');
      expect(result.validationErrors).to.deep.equal([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('empty node name detection', () => {
    it('flags a node with an empty name string', async () => {
      const wf = {
        nodes: [
          { id: 'n0', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: 'n1', name: '', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          Webhook: { main: [[{ node: '', type: 'main', index: 0 }]] },
        },
      };
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      expect(result.validationStatus).to.equal('failed');
      const errors = result.validationErrors!.join(' ');
      expect(errors).to.include('empty name');
    });

    it('flags a node with a whitespace-only name', async () => {
      const wf = {
        nodes: [
          { id: 'n0', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: 'n1', name: '   ', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          Webhook: { main: [[{ node: '   ', type: 'main', index: 0 }]] },
        },
      };
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      expect(result.validationStatus).to.equal('failed');
    });
  });

  // -------------------------------------------------------------------------
  describe('orphaned node detection', () => {
    it('flags a non-trigger node with no incoming connection', async () => {
      const wf = {
        nodes: [
          {
            id: 'n0',
            name: 'Schedule Trigger',
            type: 'n8n-nodes-base.scheduleTrigger',
            position: [0, 0],
            parameters: {},
          },
          { id: 'n1', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          {
            id: 'n2',
            name: 'Orphan',
            type: 'n8n-nodes-base.emailSend',
            position: [400, 0],
            parameters: {},
          },
        ],
        connections: {
          'Schedule Trigger': { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
          // 'Orphan' has no incoming connections — reviewer auto-connects it
        },
      };
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      // The reviewer auto-connects orphaned nodes rather than failing
      expect(result.validationStatus).to.equal('passed');
      // The returned workflowJson should have the orphan chained after Set
      const patched = (result as any).workflowJson;
      expect(patched).to.exist;
      expect(patched.connections['Set']).to.exist;
      expect(patched.connections['Set'].main[0][0].node).to.equal('Orphan');
    });

    it('does not flag a trigger node as an orphan', async () => {
      const wf = makeValidWorkflow();
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      expect(result.validationStatus).to.equal('passed');
    });

    it('does not flag a webhook node as an orphan', async () => {
      const wf = {
        nodes: [
          { id: 'n0', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: 'n1', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
        },
      };
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      expect(result.validationStatus).to.equal('passed');
    });

    it('does not flag a node whose name contains "trigger"', async () => {
      const wf = {
        nodes: [
          {
            id: 'n0',
            name: 'On New Row Trigger',
            type: 'n8n-nodes-base.googleSheetsTrigger',
            position: [0, 0],
            parameters: {},
          },
          {
            id: 'n1',
            name: 'Send Slack',
            type: 'n8n-nodes-base.slack',
            position: [200, 0],
            parameters: {},
          },
        ],
        connections: {
          'On New Row Trigger': { main: [[{ node: 'Send Slack', type: 'main', index: 0 }]] },
        },
      };
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      expect(result.validationStatus).to.equal('passed');
    });
  });

  // -------------------------------------------------------------------------
  describe('executeWorkflow node validation', () => {
    it('flags an Execute Workflow node missing workflowId when mode is "id"', async () => {
      const wf = {
        nodes: [
          {
            id: 'n0',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            position: [0, 0],
            parameters: {},
          },
          {
            id: 'n1',
            name: 'Run Sub',
            type: 'n8n-nodes-base.executeWorkflow',
            position: [200, 0],
            parameters: { mode: 'id' }, // no workflowId
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Run Sub', type: 'main', index: 0 }]] },
        },
      };
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      expect(result.validationStatus).to.equal('failed');
      const errors = result.validationErrors!.join(' ');
      expect(errors).to.include('workflowId');
    });

    it('passes when Execute Workflow node has a workflowId', async () => {
      const wf = {
        nodes: [
          { id: 'n0', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          {
            id: 'n1',
            name: 'Run Sub',
            type: 'n8n-nodes-base.executeWorkflow',
            position: [200, 0],
            parameters: { mode: 'id', workflowId: 'sub-wf-123' },
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Run Sub', type: 'main', index: 0 }]] },
        },
      };
      const result = await reviewerNode(makeState({ workflowJson: wf }));
      expect(result.validationStatus).to.equal('passed');
    });
  });

  // -------------------------------------------------------------------------
  describe('availableNodeTypes strict validation', () => {
    it('flags a node whose type is not in the available list', async () => {
      const wf = {
        nodes: [
          { id: 'n0', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          {
            id: 'n1',
            name: 'Unknown Node',
            type: 'n8n-nodes-community.someCustomNode',
            position: [200, 0],
            parameters: {},
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Unknown Node', type: 'main', index: 0 }]] },
        },
      };
      const state = makeState({
        workflowJson: wf,
        availableNodeTypes: ['n8n-nodes-base.webhook', 'n8n-nodes-base.set'],
      });
      const result = await reviewerNode(state);
      expect(result.validationStatus).to.equal('failed');
      const errors = result.validationErrors!.join(' ');
      expect(errors).to.include('not available');
    });

    it('passes when all node types are in the available list', async () => {
      const wf = makeValidWorkflow();
      const state = makeState({
        workflowJson: wf,
        availableNodeTypes: ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.emailSend'],
      });
      const result = await reviewerNode(state);
      expect(result.validationStatus).to.equal('passed');
    });
  });

  // -------------------------------------------------------------------------
  describe('nested workflow structure support', () => {
    it('handles workflows wrapped in {workflows: [...]} structure', async () => {
      const wrappedWf = {
        workflows: [makeValidWorkflow()],
      };
      const result = await reviewerNode(makeState({ workflowJson: wrappedWf }));
      expect(result.validationStatus).to.equal('passed');
    });
  });

  // -------------------------------------------------------------------------
  describe('passing workflow', () => {
    it('returns passed with empty errors for a clean workflow', async () => {
      const result = await reviewerNode(makeState({ workflowJson: makeValidWorkflow() }));
      expect(result.validationStatus).to.equal('passed');
      expect(result.validationErrors).to.deep.equal([]);
    });

    it('clears previous validation errors on a clean run', async () => {
      const state = makeState({
        workflowJson: makeValidWorkflow(),
        validationErrors: ['Old error from previous run'],
      });
      const result = await reviewerNode(state);
      expect(result.validationStatus).to.equal('passed');
      expect(result.validationErrors).to.deep.equal([]);
    });
  });
});
