import { expect } from 'chai';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ConfigManager } from '../../src/utils/config.js';

const tmpDir = path.join(os.tmpdir(), `n8m-config-test-${Date.now()}`);
const tmpConfigFile = path.join(tmpDir, 'config.json');

describe('ConfigManager', () => {
  before(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    // Override static private paths to use temp directory
    (ConfigManager as any).configDir = tmpDir;
    (ConfigManager as any).configFile = tmpConfigFile;
  });

  afterEach(async () => {
    try {
      await fs.unlink(tmpConfigFile);
    } catch {
      // File may not exist
    }
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('load()', () => {
    it('returns empty object when config file does not exist', async () => {
      const config = await ConfigManager.load();
      expect(config).to.deep.equal({});
    });

    it('returns saved config when file exists', async () => {
      await fs.writeFile(tmpConfigFile, JSON.stringify({ n8nUrl: 'http://test.local/api/v1' }));
      const config = await ConfigManager.load();
      expect(config.n8nUrl).to.equal('http://test.local/api/v1');
    });

    it('returns empty object when file contains invalid JSON', async () => {
      await fs.writeFile(tmpConfigFile, 'not-valid-json');
      const config = await ConfigManager.load();
      expect(config).to.deep.equal({});
    });

    it('returns full config with both fields', async () => {
      await fs.writeFile(
        tmpConfigFile,
        JSON.stringify({ n8nUrl: 'http://example.com/api/v1', n8nKey: 'my-secret-key' }),
      );
      const config = await ConfigManager.load();
      expect(config.n8nUrl).to.equal('http://example.com/api/v1');
      expect(config.n8nKey).to.equal('my-secret-key');
    });
  });

  describe('save()', () => {
    it('creates the config file with provided values', async () => {
      await ConfigManager.save({ n8nUrl: 'http://new.local/api/v1' });
      const raw = await fs.readFile(tmpConfigFile, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.n8nUrl).to.equal('http://new.local/api/v1');
    });

    it('merges with existing config (deep merge)', async () => {
      await ConfigManager.save({ n8nUrl: 'http://first.com/api/v1' });
      await ConfigManager.save({ n8nKey: 'some-api-key' });
      const config = await ConfigManager.load();
      expect(config.n8nUrl).to.equal('http://first.com/api/v1');
      expect(config.n8nKey).to.equal('some-api-key');
    });

    it('overwrites existing key when saving the same key', async () => {
      await ConfigManager.save({ n8nUrl: 'http://original.com/api/v1' });
      await ConfigManager.save({ n8nUrl: 'http://updated.com/api/v1' });
      const config = await ConfigManager.load();
      expect(config.n8nUrl).to.equal('http://updated.com/api/v1');
    });

    it('creates configDir if it does not exist', async () => {
      const newDir = path.join(tmpDir, 'nested', 'subdir');
      (ConfigManager as any).configDir = newDir;
      (ConfigManager as any).configFile = path.join(newDir, 'config.json');

      await ConfigManager.save({ n8nUrl: 'http://nested.test' });
      const stat = await fs.stat(newDir);
      expect(stat.isDirectory()).to.be.true;

      // Restore
      (ConfigManager as any).configDir = tmpDir;
      (ConfigManager as any).configFile = tmpConfigFile;
    });
  });

  describe('clear()', () => {
    it('writes an empty object to the config file', async () => {
      await ConfigManager.save({ n8nUrl: 'http://example.com/api/v1', n8nKey: 'key-123' });
      await ConfigManager.clear();
      const config = await ConfigManager.load();
      expect(config).to.deep.equal({});
    });

    it('creates the file if it did not exist', async () => {
      await ConfigManager.clear();
      const raw = await fs.readFile(tmpConfigFile, 'utf-8');
      expect(JSON.parse(raw)).to.deep.equal({});
    });
  });

  describe('AI credential fields', () => {
    it('saves and loads aiKey', async () => {
      await ConfigManager.save({ aiKey: 'sk-test-123' });
      const config = await ConfigManager.load();
      expect(config.aiKey).to.equal('sk-test-123');
    });

    it('saves and loads aiProvider', async () => {
      await ConfigManager.save({ aiProvider: 'anthropic' });
      const config = await ConfigManager.load();
      expect(config.aiProvider).to.equal('anthropic');
    });

    it('saves and loads aiModel', async () => {
      await ConfigManager.save({ aiModel: 'claude-sonnet-4-6' });
      const config = await ConfigManager.load();
      expect(config.aiModel).to.equal('claude-sonnet-4-6');
    });

    it('saves and loads aiBaseUrl', async () => {
      await ConfigManager.save({ aiBaseUrl: 'http://localhost:11434/v1' });
      const config = await ConfigManager.load();
      expect(config.aiBaseUrl).to.equal('http://localhost:11434/v1');
    });

    it('saves all AI fields together without overwriting n8n fields', async () => {
      await ConfigManager.save({ n8nUrl: 'http://n8n.local', n8nKey: 'n8n-key' });
      await ConfigManager.save({ aiKey: 'sk-ai-key', aiProvider: 'openai', aiModel: 'gpt-4o' });
      const config = await ConfigManager.load();
      expect(config.n8nUrl).to.equal('http://n8n.local');
      expect(config.n8nKey).to.equal('n8n-key');
      expect(config.aiKey).to.equal('sk-ai-key');
      expect(config.aiProvider).to.equal('openai');
      expect(config.aiModel).to.equal('gpt-4o');
    });

    it('overwrites aiKey when saved again', async () => {
      await ConfigManager.save({ aiKey: 'old-key' });
      await ConfigManager.save({ aiKey: 'new-key' });
      const config = await ConfigManager.load();
      expect(config.aiKey).to.equal('new-key');
    });

    it('clears AI fields along with everything else', async () => {
      await ConfigManager.save({ aiKey: 'sk-test', aiProvider: 'gemini' });
      await ConfigManager.clear();
      const config = await ConfigManager.load();
      expect(config.aiKey).to.be.undefined;
      expect(config.aiProvider).to.be.undefined;
    });
  });
});
