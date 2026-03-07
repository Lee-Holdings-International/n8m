# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| < 0.3   | No        |

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Send a report to **security@leehi.io** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- The version of n8m affected
- Your GitHub handle (optional, for credit in the advisory)

You can expect an acknowledgement within **48 hours** and a status update
within **7 days**.

## Scope

n8m runs entirely on your local machine and communicates with:

- Your n8n instance (via `N8N_API_URL` / `N8N_API_KEY`)
- Your chosen AI provider (OpenAI, Anthropic, Google, or a local endpoint)
- GitHub's API (only when `n8m learn --github` is used)

Credentials are stored in `~/.n8m/config.json` and are never transmitted to
any n8m-operated service.

## Out of scope

- Vulnerabilities in n8n itself — report those to the [n8n security team](https://github.com/n8n-io/n8n/security)
- Vulnerabilities in your AI provider — report those to the respective vendor
- Issues that require physical access to the machine running n8m
