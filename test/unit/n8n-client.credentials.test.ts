import { expect } from 'chai';
import { N8nClient } from '../../src/utils/n8nClient.js';

// Helper to create a mock Response
const mockResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

describe('N8nClient.getCredentials()', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('returns credentials from a flat array response', async () => {
    globalThis.fetch = async () =>
      mockResponse([
        { id: '1', name: 'My Slack', type: 'slackApi' },
        { id: '2', name: 'Gmail OAuth', type: 'gmailOAuth2Api' },
      ]);

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([
      { id: '1', name: 'My Slack', type: 'slackApi' },
      { id: '2', name: 'Gmail OAuth', type: 'gmailOAuth2Api' },
    ]);
  });

  it('returns credentials from a paginated { data, nextCursor } response', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return mockResponse({ data: [{ id: '1', name: 'Slack', type: 'slackApi' }], nextCursor: 'abc123' });
      }
      return mockResponse({ data: [{ id: '2', name: 'Gmail', type: 'gmailOAuth2Api' }], nextCursor: null });
    };

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.have.length(2);
    expect(callCount).to.equal(2);
    expect(result[0].name).to.equal('Slack');
    expect(result[1].name).to.equal('Gmail');
  });

  it('follows cursor until nextCursor is absent', async () => {
    const pages = [
      { data: [{ id: '1', name: 'A', type: 'typeA' }], nextCursor: 'page2' },
      { data: [{ id: '2', name: 'B', type: 'typeB' }], nextCursor: 'page3' },
      { data: [{ id: '3', name: 'C', type: 'typeC' }] },
    ];
    let callCount = 0;
    globalThis.fetch = async () => mockResponse(pages[callCount++]);

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.have.length(3);
    expect(callCount).to.equal(3);
  });

  it('returns [] when response is an empty array', async () => {
    globalThis.fetch = async () => mockResponse([]);

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([]);
  });

  it('returns [] when response has empty data array', async () => {
    globalThis.fetch = async () => mockResponse({ data: [] });

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([]);
  });

  // ─── Error handling (graceful degradation) ───────────────────────────────────

  it('returns [] on 403 Forbidden', async () => {
    globalThis.fetch = async () => new Response('Forbidden', { status: 403 });

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([]);
  });

  it('returns [] on 401 Unauthorized', async () => {
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([]);
  });

  it('returns [] on 500 server error', async () => {
    globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([]);
  });

  it('returns [] on network error (ECONNREFUSED)', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([]);
  });

  it('returns [] when response body is an unexpected object shape', async () => {
    globalThis.fetch = async () => mockResponse({ unexpected: 'shape' });

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const result = await client.getCredentials();

    expect(result).to.deep.equal([]);
  });

  // ─── HTTP contract ────────────────────────────────────────────────────────────

  it('sends X-N8N-API-KEY header', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (_url: unknown, opts: RequestInit = {}) => {
      capturedHeaders = (opts.headers as Record<string, string>) ?? {};
      return mockResponse([]);
    };

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'my-secret-key' });
    await client.getCredentials();

    expect(capturedHeaders['X-N8N-API-KEY']).to.equal('my-secret-key');
  });

  it('uses GET method', async () => {
    let capturedMethod = '';
    globalThis.fetch = async (_url: unknown, opts: RequestInit = {}) => {
      capturedMethod = opts.method ?? '';
      return mockResponse([]);
    };

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    await client.getCredentials();

    expect(capturedMethod).to.equal('GET');
  });

  it('hits the /credentials endpoint', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (url: unknown) => {
      capturedUrl = String(url);
      return mockResponse([]);
    };

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    await client.getCredentials();

    expect(capturedUrl).to.include('/credentials');
  });

  it('appends cursor param on subsequent paginated calls', async () => {
    const capturedUrls: string[] = [];
    let callCount = 0;
    globalThis.fetch = async (url: unknown) => {
      capturedUrls.push(String(url));
      callCount++;
      if (callCount === 1) return mockResponse({ data: [{ id: '1', name: 'A', type: 'tA' }], nextCursor: 'cur1' });
      return mockResponse({ data: [] });
    };

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    await client.getCredentials();

    expect(capturedUrls[1]).to.include('cursor=cur1');
  });

  // ─── Output shape ─────────────────────────────────────────────────────────────

  it('maps each credential to { id, name, type }', async () => {
    globalThis.fetch = async () =>
      mockResponse([{ id: 'abc', name: 'My Cred', type: 'myType', extra: 'ignored' }]);

    const client = new N8nClient({ apiUrl: 'http://localhost:5678/api/v1', apiKey: 'test-key' });
    const [cred] = await client.getCredentials();

    expect(cred).to.deep.equal({ id: 'abc', name: 'My Cred', type: 'myType' });
    expect(cred).to.not.have.property('extra');
  });
});
