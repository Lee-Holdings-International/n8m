import { expect } from 'chai';
import { N8nClient } from '../../src/utils/n8nClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Promise<Response>;
}

async function expectThrows(fn: () => Promise<unknown>, msgFragment: string) {
  try {
    await fn();
    throw new Error('Expected an error to be thrown, but none was.');
  } catch (err: any) {
    if (err.message === 'Expected an error to be thrown, but none was.') throw err;
    expect(err.message).to.include(msgFragment);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('N8nClient', () => {
  let client: N8nClient;
  let originalFetch: typeof global.fetch;

  before(() => {
    originalFetch = global.fetch;
    client = new N8nClient({
      apiUrl: 'http://localhost:5678/api/v1',
      apiKey: 'test-api-key',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('uses provided apiUrl and apiKey', () => {
      const c = new N8nClient({ apiUrl: 'http://custom:9000/api/v1', apiKey: 'k' });
      expect(c.getWorkflowLink('1')).to.include('http://custom:9000');
    });

    it('falls back to N8N_API_URL env var when no config provided', () => {
      const original = process.env.N8N_API_URL;
      process.env.N8N_API_URL = 'http://envhost:5678/api/v1';
      const c = new N8nClient();
      expect(c.getWorkflowLink('1')).to.include('http://envhost:5678');
      if (original === undefined) delete process.env.N8N_API_URL;
      else process.env.N8N_API_URL = original;
    });

    it('defaults to localhost:5678 when nothing is configured', () => {
      const original = process.env.N8N_API_URL;
      delete process.env.N8N_API_URL;
      const c = new N8nClient();
      expect(c.getWorkflowLink('1')).to.include('localhost:5678');
      if (original !== undefined) process.env.N8N_API_URL = original;
    });
  });

  // -------------------------------------------------------------------------
  describe('getWorkflowLink()', () => {
    it('returns correct deep-link URL by stripping /api/v1', () => {
      const link = client.getWorkflowLink('abc123');
      expect(link).to.equal('http://localhost:5678/workflow/abc123');
    });

    it('embeds the provided workflow ID in the path', () => {
      const link = client.getWorkflowLink('wf-99');
      expect(link).to.include('/workflow/wf-99');
    });
  });

  // -------------------------------------------------------------------------
  describe('injectManualTrigger()', () => {
    it('adds N8M_Shim_Webhook and Shim_Flattener nodes', () => {
      const wf = {
        nodes: [{ id: 'n1', name: 'Set Data', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }],
        connections: {},
      };
      const result = client.injectManualTrigger(wf);
      const names = result.nodes.map((n: any) => n.name);
      expect(names).to.include('N8M_Shim_Webhook');
      expect(names).to.include('Shim_Flattener');
    });

    it('total node count is original count + 2', () => {
      const wf = {
        nodes: [
          { id: 'n1', name: 'Set', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} },
          { id: 'n2', name: 'Email', type: 'n8n-nodes-base.emailSend', position: [200, 0], parameters: {} },
        ],
        connections: {},
      };
      const result = client.injectManualTrigger(wf);
      expect(result.nodes).to.have.length(4);
    });

    it('creates Webhook -> Flattener -> first non-trigger node connections', () => {
      const wf = {
        nodes: [{ id: 'n1', name: 'ProcessNode', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }],
        connections: {},
      };
      const result = client.injectManualTrigger(wf);
      expect(result.connections['N8M_Shim_Webhook']).to.exist;
      const shimTarget = result.connections['N8M_Shim_Webhook'].main[0][0].node;
      expect(shimTarget).to.equal('Shim_Flattener');
      expect(result.connections['Shim_Flattener']).to.exist;
      const flattenerTarget = result.connections['Shim_Flattener'].main[0][0].node;
      expect(flattenerTarget).to.equal('ProcessNode');
    });

    it('preserves existing connections', () => {
      const wf = {
        nodes: [
          { id: 'n1', name: 'Trigger', type: 'n8n-nodes-base.scheduleTrigger', position: [0, 0], parameters: {} },
          { id: 'n2', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          Trigger: { main: [[{ node: 'Set', type: 'main', index: 0 }]] },
        },
      };
      const result = client.injectManualTrigger(wf);
      expect(result.connections['Trigger']).to.deep.equal(wf.connections['Trigger']);
    });

    it('shim webhook node has POST method and correct type', () => {
      const wf = { nodes: [], connections: {} };
      const result = client.injectManualTrigger(wf);
      const webhook = result.nodes.find((n: any) => n.name === 'N8M_Shim_Webhook');
      expect(webhook.type).to.equal('n8n-nodes-base.webhook');
      expect(webhook.parameters.httpMethod).to.equal('POST');
    });

    it('flattener node has correct type and no webhookId', () => {
      const wf = { nodes: [], connections: {} };
      const result = client.injectManualTrigger(wf);
      const flattener = result.nodes.find((n: any) => n.name === 'Shim_Flattener');
      expect(flattener.type).to.equal('n8n-nodes-base.code');
      expect(flattener.webhookId).to.be.undefined;
    });

    it('does not duplicate existing shim connections if already present', () => {
      const wf = {
        nodes: [{ id: 'n1', name: 'Target', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }],
        connections: { N8M_Shim_Webhook: { main: [[{ node: 'Already', type: 'main', index: 0 }]] } },
      };
      const result = client.injectManualTrigger(wf);
      // The existing connection should be preserved, not overwritten
      expect(result.connections['N8M_Shim_Webhook'].main[0][0].node).to.equal('Already');
    });
  });

  // -------------------------------------------------------------------------
  describe('createWorkflow()', () => {
    it('sends POST and returns the new workflow id', async () => {
      (global as any).fetch = () => mockResponse({ id: 'created-123' });
      const result = await client.createWorkflow('My Workflow', { nodes: [], connections: {} });
      expect(result.id).to.equal('created-123');
    });

    it('includes the name in the request payload', async () => {
      let body: any;
      (global as any).fetch = (_url: string, opts: any) => {
        body = JSON.parse(opts.body);
        return mockResponse({ id: 'x' });
      };
      await client.createWorkflow('Named Workflow', { nodes: [] });
      expect(body.name).to.equal('Named Workflow');
    });

    it('throws when the server returns a non-2xx status', async () => {
      (global as any).fetch = () => mockResponse({ message: 'Bad Request' }, 400);
      await expectThrows(() => client.createWorkflow('Bad', {}), 'Failed to create workflow');
    });

    it('throws when the server returns 500', async () => {
      (global as any).fetch = () => mockResponse({}, 500);
      await expectThrows(() => client.createWorkflow('Test', {}), 'Failed to create workflow');
    });
  });

  // -------------------------------------------------------------------------
  describe('getWorkflows()', () => {
    it('returns the list of workflows from the API', async () => {
      (global as any).fetch = () =>
        mockResponse({
          data: [{ id: '1', name: 'Workflow A', active: true, updatedAt: '2024-01-01' }],
          nextCursor: null,
        });
      const workflows = await client.getWorkflows();
      expect(workflows).to.have.length(1);
      expect(workflows[0].name).to.equal('Workflow A');
    });

    it('paginates through multiple pages', async () => {
      let call = 0;
      (global as any).fetch = () => {
        call++;
        if (call === 1)
          return mockResponse({
            data: [{ id: '1', name: 'WfA', active: true, updatedAt: '2024-01-01' }],
            nextCursor: 'next-cursor',
          });
        return mockResponse({
          data: [{ id: '2', name: 'WfB', active: false, updatedAt: '2024-01-02' }],
          nextCursor: null,
        });
      };
      const workflows = await client.getWorkflows();
      expect(workflows).to.have.length(2);
      expect(call).to.equal(2);
    });

    it('throws on API error', async () => {
      (global as any).fetch = () => mockResponse({}, 500);
      await expectThrows(() => client.getWorkflows(), 'Failed to fetch workflows');
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteWorkflow()', () => {
    it('sends DELETE request to the correct endpoint', async () => {
      let method = '';
      let url = '';
      (global as any).fetch = (u: string, opts: any) => {
        url = u;
        method = opts.method;
        return mockResponse({});
      };
      await client.deleteWorkflow('wf-del-1');
      expect(method).to.equal('DELETE');
      expect(url).to.include('/workflows/wf-del-1');
    });

    it('throws on error response', async () => {
      (global as any).fetch = () => mockResponse({}, 404);
      await expectThrows(() => client.deleteWorkflow('missing'), 'Failed to delete workflow');
    });
  });

  // -------------------------------------------------------------------------
  describe('activateWorkflow()', () => {
    it('sends POST to the activate endpoint', async () => {
      let url = '';
      (global as any).fetch = (u: string) => {
        url = u;
        return mockResponse({});
      };
      await client.activateWorkflow('wf-act-1');
      expect(url).to.include('/workflows/wf-act-1/activate');
    });

    it('throws on error response', async () => {
      (global as any).fetch = () => mockResponse({ message: 'Not found' }, 404);
      await expectThrows(() => client.activateWorkflow('nope'), 'activate workflow failed');
    });
  });

  // -------------------------------------------------------------------------
  describe('deactivateWorkflow()', () => {
    it('sends POST to the deactivate endpoint', async () => {
      let url = '';
      (global as any).fetch = (u: string) => {
        url = u;
        return mockResponse({});
      };
      await client.deactivateWorkflow('wf-deact-1');
      expect(url).to.include('/workflows/wf-deact-1/deactivate');
    });

    it('throws on error response', async () => {
      (global as any).fetch = () => mockResponse({}, 403);
      await expectThrows(() => client.deactivateWorkflow('no-perms'), '403 Forbidden');
    });
  });

  // -------------------------------------------------------------------------
  describe('getWorkflowExecutions()', () => {
    it('returns the execution list for a workflow', async () => {
      (global as any).fetch = () =>
        mockResponse({ data: [{ id: 'exec-1', status: 'success', workflowId: 'wf-1' }] });
      const execs = await client.getWorkflowExecutions('wf-1');
      expect(execs).to.have.length(1);
      expect(execs[0].id).to.equal('exec-1');
    });

    it('includes workflowId as a query parameter', async () => {
      let capturedUrl = '';
      (global as any).fetch = (u: string) => {
        capturedUrl = u;
        return mockResponse({ data: [] });
      };
      await client.getWorkflowExecutions('wf-query-test');
      expect(capturedUrl).to.include('workflowId=wf-query-test');
    });

    it('throws on server error', async () => {
      (global as any).fetch = () => mockResponse({}, 500);
      await expectThrows(() => client.getWorkflowExecutions('wf-1'), 'Failed to fetch workflow executions');
    });
  });

  // -------------------------------------------------------------------------
  describe('getWorkflow()', () => {
    it('fetches a workflow by ID and returns the data', async () => {
      (global as any).fetch = () =>
        mockResponse({ id: 'wf-1', name: 'My Workflow', nodes: [], connections: {} });
      const wf = (await client.getWorkflow('wf-1')) as any;
      expect(wf.name).to.equal('My Workflow');
    });

    it('throws on 404', async () => {
      (global as any).fetch = () => mockResponse({}, 404);
      await expectThrows(() => client.getWorkflow('ghost'), 'Failed to fetch workflow');
    });
  });

  // -------------------------------------------------------------------------
  describe('updateWorkflow()', () => {
    it('sends a PUT request with the workflow payload', async () => {
      let method = '';
      let body: any;
      (global as any).fetch = (_url: string, opts: any) => {
        method = opts.method;
        body = JSON.parse(opts.body);
        return mockResponse({});
      };
      await client.updateWorkflow('wf-upd-1', { nodes: [], connections: {}, name: 'Updated' });
      expect(method).to.equal('PUT');
      expect(body.name).to.equal('Updated');
    });

    it('throws on error response', async () => {
      (global as any).fetch = () => mockResponse({ message: 'Forbidden' }, 403);
      await expectThrows(() => client.updateWorkflow('wf-1', {}), 'Failed to update workflow');
    });
  });

  // -------------------------------------------------------------------------
  describe('getExecution()', () => {
    it('fetches execution details by ID', async () => {
      (global as any).fetch = () => mockResponse({ id: 'exec-99', status: 'success', data: {} });
      const exec = (await client.getExecution('exec-99')) as any;
      expect(exec.id).to.equal('exec-99');
    });

    it('throws on error', async () => {
      (global as any).fetch = () => mockResponse({}, 404);
      await expectThrows(() => client.getExecution('missing'), 'Failed to fetch execution');
    });
  });
});
