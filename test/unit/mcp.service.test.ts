import { expect } from 'chai';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { MCPService } from '../../src/services/mcp.service.js';
import { ConfigManager } from '../../src/utils/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// MCPService — constructor and tool registration
// ---------------------------------------------------------------------------

describe('MCPService', () => {
  it('constructs without throwing', () => {
    expect(() => new MCPService()).not.to.throw();
  });
});

// ---------------------------------------------------------------------------
// MCPService.getN8nClient() — credential resolution
// ---------------------------------------------------------------------------

describe('MCPService.getN8nClient()', () => {
  const tmpDir = path.join(os.tmpdir(), `n8m-mcp-test-${Date.now()}`);
  const tmpConfigFile = path.join(tmpDir, 'config.json');

  let savedUrl: string | undefined;
  let savedKey: string | undefined;

  before(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    (ConfigManager as any).configDir = tmpDir;
    (ConfigManager as any).configFile = tmpConfigFile;

    savedUrl = process.env.N8N_API_URL;
    savedKey = process.env.N8N_API_KEY;
    delete process.env.N8N_API_URL;
    delete process.env.N8N_API_KEY;
  });

  beforeEach(async () => {
    try { await fs.unlink(tmpConfigFile); } catch { /* ok */ }
    delete process.env.N8N_API_URL;
    delete process.env.N8N_API_KEY;
  });

  afterEach(async () => {
    try { await fs.unlink(tmpConfigFile); } catch { /* ok */ }
    delete process.env.N8N_API_URL;
    delete process.env.N8N_API_KEY;
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (savedUrl !== undefined) process.env.N8N_API_URL = savedUrl;
    else delete process.env.N8N_API_URL;
    if (savedKey !== undefined) process.env.N8N_API_KEY = savedKey;
    else delete process.env.N8N_API_KEY;
  });

  it('throws when no credentials are configured', async () => {
    const service = new MCPService();
    await expectThrows(
      () => (service as any).getN8nClient(),
      'Missing n8n credentials',
    );
  });

  it('returns an N8nClient when env vars are set', async () => {
    process.env.N8N_API_URL = 'http://localhost:5678/api/v1';
    process.env.N8N_API_KEY = 'test-key';
    const service = new MCPService();
    const client = await (service as any).getN8nClient();
    expect(client).to.exist;
    expect(client.getWorkflowLink('1')).to.include('localhost:5678');
  });

  it('returns an N8nClient when config file has credentials', async () => {
    await ConfigManager.save({
      n8nUrl: 'http://config-host:5678/api/v1',
      n8nKey: 'config-key',
    });
    const service = new MCPService();
    const client = await (service as any).getN8nClient();
    expect(client.getWorkflowLink('x')).to.include('config-host');
  });

  it('config file takes priority over env vars', async () => {
    // config.n8nUrl || process.env.N8N_API_URL  →  config wins when present
    await ConfigManager.save({ n8nUrl: 'http://from-config:5678/api/v1', n8nKey: 'cfg-key' });
    process.env.N8N_API_URL = 'http://from-env:5678/api/v1';
    process.env.N8N_API_KEY = 'env-key';
    const service = new MCPService();
    const client = await (service as any).getN8nClient();
    expect(client.getWorkflowLink('1')).to.include('from-config');
  });

  it('falls back to env vars when config file has no credentials', async () => {
    process.env.N8N_API_URL = 'http://env-fallback:5678/api/v1';
    process.env.N8N_API_KEY = 'env-key';
    const service = new MCPService();
    const client = await (service as any).getN8nClient();
    expect(client.getWorkflowLink('1')).to.include('env-fallback');
  });
});
