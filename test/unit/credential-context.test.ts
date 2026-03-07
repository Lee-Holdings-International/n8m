import { expect } from 'chai';
import { buildCredentialContext } from '../../src/services/ai.service.js';
import type { N8nCredential } from '../../src/utils/n8nClient.js';

const cred = (name: string, type: string, id = '1'): N8nCredential => ({ id, name, type });

describe('buildCredentialContext()', () => {
  // ─── Empty / falsy inputs ────────────────────────────────────────────────────

  it('returns empty string when credentials array is empty', () => {
    expect(buildCredentialContext([])).to.equal('');
  });

  it('returns empty string when credentials is null', () => {
    expect(buildCredentialContext(null as any)).to.equal('');
  });

  it('returns empty string when credentials is undefined', () => {
    expect(buildCredentialContext(undefined as any)).to.equal('');
  });

  // ─── Content requirements ────────────────────────────────────────────────────

  it('includes a section header mentioning available credentials', () => {
    const result = buildCredentialContext([cred('My Slack', 'slackApi')]);
    expect(result.toUpperCase()).to.include('AVAILABLE CREDENTIALS');
  });

  it('includes each credential name', () => {
    const result = buildCredentialContext([
      cred('My Slack', 'slackApi', '1'),
      cred('Gmail OAuth', 'gmailOAuth2Api', '2'),
    ]);
    expect(result).to.include('My Slack');
    expect(result).to.include('Gmail OAuth');
  });

  it('includes each credential type', () => {
    const result = buildCredentialContext([
      cred('My Slack', 'slackApi', '1'),
      cred('Gmail OAuth', 'gmailOAuth2Api', '2'),
    ]);
    expect(result).to.include('slackApi');
    expect(result).to.include('gmailOAuth2Api');
  });

  it('includes a constraint telling the AI to only use listed types', () => {
    const result = buildCredentialContext([cred('Slack', 'slackApi')]);
    const lower = result.toLowerCase();
    const hasConstraint = lower.includes('only') || lower.includes('restrict') || lower.includes('must');
    expect(hasConstraint).to.be.true;
  });

  it('recommends HTTP Request as fallback for unlisted services', () => {
    const result = buildCredentialContext([cred('Slack', 'slackApi')]);
    expect(result.toLowerCase()).to.include('http');
  });

  it('does not include credential ids in the output', () => {
    const result = buildCredentialContext([cred('Slack', 'slackApi', 'secret-id-42')]);
    expect(result).to.not.include('secret-id-42');
  });

  // ─── Formatting ──────────────────────────────────────────────────────────────

  it('lists each credential on its own line', () => {
    const result = buildCredentialContext([
      cred('Slack', 'slackApi', '1'),
      cred('Gmail', 'gmailOAuth2Api', '2'),
    ]);
    const lines = result.split('\n').filter(l => l.includes('slackApi') || l.includes('gmailOAuth2Api'));
    expect(lines).to.have.length(2);
  });

  it('each credential line includes both name and type', () => {
    const result = buildCredentialContext([cred('My Stripe', 'stripeApi')]);
    const line = result.split('\n').find(l => l.includes('My Stripe'));
    expect(line).to.exist;
    expect(line).to.include('stripeApi');
  });

  // ─── Scale ───────────────────────────────────────────────────────────────────

  it('handles 50 credentials without error', () => {
    const many = Array.from({ length: 50 }, (_, i) => cred(`Cred ${i}`, `type${i}`, String(i)));
    expect(() => buildCredentialContext(many)).to.not.throw();
    const result = buildCredentialContext(many);
    expect(result).to.include('Cred 0');
    expect(result).to.include('Cred 49');
  });

  it('returns a non-empty string for a single credential', () => {
    const result = buildCredentialContext([cred('HubSpot', 'hubspotApi')]);
    expect(result.trim().length).to.be.greaterThan(0);
  });
});
