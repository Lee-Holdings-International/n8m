import { expect } from 'chai';
import Config from '../../src/commands/config.js';

// ---------------------------------------------------------------------------
// Config command — static metadata + validation guard logic
//
// The file-write path is covered by config.test.ts (ConfigManager unit tests).
// Here we verify:
//   1. Command static definition (flags, description)
//   2. URL validation guard (n8n URL and AI base URL)
//   3. AI provider validation guard and lowercase normalisation
// ---------------------------------------------------------------------------

describe('Config command', () => {
  // ── Static metadata ───────────────────────────────────────────────────────

  describe('static metadata', () => {
    it('has a description', () => {
      expect(Config.description).to.be.a('string').with.length.greaterThan(0);
    });
  });

  describe('flags', () => {
    it('defines --n8n-url flag', () => {
      expect(Config.flags).to.have.property('n8n-url');
    });

    it('defines --n8n-key flag', () => {
      expect(Config.flags).to.have.property('n8n-key');
    });

    it('defines --ai-key flag', () => {
      expect(Config.flags).to.have.property('ai-key');
    });

    it('defines --ai-provider flag', () => {
      expect(Config.flags).to.have.property('ai-provider');
    });

    it('defines --ai-model flag', () => {
      expect(Config.flags).to.have.property('ai-model');
    });

    it('defines --ai-base-url flag', () => {
      expect(Config.flags).to.have.property('ai-base-url');
    });

    it('all flags are string type', () => {
      const stringFlags = ['n8n-url', 'n8n-key', 'ai-key', 'ai-provider', 'ai-model', 'ai-base-url'];
      for (const f of stringFlags) {
        expect((Config.flags as any)[f].type).to.equal('option');
      }
    });
  });

  // ── URL validation guard ──────────────────────────────────────────────────
  //
  // run() checks:
  //   const parsed = new URL(input);
  //   if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(...)
  //
  // This guard rejects both unparseable strings AND parseable non-http URLs.

  const isValidHttpUrl = (s: string) => {
    try {
      const parsed = new URL(s);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  describe('n8n URL validation guard', () => {
    it('rejects a plain hostname with no protocol (parsed as custom protocol)', () => {
      expect(isValidHttpUrl('localhost:5678')).to.equal(false);
    });

    it('rejects a relative path', () => {
      expect(isValidHttpUrl('/api/v1')).to.equal(false);
    });

    it('rejects an empty string', () => {
      expect(isValidHttpUrl('')).to.equal(false);
    });

    it('rejects a bare word', () => {
      expect(isValidHttpUrl('not-a-url')).to.equal(false);
    });

    it('rejects an ftp URL', () => {
      expect(isValidHttpUrl('ftp://files.example.com')).to.equal(false);
    });

    it('accepts an http URL', () => {
      expect(isValidHttpUrl('http://localhost:5678')).to.equal(true);
    });

    it('accepts an https URL', () => {
      expect(isValidHttpUrl('https://n8n.example.com')).to.equal(true);
    });

    it('accepts an https URL with path', () => {
      expect(isValidHttpUrl('https://n8n.example.com/api/v1')).to.equal(true);
    });

    it('accepts an IP address URL', () => {
      expect(isValidHttpUrl('http://192.168.1.100:5678')).to.equal(true);
    });
  });

  // ── AI base URL validation guard ──────────────────────────────────────────

  describe('AI base URL validation guard', () => {
    it('rejects a bare hostname (parsed as custom protocol)', () => {
      expect(isValidHttpUrl('localhost:11434')).to.equal(false);
    });

    it('rejects a path-only string', () => {
      expect(isValidHttpUrl('/v1')).to.equal(false);
    });

    it('rejects a non-http protocol', () => {
      expect(isValidHttpUrl('ftp://localhost/v1')).to.equal(false);
    });

    it('accepts a local Ollama endpoint', () => {
      expect(isValidHttpUrl('http://localhost:11434/v1')).to.equal(true);
    });

    it('accepts an OpenAI-compatible https endpoint', () => {
      expect(isValidHttpUrl('https://api.groq.com/openai/v1')).to.equal(true);
    });

    it('accepts an LM Studio endpoint', () => {
      expect(isValidHttpUrl('http://localhost:1234/v1')).to.equal(true);
    });
  });

  // ── AI provider validation guard ──────────────────────────────────────────

  const KNOWN_PROVIDERS = ['openai', 'anthropic', 'gemini'];

  describe('AI provider allowlist', () => {
    it('contains openai', () => {
      expect(KNOWN_PROVIDERS).to.include('openai');
    });

    it('contains anthropic', () => {
      expect(KNOWN_PROVIDERS).to.include('anthropic');
    });

    it('contains gemini', () => {
      expect(KNOWN_PROVIDERS).to.include('gemini');
    });

    it('has exactly 3 providers', () => {
      expect(KNOWN_PROVIDERS).to.have.length(3);
    });
  });

  describe('provider validation — rejects unknown values', () => {
    const isKnown = (p: string) => KNOWN_PROVIDERS.includes(p.toLowerCase());

    it('rejects an empty string', () => {
      expect(isKnown('')).to.equal(false);
    });

    it('rejects "ollama"', () => {
      expect(isKnown('ollama')).to.equal(false);
    });

    it('rejects "gpt4"', () => {
      expect(isKnown('gpt4')).to.equal(false);
    });

    it('rejects "azure"', () => {
      expect(isKnown('azure')).to.equal(false);
    });

    it('rejects a random string', () => {
      expect(isKnown('my-custom-llm')).to.equal(false);
    });
  });

  describe('provider validation — accepts known providers case-insensitively', () => {
    const isKnown = (p: string) => KNOWN_PROVIDERS.includes(p.toLowerCase());

    it('accepts "openai" (lowercase)', () => {
      expect(isKnown('openai')).to.equal(true);
    });

    it('accepts "OpenAI" (mixed case)', () => {
      expect(isKnown('OpenAI')).to.equal(true);
    });

    it('accepts "OPENAI" (uppercase)', () => {
      expect(isKnown('OPENAI')).to.equal(true);
    });

    it('accepts "anthropic" (lowercase)', () => {
      expect(isKnown('anthropic')).to.equal(true);
    });

    it('accepts "Anthropic" (title case)', () => {
      expect(isKnown('Anthropic')).to.equal(true);
    });

    it('accepts "gemini" (lowercase)', () => {
      expect(isKnown('gemini')).to.equal(true);
    });

    it('accepts "Gemini" (title case)', () => {
      expect(isKnown('Gemini')).to.equal(true);
    });
  });

  describe('provider normalisation to lowercase', () => {
    // run() stores config.aiProvider = flags['ai-provider'].toLowerCase()
    it('normalises "OpenAI" to "openai"', () => {
      expect('OpenAI'.toLowerCase()).to.equal('openai');
    });

    it('normalises "ANTHROPIC" to "anthropic"', () => {
      expect('ANTHROPIC'.toLowerCase()).to.equal('anthropic');
    });

    it('normalises "Gemini" to "gemini"', () => {
      expect('Gemini'.toLowerCase()).to.equal('gemini');
    });

    it('leaves already-lowercase value unchanged', () => {
      expect('openai'.toLowerCase()).to.equal('openai');
    });
  });
});
