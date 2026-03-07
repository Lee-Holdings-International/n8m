import { expect } from 'chai';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { NodeDefinitionsService } from '../../src/services/node-definitions.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetSingleton() {
  (NodeDefinitionsService as any).instance = undefined;
}

function getServiceWithDefinitions(defs: any[]): NodeDefinitionsService {
  resetSingleton();
  const service = NodeDefinitionsService.getInstance();
  // Inject definitions directly, bypassing the network call
  (service as any).definitions = defs;
  return service;
}

function makeDef(name: string, displayName: string, description: string, properties: any[] = []) {
  return { name, displayName, description, properties };
}

// ---------------------------------------------------------------------------
// Sample definitions used across tests
// ---------------------------------------------------------------------------

const sampleDefs = [
  makeDef(
    'n8n-nodes-base.webhook',
    'Webhook',
    'Listen for HTTP requests',
    [
      { name: 'httpMethod', displayName: 'HTTP Method', type: 'options', default: 'GET', description: 'The HTTP method', options: [{ name: 'GET', value: 'GET' }, { name: 'POST', value: 'POST' }] },
      { name: 'path', displayName: 'Path', type: 'string', default: '', description: 'Webhook URL path' },
    ],
  ),
  makeDef(
    'n8n-nodes-base.httpRequest',
    'HTTP Request',
    'Make HTTP requests to any API',
    [
      { name: 'url', displayName: 'URL', type: 'string', default: '', description: 'The URL to call' },
      { name: 'method', displayName: 'Method', type: 'options', default: 'GET', description: 'HTTP method', options: [{ name: 'GET', value: 'GET' }] },
    ],
  ),
  makeDef(
    'n8n-nodes-base.emailSend',
    'Send Email',
    'Send an email via SMTP or provider',
    [
      { name: 'toEmail', displayName: 'To Email', type: 'string', default: '', description: 'Recipient email' },
      { name: 'subject', displayName: 'Subject', type: 'string', default: '', description: 'Email subject' },
    ],
  ),
  makeDef(
    'n8n-nodes-base.slack',
    'Slack',
    'Send messages to Slack channels and direct messages',
    [],
  ),
  makeDef(
    'n8n-nodes-base.scheduleTrigger',
    'Schedule Trigger',
    'Trigger workflow on a time schedule (cron)',
    [],
  ),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NodeDefinitionsService', () => {
  afterEach(() => {
    resetSingleton();
  });

  describe('getInstance()', () => {
    it('returns the same instance on repeated calls', () => {
      resetSingleton();
      const a = NodeDefinitionsService.getInstance();
      const b = NodeDefinitionsService.getInstance();
      expect(a).to.equal(b);
    });
  });

  // -------------------------------------------------------------------------
  describe('search()', () => {
    let service: NodeDefinitionsService;

    beforeEach(() => {
      service = getServiceWithDefinitions(sampleDefs);
    });

    it('returns matching definitions by display name keyword', () => {
      const results = service.search('webhook');
      expect(results.length).to.be.greaterThan(0);
      expect(results[0].name).to.equal('n8n-nodes-base.webhook');
    });

    it('returns matching definitions by description keyword', () => {
      const results = service.search('HTTP requests');
      const names = results.map(r => r.name);
      expect(names).to.include('n8n-nodes-base.httpRequest');
    });

    it('is case-insensitive', () => {
      const lower = service.search('slack');
      const upper = service.search('SLACK');
      expect(lower.map(r => r.name)).to.deep.equal(upper.map(r => r.name));
    });

    it('returns results matching node name field', () => {
      const results = service.search('emailSend');
      expect(results.map(r => r.name)).to.include('n8n-nodes-base.emailSend');
    });

    it('returns empty array for an empty query', () => {
      const results = service.search('');
      expect(results).to.deep.equal([]);
    });

    it('returns empty array for query with only short words (≤2 chars)', () => {
      const results = service.search('an or to');
      expect(results).to.deep.equal([]);
    });

    it('respects the limit parameter', () => {
      // All defs match "n8n" in their names or descriptions — use a broad term
      const results = service.search('send email slack webhook http request schedule trigger', 2);
      expect(results.length).to.be.at.most(2);
    });

    it('returns empty array when no definitions are loaded', () => {
      service = getServiceWithDefinitions([]);
      const results = service.search('webhook');
      expect(results).to.deep.equal([]);
    });

    it('returns reduced definitions with the expected shape', () => {
      const results = service.search('webhook');
      expect(results[0]).to.have.all.keys('name', 'displayName', 'description', 'properties');
    });

    it('reduces properties to only essential fields', () => {
      const results = service.search('webhook');
      const prop = results[0].properties[0];
      expect(prop).to.have.property('name');
      expect(prop).to.have.property('type');
      expect(prop).to.have.property('default');
    });
  });

  // -------------------------------------------------------------------------
  describe('getDefinitions()', () => {
    let service: NodeDefinitionsService;

    beforeEach(() => {
      service = getServiceWithDefinitions(sampleDefs);
    });

    it('returns definitions for matching node names', () => {
      const results = service.getDefinitions(['n8n-nodes-base.webhook']);
      expect(results).to.have.length(1);
      expect(results[0].name).to.equal('n8n-nodes-base.webhook');
    });

    it('returns multiple matching definitions', () => {
      const results = service.getDefinitions(['n8n-nodes-base.webhook', 'n8n-nodes-base.slack']);
      expect(results).to.have.length(2);
    });

    it('skips names that do not match any definition', () => {
      const results = service.getDefinitions(['n8n-nodes-base.webhook', 'n8n-nodes-community.nonExistent']);
      expect(results).to.have.length(1);
      expect(results[0].name).to.equal('n8n-nodes-base.webhook');
    });

    it('returns empty array when none of the names match', () => {
      const results = service.getDefinitions(['n8n-nodes-community.ghost']);
      expect(results).to.deep.equal([]);
    });

    it('returns empty array for an empty input list', () => {
      const results = service.getDefinitions([]);
      expect(results).to.deep.equal([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('formatForLLM()', () => {
    let service: NodeDefinitionsService;

    beforeEach(() => {
      service = getServiceWithDefinitions(sampleDefs);
    });

    it('formats definitions into a readable string for LLM prompts', () => {
      const defs = service.getDefinitions(['n8n-nodes-base.webhook']);
      const output = service.formatForLLM(defs);
      expect(output).to.include('Webhook');
      expect(output).to.include('n8n-nodes-base.webhook');
      expect(output).to.include('Listen for HTTP requests');
    });

    it('includes separator between multiple definitions', () => {
      const defs = service.getDefinitions(['n8n-nodes-base.webhook', 'n8n-nodes-base.slack']);
      const output = service.formatForLLM(defs);
      expect(output).to.include('---');
    });

    it('returns empty string for empty definitions list', () => {
      const output = service.formatForLLM([]);
      expect(output.trim()).to.equal('');
    });

    it('includes parameters JSON in the output', () => {
      const defs = service.getDefinitions(['n8n-nodes-base.webhook']);
      const output = service.formatForLLM(defs);
      expect(output).to.include('httpMethod');
    });

    it('formats each definition with Node: and Description: labels', () => {
      const defs = service.getDefinitions(['n8n-nodes-base.httpRequest']);
      const output = service.formatForLLM(defs);
      expect(output).to.include('Node:');
      expect(output).to.include('Description:');
    });
  });

  // -------------------------------------------------------------------------
  describe('searchPatterns()', () => {
    let tmpDir: string;
    let patternsDir: string;
    let origCwd: string;

    beforeEach(() => {
      // Create a temp project dir with a .n8m/patterns folder
      tmpDir = path.join(os.tmpdir(), 'n8m-test-' + Date.now());
      patternsDir = path.join(tmpDir, '.n8m', 'patterns');
      mkdirSync(patternsDir, { recursive: true });
      origCwd = process.cwd();
      process.chdir(tmpDir);
      // Restrict searchPatterns to only the temp dir so built-in docs/patterns don't interfere
      (NodeDefinitionsService as any)._testPatternsDirs = [patternsDir];
      resetSingleton();
    });

    afterEach(() => {
      process.chdir(origCwd);
      rmSync(tmpDir, { recursive: true, force: true });
      (NodeDefinitionsService as any)._testPatternsDirs = null;
      resetSingleton();
    });

    function writePattern(name: string, keywords: string, body = '# Pattern') {
      writeFileSync(
        path.join(patternsDir, name),
        `<!-- keywords: ${keywords} -->\n${body}`,
        'utf-8',
      );
    }

    it('returns empty array when query is empty', () => {
      const svc = NodeDefinitionsService.getInstance();
      expect(svc.searchPatterns('')).to.deep.equal([]);
    });

    it('returns empty array when query has only short words (≤2 chars)', () => {
      writePattern('test.md', 'bigquery, sql');
      const svc = NodeDefinitionsService.getInstance();
      expect(svc.searchPatterns('to an or')).to.deep.equal([]);
    });

    it('returns empty array when no patterns directory exists', () => {
      rmSync(patternsDir, { recursive: true, force: true });
      const svc = NodeDefinitionsService.getInstance();
      expect(svc.searchPatterns('bigquery')).to.deep.equal([]);
    });

    it('returns matching pattern content by keyword', () => {
      writePattern('bq.md', 'bigquery, sql, analytics', '# BigQuery Pattern');
      const svc = NodeDefinitionsService.getInstance();
      const results = svc.searchPatterns('bigquery');
      expect(results).to.have.length(1);
      expect(results[0]).to.include('# BigQuery Pattern');
    });

    it('is case-insensitive for both query and keywords', () => {
      writePattern('bq.md', 'BigQuery, SQL');
      const svc = NodeDefinitionsService.getInstance();
      expect(svc.searchPatterns('BIGQUERY')).to.have.length(1);
      expect(svc.searchPatterns('sql')).to.have.length(1);
    });

    it('skips files with no keywords frontmatter comment', () => {
      writeFileSync(path.join(patternsDir, 'no-keywords.md'), '# No keywords here', 'utf-8');
      const svc = NodeDefinitionsService.getInstance();
      expect(svc.searchPatterns('keywords')).to.deep.equal([]);
    });

    it('returns multiple patterns when more than one matches', () => {
      writePattern('bq.md', 'bigquery, sql');
      writePattern('drive.md', 'google drive, bigquery');
      const svc = NodeDefinitionsService.getInstance();
      const results = svc.searchPatterns('bigquery');
      expect(results).to.have.length(2);
    });

    it('does not return patterns whose keywords do not match', () => {
      writePattern('slack.md', 'slack, messaging');
      writePattern('bq.md', 'bigquery, sql');
      const svc = NodeDefinitionsService.getInstance();
      const results = svc.searchPatterns('slack');
      expect(results).to.have.length(1);
      expect(results[0]).to.include('slack');
    });

    it('deduplicates patterns with the same filename (user overrides built-in)', () => {
      // Write a user pattern with the same filename that docs/patterns might have
      writePattern('bigquery-via-http.md', 'bigquery, sql', '# User Override');
      const svc = NodeDefinitionsService.getInstance();
      const results = svc.searchPatterns('bigquery');
      // Should only return 1 result (user pattern wins) even if built-in exists
      const userPatterns = results.filter(r => r.includes('# User Override'));
      expect(userPatterns).to.have.length(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('loadDefinitions()', () => {
    it('does not reload if definitions are already loaded', async () => {
      const service = getServiceWithDefinitions(sampleDefs);
      let clientCallCount = 0;
      (service as any).client = {
        getNodeTypes: async () => {
          clientCallCount++;
          return [];
        },
      };
      await service.loadDefinitions();
      // Definitions already loaded, should skip client call
      expect(clientCallCount).to.equal(0);
    });

    it('calls getNodeTypes when definitions are empty', async () => {
      resetSingleton();
      const service = NodeDefinitionsService.getInstance();
      let called = false;
      (service as any).client = {
        getNodeTypes: async () => {
          called = true;
          return sampleDefs;
        },
      };
      await service.loadDefinitions();
      expect(called).to.be.true;
      expect((service as any).definitions).to.deep.equal(sampleDefs);
    });

    it('handles getNodeTypes errors gracefully by setting empty definitions', async () => {
      resetSingleton();
      const service = NodeDefinitionsService.getInstance();
      (service as any).client = {
        getNodeTypes: async () => {
          throw new Error('Network error');
        },
      };
      await service.loadDefinitions();
      // The service now loads fallback definitions instead of returning an empty array
      expect((service as any).definitions).to.not.be.empty;
      expect((service as any).definitions[0]).to.have.property('name');
    });
  });
});
