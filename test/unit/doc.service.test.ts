import { expect } from 'chai';
import { DocService } from '../../src/services/doc.service.js';

// Reset the singleton between tests so each suite starts clean.
function resetSingleton() {
  (DocService as any).instance = undefined;
}

// A minimal workflow fixture used across multiple tests.
const simpleWorkflow = {
  name: 'My Test Workflow',
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
    { name: 'Set Data', type: 'n8n-nodes-base.set' },
    { name: 'Send Email', type: 'n8n-nodes-base.emailSend' },
  ],
  connections: {
    'Webhook': { main: [[{ node: 'Set Data', type: 'main', index: 0 }]] },
    'Set Data': { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] },
  },
};

// ---------------------------------------------------------------------------
// DocService.generateMermaid()
// ---------------------------------------------------------------------------

describe('DocService.generateMermaid()', () => {
  let service: DocService;

  beforeEach(() => {
    resetSingleton();
    process.env.AI_API_KEY = 'test-key';
    service = DocService.getInstance();
  });

  afterEach(() => {
    delete process.env.AI_API_KEY;
  });

  it('starts with "graph TD"', () => {
    const result = service.generateMermaid(simpleWorkflow);
    expect(result).to.match(/^graph TD/);
  });

  it('includes a node definition line for each node', () => {
    const result = service.generateMermaid(simpleWorkflow);
    expect(result).to.include('Webhook');
    expect(result).to.include('Set_Data');
    expect(result).to.include('Send_Email');
  });

  it('includes connection arrows between connected nodes', () => {
    const result = service.generateMermaid(simpleWorkflow);
    expect(result).to.include('Webhook --> Set_Data');
    expect(result).to.include('Set_Data --> Send_Email');
  });

  it('returns a valid graph for an empty workflow', () => {
    const result = service.generateMermaid({ nodes: [], connections: {} });
    expect(result).to.equal('graph TD\n');
  });

  it('handles workflow with nodes but no connections', () => {
    const wf = {
      nodes: [{ name: 'Start', type: 'n8n-nodes-base.start' }],
      connections: {},
    };
    const result = service.generateMermaid(wf);
    expect(result).to.include('Start');
    expect(result).not.to.include('-->');
  });

  it('escapes double-quotes in node names to single-quotes', () => {
    const wf = {
      nodes: [{ name: 'Say "Hello"', type: 'n8n-nodes-base.set' }],
      connections: {},
    };
    const result = service.generateMermaid(wf);
    expect(result).to.include("Say 'Hello'");
    expect(result).not.to.include('"Say "Hello"');
  });

  it('converts special characters in node names to underscores for IDs', () => {
    const wf = {
      nodes: [{ name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' }],
      connections: {},
    };
    const result = service.generateMermaid(wf);
    expect(result).to.include('HTTP_Request');
  });

  it('handles missing nodes property gracefully', () => {
    const result = service.generateMermaid({ connections: {} });
    expect(result).to.equal('graph TD\n');
  });

  it('handles missing connections property gracefully', () => {
    const wf = { nodes: [{ name: 'A', type: 'n8n-nodes-base.set' }] };
    const result = service.generateMermaid(wf);
    expect(result).to.include('A');
    expect(result).not.to.include('-->');
  });
});

// ---------------------------------------------------------------------------
// DocService.generateSlug()
// ---------------------------------------------------------------------------

describe('DocService.generateSlug()', () => {
  let service: DocService;

  beforeEach(() => {
    resetSingleton();
    process.env.AI_API_KEY = 'test-key';
    service = DocService.getInstance();
  });

  afterEach(() => {
    delete process.env.AI_API_KEY;
  });

  it('lowercases the name', () => {
    expect(service.generateSlug('MyWorkflow')).to.equal('myworkflow');
  });

  it('replaces spaces with hyphens', () => {
    expect(service.generateSlug('Send Slack Notification')).to.equal('send-slack-notification');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(service.generateSlug('Workflow: "v2.0"')).to.equal('workflow-v2-0');
  });

  it('collapses multiple consecutive special chars to one hyphen', () => {
    expect(service.generateSlug('hello   world')).to.equal('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(service.generateSlug('  My Workflow  ')).to.equal('my-workflow');
  });

  it('handles already-slug string unchanged', () => {
    expect(service.generateSlug('my-workflow-123')).to.equal('my-workflow-123');
  });

  it('handles empty string', () => {
    expect(service.generateSlug('')).to.equal('');
  });
});
