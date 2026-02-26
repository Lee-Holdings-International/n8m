# n8m: The Agentic CLI for n8n

> Generate, modify, test, and deploy n8n workflows from the command line using AI.

[![TypeScript](https://badgen.net/badge/Built%20with/TypeScript/blue)](https://typescriptlang.org/)
[![oclif](https://badgen.net/badge/CLI/oclif/purple)](https://oclif.io/)
[![n8n](https://badgen.net/badge/n8n/Compatible/orange)](https://n8n.io)

**Stop clicking. Start shipping.** `n8m` is an open-source CLI that wraps your n8n instance with an agentic AI layer. Describe what you want in plain English — the agent designs, builds, validates, and deploys it.

No account. No server. Bring your own AI key and your n8n instance.

---

## Installation

```bash
# Option A: Run without installing (npx)
npx n8m <command>

# Option B: Install globally
npm install -g n8m
```

## Setup

### 1. Configure your AI provider

`n8m` stores credentials in `~/.n8m/config.json` so they persist across sessions — including `npx` invocations.

```bash
# OpenAI
npx n8m config --ai-provider openai --ai-key sk-...

# Anthropic (Claude)
npx n8m config --ai-provider anthropic --ai-key sk-ant-...

# Google Gemini
npx n8m config --ai-provider gemini --ai-key AIza...

# Any OpenAI-compatible API (Ollama, Groq, Together, LM Studio, etc.)
npx n8m config --ai-base-url http://localhost:11434/v1 --ai-key ollama --ai-model llama3
```

You can also use environment variables or a `.env` file — env vars take priority over stored config:

| Variable | Description |
|---|---|
| `AI_PROVIDER` | Preset: `openai`, `anthropic`, or `gemini` |
| `AI_API_KEY` | API key for your provider |
| `AI_MODEL` | Override the model (optional) |
| `AI_BASE_URL` | Custom base URL for any OpenAI-compatible API (optional) |

Default models per provider: `gpt-4o` · `claude-sonnet-4-6` · `gemini-2.5-flash`

### 2. Configure your n8n instance

```bash
npx n8m config --n8n-url https://your-n8n.example.com --n8n-key <your-n8n-api-key>
```

Credentials are saved locally to `~/.n8m/config.json`. You can also use environment variables `N8N_API_URL` and `N8N_API_KEY` instead.

---

## Commands

### `n8m create` — Generate a workflow

Describe what you want and the agentic pipeline designs, builds, and validates it.

```bash
n8m create "Send a Slack message whenever a new row is added to a Google Sheet"

# Save to a specific file
n8m create "Daily weather summary email" --output ./workflows/weather.json

# Open a multiline editor for complex descriptions
n8m create --multiline
```

The agent runs through three stages:
1. **Architect** — designs the blueprint and identifies required nodes
2. **Engineer** — generates the workflow JSON
3. **QA** — validates the result; loops back to Engineer if issues are found

The finished workflow is saved as a local JSON file (default: `./workflows/`).

---

### `n8m modify` — Modify an existing workflow

Modify a local file or a live workflow on your instance using natural language.

```bash
# Modify a local file
n8m modify ./workflows/slack-notifier.json "Add error handling to the HTTP node"

# Browse and select from local files + remote instance
n8m modify

# Multiline instructions
n8m modify --multiline
```

After modification you'll be prompted to save locally, deploy to your instance, or run a test.

---

### `n8m test` — Validate and auto-repair a workflow

Deploys a workflow ephemerally to your instance, validates it, and purges it when done. If validation fails, the repair loop kicks in automatically.

```bash
# Test a local file
n8m test ./workflows/my-flow.json

# Browse and pick from local files + instance workflows
n8m test
```

- Resolves and deploys sub-workflow dependencies automatically
- Patches node IDs after ephemeral deployment
- After a passing test, prompts to deploy or save the validated/repaired version
- All temporary assets are deleted on exit

---

### `n8m deploy` — Push a workflow to n8n

Deploy a local workflow JSON directly to your n8n instance.

```bash
n8m deploy ./workflows/my-flow.json

# Activate the workflow immediately after deployment
n8m deploy ./workflows/my-flow.json --activate
```

---

### `n8m resume` — Resume a paused session

The agent can pause mid-run for human review (HITL). Resume it with its thread ID.

```bash
n8m resume <thread-id>
```

Sessions are persisted to a local SQLite database, so they survive crashes and restarts.

---

### `n8m prune` — Clean up your instance

Removes duplicate workflows and leftover test artifacts (`[n8m:test:*]` prefixed names).

```bash
# Preview what would be deleted
n8m prune --dry-run

# Delete without confirmation
n8m prune --force
```

---

### `n8m config` — Manage configuration

All credentials are saved to `~/.n8m/config.json` and persist across sessions (including `npx` invocations).

```bash
# Set AI provider
n8m config --ai-provider openai --ai-key sk-...
n8m config --ai-provider anthropic --ai-key sk-ant-...
n8m config --ai-provider gemini --ai-key AIza...

# Override model or set a custom OpenAI-compatible endpoint
n8m config --ai-model gpt-4o-mini
n8m config --ai-base-url http://localhost:11434/v1 --ai-key ollama --ai-model llama3

# Set n8n instance
n8m config --n8n-url https://your-n8n.example.com --n8n-key <key>

# Show current config
n8m config
```

---

## Architecture

```
Developer → n8m create "..."
               │
               ▼
        ┌─────────────┐
        │  Architect  │  Designs the workflow blueprint
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │  Engineer   │◄──────────────┐
        └──────┬──────┘               │ repair loop
               │                      │
               ▼                      │
        ┌─────────────┐       ┌───────┴─────┐
        │     QA      │──────►│  (failed)   │
        └──────┬──────┘       └─────────────┘
               │ passed
               ▼
        ./workflows/output.json
```

- **Local first**: credentials and workflow files live on your machine
- **SQLite persistence**: session state survives interruptions
- **HITL pauses**: the agent stops for your review before committing
- **Bring your own AI**: works with OpenAI, Claude, Gemini, Ollama, or any OpenAI-compatible API

---

## Local Development

```bash
git clone https://github.com/lcanady/n8m.git
cd n8m
npm install

# Watch mode
npm run dev

# Run directly
./bin/run.js help
```

---

## Roadmap

- [x] Agentic graph (Architect → Engineer → QA)
- [x] SQLite session persistence
- [x] HITL interrupts and resume
- [x] Sub-workflow dependency resolution in tests
- [x] Open source — no account required
- [x] Multi-provider AI support (OpenAI, Claude, Gemini, Ollama, any OpenAI-compatible API)
- [ ] Native n8n canvas integration
- [ ] Multi-agent collaboration on a single goal
