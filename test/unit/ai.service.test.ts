import { expect } from 'chai';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AIService } from '../../src/services/ai.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reset the AIService singleton between tests so each test gets a clean instance
 * with whatever env vars are set at the time.
 */
function resetSingleton() {
  (AIService as any).instance = undefined;
}

/**
 * Inject a mock OpenAI client into the AIService instance.
 */
function injectMockClient(service: AIService, responseContent: string) {
  (service as any).client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: responseContent } }]
        }),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: validateAndShim (public pure method)
// ---------------------------------------------------------------------------

describe('AIService', () => {
  let service: AIService;

  beforeEach(() => {
    resetSingleton();
    // Set a dummy API key so the constructor doesn't warn
    process.env.AI_API_KEY = 'test-key-only';
    service = AIService.getInstance();
  });

  afterEach(() => {
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
    resetSingleton();
  });

  // -------------------------------------------------------------------------
  describe('getInstance()', () => {
    it('returns the same instance on repeated calls', () => {
      const a = AIService.getInstance();
      const b = AIService.getInstance();
      expect(a).to.equal(b);
    });
  });

  // -------------------------------------------------------------------------
  describe('validateAndShim()', () => {
    it('returns workflow unchanged when no validNodeTypes or explicitlyInvalid provided', () => {
      const wf = {
        nodes: [{ type: 'n8n-nodes-base.set', name: 'Set Data' }],
        connections: {},
      };
      const result = service.validateAndShim(wf);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.set');
    });

    it('returns workflow unchanged when validNodeTypes is empty array', () => {
      const wf = {
        nodes: [{ type: 'n8n-nodes-base.set', name: 'Set Data' }],
        connections: {},
      };
      const result = service.validateAndShim(wf, []);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.set');
    });

    it('shims a node whose type is not in the valid list with n8n-nodes-base.set', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'n8n-nodes-community.fancyNode', name: 'Fancy' }],
        connections: {},
      };
      const result = service.validateAndShim(wf, ['n8n-nodes-base.set', 'n8n-nodes-base.webhook']);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.set');
    });

    it('shims an API-like node to n8n-nodes-base.httpRequest', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'n8n-nodes-community.slackCustom', name: 'Slack Custom' }],
        connections: {},
      };
      const result = service.validateAndShim(wf, ['n8n-nodes-base.set']);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.httpRequest');
    });

    it('shims a trigger-like unknown node to n8n-nodes-base.webhook', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'n8n-nodes-community.customTrigger', name: 'Custom Trigger' }],
        connections: {},
      };
      const result = service.validateAndShim(wf, ['n8n-nodes-base.set']);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.webhook');
    });

    it('keeps a valid node type unchanged when it is in the valid list', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'n8n-nodes-base.httpRequest', name: 'HTTP' }],
        connections: {},
      };
      const result = service.validateAndShim(wf, ['n8n-nodes-base.httpRequest', 'n8n-nodes-base.set']);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.httpRequest');
    });

    it('shims explicitly invalid node types regardless of valid list', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'n8n-nodes-base.schedule', name: 'Schedule' }],
        connections: {},
      };
      const result = service.validateAndShim(wf, ['n8n-nodes-base.schedule'], ['n8n-nodes-base.schedule']);
      // schedule is explicitly invalid so it should be shimmed
      expect(result.nodes[0].type).to.not.equal('n8n-nodes-base.schedule');
    });

    it('adds notes to shimmed nodes explaining the original type', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'n8n-nodes-community.unknownNode', name: 'Unknown' }],
        connections: {},
      };
      const result = service.validateAndShim(wf, ['n8n-nodes-base.set']);
      expect(result.nodes[0].notes).to.include('n8n-nodes-community.unknownNode');
    });

    it('returns unchanged workflow when nodes array is empty', () => {
      const wf = { nodes: [], connections: {} };
      const result = service.validateAndShim(wf, ['n8n-nodes-base.set']);
      expect(result.nodes).to.deep.equal([]);
    });

    it('returns workflow unchanged if it has no nodes property', () => {
      const wf = { connections: {} };
      const result = service.validateAndShim(wf as any, ['n8n-nodes-base.set']);
      expect(result).to.deep.equal({ connections: {} });
    });

    it('handles null workflow gracefully', () => {
      const result = service.validateAndShim(null as any, ['n8n-nodes-base.set']);
      expect(result).to.be.null;
    });
  });

  // -------------------------------------------------------------------------
  describe('fixHallucinatedNodes (via private access)', () => {
    const corrections: Array<[string, string]> = [
      ['n8n-nodes-base.rssFeed', 'n8n-nodes-base.rssFeedRead'],
      ['rssFeed', 'n8n-nodes-base.rssFeedRead'],
      ['n8n-nodes-base.gpt', 'n8n-nodes-base.openAi'],
      ['n8n-nodes-base.openai', 'n8n-nodes-base.openAi'],
      ['openai', 'n8n-nodes-base.openAi'],
      ['n8n-nodes-base.openAiChat', 'n8n-nodes-base.openAi'],
      ['n8n-nodes-base.gemini', 'n8n-nodes-base.googleGemini'],
      ['n8n-nodes-base.cheerioHtml', 'n8n-nodes-base.htmlExtract'],
      ['cheerioHtml', 'n8n-nodes-base.htmlExtract'],
      ['n8n-nodes-base.schedule', 'n8n-nodes-base.scheduleTrigger'],
      ['schedule', 'n8n-nodes-base.scheduleTrigger'],
      ['n8n-nodes-base.cron', 'n8n-nodes-base.scheduleTrigger'],
    ];

    for (const [input, expected] of corrections) {
      it(`corrects "${input}" to "${expected}"`, () => {
        const wf = {
          nodes: [{ id: 'n1', type: input, name: 'Node' }],
          connections: {},
        };
        const result = (service as any).fixHallucinatedNodes(wf);
        expect(result.nodes[0].type).to.equal(expected);
      });
    }

    it('prefixes bare node types (no namespace) with n8n-nodes-base.', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'emailSend', name: 'Email' }],
        connections: {},
      };
      const result = (service as any).fixHallucinatedNodes(wf);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.emailSend');
    });

    it('does not modify already-correct types', () => {
      const wf = {
        nodes: [{ id: 'n1', type: 'n8n-nodes-base.httpRequest', name: 'HTTP' }],
        connections: {},
      };
      const result = (service as any).fixHallucinatedNodes(wf);
      expect(result.nodes[0].type).to.equal('n8n-nodes-base.httpRequest');
    });

    it('returns workflow unchanged when nodes is missing', () => {
      const wf = { connections: {} };
      const result = (service as any).fixHallucinatedNodes(wf);
      expect(result).to.deep.equal(wf);
    });
  });

  // -------------------------------------------------------------------------
  describe('fixN8nConnections (via private access)', () => {
    it('normalizes string connection targets to proper objects', () => {
      const wf = {
        nodes: [],
        connections: {
          'Node A': { main: [['Node B']] },
        },
      };
      const result = (service as any).fixN8nConnections(wf);
      const conn = result.connections['Node A'].main[0][0];
      expect(conn).to.deep.equal({ node: 'Node B', type: 'main', index: 0 });
    });

    it('normalizes non-array main to a wrapped array', () => {
      const wf = {
        nodes: [],
        connections: {
          'Node A': { main: 'Node B' as any },
        },
      };
      const result = (service as any).fixN8nConnections(wf);
      const conn = result.connections['Node A'].main[0][0];
      expect(conn.node).to.equal('Node B');
    });

    it('preserves valid connection structure without modification', () => {
      const wf = {
        nodes: [],
        connections: {
          'Node A': { main: [[{ node: 'Node B', type: 'main', index: 0 }]] },
        },
      };
      const result = (service as any).fixN8nConnections(wf);
      expect(result.connections['Node A'].main[0][0]).to.deep.equal({
        node: 'Node B',
        type: 'main',
        index: 0,
      });
    });

    it('handles null segments gracefully (replaces with empty array)', () => {
      const wf = {
        nodes: [],
        connections: {
          'Node A': { main: [null as any] },
        },
      };
      const result = (service as any).fixN8nConnections(wf);
      expect(result.connections['Node A'].main[0]).to.deep.equal([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('generateContent() with mocked client', () => {
    it('returns the content from the AI response', async () => {
      injectMockClient(service, 'hello world');
      const result = await service.generateContent('test prompt');
      expect(result).to.equal('hello world');
    });

    it('throws when all retries are exhausted on a non-retryable error', async () => {
      (service as any).client = {
        chat: {
          completions: {
            create: async () => { throw new Error('Permanent failure'); }
          }
        }
      };
      try {
        await service.generateContent('test');
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('Permanent failure');
      }
    });

    it('handles unauthorized error with status 401', async () => {
      (service as any).client = {
        chat: {
          completions: {
            create: async () => {
              const err: any = new Error('Unauthorized');
              err.status = 401;
              throw err;
            },
          },
        },
      };
      try {
        await service.generateContent('test');
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('Unauthorized');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('generateSpec() with mocked client', () => {
    it('parses valid JSON returned by the AI', async () => {
      const specObj = { suggestedName: 'Email Sender', description: 'Send email', nodes: [] };
      injectMockClient(service, JSON.stringify(specObj));
      const result = await service.generateSpec('Send an email on trigger');
      expect(result.description).to.equal('Send email');
      expect(result.suggestedName).to.equal('Email Sender');
    });

    it('strips markdown code fences before parsing', async () => {
      const specObj = { suggestedName: 'Test WF', description: 'Test', nodes: [] };
      injectMockClient(service, '```json\n' + JSON.stringify(specObj) + '\n```');
      const result = await service.generateSpec('Test');
      expect(result.description).to.equal('Test');
    });

    it('throws when the AI returns invalid JSON', async () => {
      injectMockClient(service, 'not valid json at all');
      try {
        await service.generateSpec('test');
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('invalid JSON');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('generateMockData() with mocked client', () => {
    it('returns parsed JSON payload', async () => {
      injectMockClient(service, '{"userId": 42, "action": "click"}');
      const result = await service.generateMockData('webhook trigger for user events');
      expect(result.userId).to.equal(42);
    });

    it('strips markdown fences before parsing', async () => {
      injectMockClient(service, '```json\n{"key": "value"}\n```');
      const result = await service.generateMockData('context');
      expect(result.key).to.equal('value');
    });

    it('returns fallback object when AI returns invalid JSON', async () => {
      injectMockClient(service, 'this is not json');
      const result = await service.generateMockData('context');
      expect(result).to.have.property('message');
    });
  });

  // -------------------------------------------------------------------------
  describe('generateWorkflow() with mocked client', () => {
    it('returns a parsed workflow object', async () => {
      const wf = { nodes: [{ type: 'n8n-nodes-base.set', name: 'Set' }], connections: {} };
      injectMockClient(service, JSON.stringify(wf));
      const result = await service.generateWorkflow('simple set workflow');
      expect(result.nodes).to.have.length(1);
    });

    it('throws when AI returns invalid JSON', async () => {
      injectMockClient(service, 'INVALID JSON {{{');
      try {
        await service.generateWorkflow('description');
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('invalid JSON');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('config file fallback', () => {
    const configFile = path.join(os.homedir(), '.n8m', 'config.json');
    const configDir = path.join(os.homedir(), '.n8m');
    let originalConfig: string | null = null;

    beforeEach(async () => {
      // Save existing config (if any) so we can restore it
      try {
        originalConfig = await fs.readFile(configFile, 'utf-8');
      } catch {
        originalConfig = null;
      }
      // Clear all AI env vars so the fallback is exercised
      delete process.env.AI_API_KEY;
      delete process.env.AI_PROVIDER;
      delete process.env.AI_MODEL;
      delete process.env.AI_BASE_URL;
      resetSingleton();
    });

    afterEach(async () => {
      // Restore original config
      if (originalConfig !== null) {
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(configFile, originalConfig);
      } else {
        try { await fs.unlink(configFile); } catch { /* already gone */ }
      }
      resetSingleton();
    });

    it('uses aiModel from config file when AI_MODEL env var is not set', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, JSON.stringify({ aiKey: 'file-key', aiModel: 'gpt-4-turbo' }));

      resetSingleton();
      const svc = AIService.getInstance();
      expect((svc as any).model).to.equal('gpt-4-turbo');
    });

    it('prefers AI_MODEL env var over config file aiModel', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, JSON.stringify({ aiKey: 'file-key', aiModel: 'gpt-4-turbo' }));

      process.env.AI_API_KEY = 'env-key';
      process.env.AI_MODEL = 'gpt-4o-mini';
      resetSingleton();
      const svc = AIService.getInstance();
      expect((svc as any).model).to.equal('gpt-4o-mini');
      delete process.env.AI_MODEL;
    });

    it('uses provider default model when neither env var nor config file sets aiModel', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, JSON.stringify({ aiKey: 'file-key', aiProvider: 'anthropic' }));

      resetSingleton();
      const svc = AIService.getInstance();
      expect((svc as any).model).to.equal('claude-sonnet-4-6');
    });

    it('falls back to gpt-4o when no model info is available anywhere', async () => {
      // Write config with only aiKey, no model or provider
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, JSON.stringify({ aiKey: 'file-key' }));

      resetSingleton();
      const svc = AIService.getInstance();
      expect((svc as any).model).to.equal('gpt-4o');
    });

    it('does not warn when aiKey is present in config file', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, JSON.stringify({ aiKey: 'sk-from-file' }));

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => warnings.push(args.join(' '));

      resetSingleton();
      AIService.getInstance();

      console.warn = origWarn;
      expect(warnings.filter(w => w.includes('No AI key found'))).to.have.length(0);
    });

    it('warns when neither env var nor config file provides an API key', async () => {
      // Config file exists but has no aiKey
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, JSON.stringify({ n8nUrl: 'http://n8n.local' }));

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => warnings.push(args.join(' '));

      resetSingleton();
      AIService.getInstance();

      console.warn = origWarn;
      expect(warnings.some(w => w.includes('No AI key found'))).to.be.true;
    });
  });

  // -------------------------------------------------------------------------
  describe('generateAlternativeSpec() with mocked client', () => {
    it('returns parsed alternative spec from AI response', async () => {
      const alt = {
        suggestedName: 'Alt WF', description: 'Alt goal', nodes: [],
        strategyName: 'alternative',
      };
      injectMockClient(service, JSON.stringify(alt));
      const primary = { suggestedName: 'Primary WF', description: 'Primary goal', nodes: [] };
      const result = await service.generateAlternativeSpec('some goal', primary as any);
      expect(result.suggestedName).to.equal('Alt WF');
      expect(result.strategyName).to.equal('alternative');
    });

    it('strips markdown code fences before parsing', async () => {
      const alt = { suggestedName: 'Alt WF', description: 'Alt', nodes: [], strategyName: 'alternative' };
      injectMockClient(service, '```json\n' + JSON.stringify(alt) + '\n```');
      const result = await service.generateAlternativeSpec('goal', {} as any);
      expect(result.suggestedName).to.equal('Alt WF');
    });

    it('falls back to a primary-spec variant when AI returns invalid JSON', async () => {
      injectMockClient(service, 'not valid json at all');
      const primary = { suggestedName: 'Primary WF', description: 'Primary', nodes: [] };
      const result = await service.generateAlternativeSpec('goal', primary as any);
      expect(result.suggestedName).to.equal('Primary WF (Alt)');
      expect(result.strategyName).to.equal('alternative');
    });

    it('preserves all fields from the AI response', async () => {
      const alt = {
        suggestedName: 'Webhook Alt', description: 'Send webhook',
        nodes: [{ type: 'n8n-nodes-base.webhook', purpose: 'entry' }],
        strategyName: 'alternative',
      };
      injectMockClient(service, JSON.stringify(alt));
      const result = await service.generateAlternativeSpec('Send webhook notification', {} as any);
      expect(result.nodes).to.have.length(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('generatePattern() with mocked client', () => {
    it('returns content string and a slug derived from the workflow name', async () => {
      injectMockClient(service, '<!-- keywords: bigquery, sql -->\n# Pattern: BigQuery\n\nUse HTTP.');
      const wf = { name: 'Substack to BigQuery', nodes: [], connections: {} };
      const result = await service.generatePattern(wf);
      expect(result.content).to.include('# Pattern: BigQuery');
      expect(result.slug).to.equal('substack-to-bigquery');
    });

    it('lowercases and hyphenates the slug', async () => {
      injectMockClient(service, '<!-- keywords: test -->\n# Pattern: Test');
      const wf = { name: 'My Awesome  Workflow!', nodes: [], connections: {} };
      const { slug } = await service.generatePattern(wf);
      expect(slug).to.match(/^[a-z0-9-]+$/);
      expect(slug).to.equal('my-awesome-workflow');
    });

    it('falls back to "workflow" slug when name is missing', async () => {
      injectMockClient(service, '<!-- keywords: test -->\n# Pattern: Test');
      const wf = { nodes: [], connections: {} };
      const { slug } = await service.generatePattern(wf as any);
      expect(slug).to.equal('workflow');
    });

    it('strips only name/nodes/connections from the workflow before sending', async () => {
      let capturedPrompt = '';
      (service as any).client = {
        chat: {
          completions: {
            create: async (opts: any) => {
              capturedPrompt = opts.messages[0].content;
              return { choices: [{ message: { content: '<!-- keywords: x -->\n# P' } }] };
            },
          },
        },
      };
      const wf = {
        name: 'Test WF',
        nodes: [{ name: 'HTTP', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://example.com' } }],
        connections: { HTTP: { main: [] } },
        id: 'should-not-appear',
        meta: { instanceId: 'should-not-appear' },
      };
      await service.generatePattern(wf);
      expect(capturedPrompt).to.include('"name": "Test WF"');
      expect(capturedPrompt).to.not.include('should-not-appear');
    });

    it('returns the full AI response as content', async () => {
      const mdContent = '<!-- keywords: slack, webhook -->\n# Pattern: Slack\n\nDetails here.';
      injectMockClient(service, mdContent);
      const wf = { name: 'Slack Notifier', nodes: [], connections: {} };
      const { content } = await service.generatePattern(wf);
      expect(content).to.equal(mdContent);
    });
  });

  // -------------------------------------------------------------------------
  describe('evaluateCandidates() with mocked client', () => {
    it('returns index 0 immediately for a single candidate without an AI call', async () => {
      // No mock injected — if AI is called this test would fail with a real API error
      const result = await service.evaluateCandidates('goal', [{ name: 'Only', nodes: [] }]);
      expect(result.selectedIndex).to.equal(0);
      expect(result.reason).to.include('Single candidate');
    });

    it('returns index 0 immediately for an empty candidates array', async () => {
      const result = await service.evaluateCandidates('goal', []);
      expect(result.selectedIndex).to.equal(0);
    });

    it('parses LLM output and returns the selected index and reason', async () => {
      injectMockClient(service, JSON.stringify({ selectedIndex: 1, reason: 'Second is better.' }));
      const candidates = [
        { name: 'First', nodes: [] },
        { name: 'Second', nodes: [{ name: 'HTTP', type: 'n8n-nodes-base.httpRequest' }] },
      ];
      const result = await service.evaluateCandidates('goal', candidates);
      expect(result.selectedIndex).to.equal(1);
      expect(result.reason).to.equal('Second is better.');
    });

    it('clamps out-of-range selectedIndex to the last valid index', async () => {
      injectMockClient(service, JSON.stringify({ selectedIndex: 99, reason: 'Out of range.' }));
      const candidates = [{ name: 'A', nodes: [] }, { name: 'B', nodes: [] }];
      const result = await service.evaluateCandidates('goal', candidates);
      expect(result.selectedIndex).to.equal(1); // clamped to candidates.length - 1
    });

    it('clamps negative selectedIndex to 0', async () => {
      injectMockClient(service, JSON.stringify({ selectedIndex: -5, reason: 'Negative.' }));
      const candidates = [{ name: 'A', nodes: [] }, { name: 'B', nodes: [] }];
      const result = await service.evaluateCandidates('goal', candidates);
      expect(result.selectedIndex).to.equal(0);
    });

    it('falls back to index 0 when AI returns invalid JSON', async () => {
      injectMockClient(service, 'not json at all');
      const candidates = [{ name: 'A', nodes: [] }, { name: 'B', nodes: [] }];
      const result = await service.evaluateCandidates('goal', candidates);
      expect(result.selectedIndex).to.equal(0);
    });

    it('strips markdown fences before parsing', async () => {
      injectMockClient(service, '```json\n' + JSON.stringify({ selectedIndex: 0, reason: 'Good.' }) + '\n```');
      const candidates = [{ name: 'A', nodes: [] }, { name: 'B', nodes: [] }];
      const result = await service.evaluateCandidates('goal', candidates);
      expect(result.selectedIndex).to.equal(0);
      expect(result.reason).to.equal('Good.');
    });

    it('uses a default reason when AI omits it', async () => {
      injectMockClient(service, JSON.stringify({ selectedIndex: 0 }));
      const candidates = [{ name: 'A', nodes: [] }, { name: 'B', nodes: [] }];
      const result = await service.evaluateCandidates('goal', candidates);
      expect(result.reason).to.be.a('string').and.have.length.above(0);
    });
  });
});
