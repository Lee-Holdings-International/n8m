# n8m: The Agentic CLI for n8n

> Generate, modify, test, and deploy n8n workflows from the command line using
> AI.

[![npm](https://img.shields.io/npm/v/@lhi/n8m.svg)](https://www.npmjs.com/package/@lhi/n8m)
[![npm downloads](https://img.shields.io/npm/dm/@lhi/n8m.svg)](https://www.npmjs.com/package/@lhi/n8m)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://badgen.net/badge/Built%20with/TypeScript/blue)](https://typescriptlang.org/)
[![oclif](https://badgen.net/badge/CLI/oclif/purple)](https://oclif.io/)
[![n8n](https://badgen.net/badge/n8n/Compatible/orange)](https://n8n.io)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/Lee-Holdings-International/n8m#sponsors)
[![Discussions](https://img.shields.io/badge/Discussions-Join-blue?logo=github)](https://github.com/Lee-Holdings-International/n8m/discussions)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

**Stop clicking. Start shipping.** `n8m` is an open-source CLI that wraps your
n8n instance with an agentic AI layer. Describe what you want in plain English —
the agent designs, builds, validates, and deploys it.

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

`n8m` stores credentials in `~/.n8m/config.json` so they persist across sessions
— including `npx` invocations.

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

You can also use environment variables or a `.env` file — env vars take priority
over stored config:

| Variable      | Description                                              |
| ------------- | -------------------------------------------------------- |
| `AI_PROVIDER` | Preset: `openai`, `anthropic`, or `gemini`               |
| `AI_API_KEY`  | API key for your provider                                |
| `AI_MODEL`    | Override the model (optional)                            |
| `AI_BASE_URL` | Custom base URL for any OpenAI-compatible API (optional) |

Default models per provider: `gpt-4o` · `claude-sonnet-4-6` · `gemini-2.5-flash`

### 2. Configure your n8n instance

```bash
npx n8m config --n8n-url https://your-n8n.example.com --n8n-key <your-n8n-api-key>
```

Credentials are saved locally to `~/.n8m/config.json`. You can also use
environment variables `N8N_API_URL` and `N8N_API_KEY` instead.

---

## Commands

### `n8m create` — Generate a workflow

Describe what you want and the agentic pipeline designs, builds, and validates
it.

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

The finished workflow is saved as an organized project folder (default:
`./workflows/<project-slug>/`). Each project folder contains:

- `workflow.json`: The generated n8n workflow.
- `README.md`: Automatic documentation including a Mermaid.js diagram and an
  AI-generated summary.

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

After modification you'll be prompted to save locally (organized into its
project folder), deploy to your instance, or run a test.

---

### `n8m doc` — Generate documentation

Generate visual and text documentation for existing local or remote workflows.

```bash
# Document a local workflow file
n8m doc ./workflows/my-workflow.json

# Browse and select from local files + remote instance
n8m doc
```

- Generates a `README.md` in the workflow's project directory.
- Includes a **Mermaid.js** flowchart of the workflow logic.
- Includes an **AI-generated summary** of the nodes and execution flow.
- Automatically organizes loose `.json` files into project folders.

---

### `n8m test` — Validate and auto-repair a workflow

Validates a workflow against your n8n instance. If it fails, the AI repair loop
kicks in — analyzing the error, applying fixes, and retrying automatically.

```bash
# Test a local file or remote workflow (browse to select)
n8m test ./workflows/my-flow.json
n8m test

# Generate 3 diverse AI test scenarios (happy path, edge case, error)
n8m test --ai-scenarios

# Use a specific fixture file for offline testing
n8m test --fixture .n8m/fixtures/abc123.json
n8m test -f ./my-fixture.json
```

- Resolves and deploys sub-workflow dependencies automatically
- After a passing live test, prompts to **save a fixture** for future offline runs
- When a fixture exists for a workflow, prompts to **run offline** (no n8n calls)
- After a passing test, prompts to deploy or save the validated/repaired version
- **Auto-documents**: Generates or updates the project `README.md` upon saving.
- All temporary assets are deleted on exit

#### Offline testing with fixtures

n8m can capture real execution data from n8n and replay it offline — no live
instance, credentials, or external API calls needed.

**First run — capture a fixture:**
```bash
n8m test                          # runs live against your n8n instance
# → Save fixture for future offline runs? [Y/n]  ← answer Y
# → .n8m/fixtures/<workflowId>.json created
```

**Subsequent runs — replay offline:**
```bash
n8m test
# → Fixture found from Mar 4, 2026, 10:30 AM. Run offline? [Y/n]
```

The offline mode uses your real node-by-node execution data, so the AI evaluator
works with actual production outputs rather than mocked data. The AI healing loop
still runs — if the captured execution shows an error, n8m will try to fix it and
evaluate the fix against the real fixture data.

---

### `n8m fixture` — Manage test fixtures

Two ways to create a fixture:

```bash
# Pull real execution data from n8n (no test run required)
n8m fixture capture <workflowId>

# Browse local files + remote instance interactively
n8m fixture capture

# Scaffold an empty template to fill in by hand
n8m fixture init <workflowId>
```

**`capture`** connects to your n8n instance, fetches the most recent executions
for the workflow, and presents an interactive menu to pick which one to save.
You'll be prompted for a fixture name (e.g. `happy-path`, `missing-field`) and
expected outcome (`pass` or `fail`). Fixtures are saved to
`.n8m/fixtures/<workflowId>/<name>.json`.

```bash
n8m fixture capture abc123
# → Fetching executions for workflow abc123...
# → ? Select an execution to capture:
# →   #177916  success  3/4/2026, 10:48:47 AM
# →   #177914  success  3/4/2026, 10:48:23 AM
# → ❯ #177913  error    3/4/2026, 10:47:59 AM
# → Name this fixture (e.g. happy-path, missing-field, bad-auth): error-case
# → Expected test outcome: fail
# → Fixture saved to .n8m/fixtures/abc123/error-case.json
# →   Workflow: My Workflow
# →   Execution: error · 5 node(s) captured
```

Multiple named fixtures per workflow let you test different scenarios (happy
path, edge cases, error handling) with one command:

```bash
n8m test --fixture .n8m/fixtures/abc123           # run ALL fixtures for a workflow
n8m test --fixture .n8m/fixtures/abc123/error-case.json  # run one specific fixture
```

**`init`** creates an empty template when you want to define the fixture data
yourself, without needing a live execution first.

```json
{
  "$schema": "../../node_modules/n8m/dist/fixture-schema.json",
  "version": "1.0",
  "workflowId": "abc123",
  "workflowName": "My Workflow",
  "description": "happy-path",
  "expectedOutcome": "pass",
  "workflow": { "name": "My Workflow", "nodes": [], "connections": {} },
  "execution": {
    "status": "success",
    "data": {
      "resultData": {
        "error": null,
        "runData": {
          "Your Node Name": [{ "json": { "key": "value" } }]
        }
      }
    }
  }
}
```

Fill in `execution.data.resultData.runData` with the actual output of each node
(keyed by exact node name). Then test against it:

```bash
n8m test --fixture .n8m/fixtures/abc123/happy-path.json
```

Fixture files are project-local (`.n8m/fixtures/`) and should be committed to
your repo so your team can run the same offline tests. Add the `$schema` field to
get autocomplete and validation in any editor that supports JSON Schema.

---

### `n8m deploy` — Push a workflow to n8n

Deploy a local workflow JSON directly to your n8n instance.

```bash
n8m deploy ./workflows/my-flow.json

# Activate the workflow immediately after deployment
n8m deploy ./workflows/my-flow.json --activate
```

---

### `n8m learn` — Build the pattern library

Extract reusable engineering knowledge from validated workflows and store it so
the AI engineer applies the same proven techniques in future generations.

```bash
# Interactive: pick a workflow from ./workflows/
n8m learn

# Learn from a specific workflow
n8m learn ./workflows/my-flow/workflow.json

# Batch-generate patterns for every workflow in the directory
n8m learn --all

# Import patterns from a GitHub archive (awesome-n8n style)
n8m learn --github owner/repo
n8m learn --github owner/repo@main --github-path patterns/google
n8m learn --github owner/repo --token ghp_xxx   # or set GITHUB_TOKEN env var
```

**How it works:**

- **Local mode**: The AI reads a validated workflow JSON, identifies the
  techniques it demonstrates, extracts critical rules (including gotchas to
  avoid), and writes a `.md` pattern file to `.n8m/patterns/`.
- **GitHub mode**: Fetches `.md` pattern files from any public GitHub repo via
  the GitHub API. Shows a checkbox menu so you choose exactly which patterns to
  import. Recurses into subdirectories automatically.

Patterns are Markdown files with a `<!-- keywords: ... -->` comment. When you
run `n8m create`, the engineer searches all pattern files and injects any that
match the workflow's goal into the prompt — teaching it to reproduce proven
approaches exactly.

```
.n8m/patterns/          ← your project-local library (user patterns)
docs/patterns/          ← built-in patterns shipped with n8m
```

User patterns in `.n8m/patterns/` take priority over built-in patterns. A
pattern file with the same filename overrides the built-in version, so you can
customize any default.

**Contributing default patterns** (for n8m maintainers):

```bash
# Generate docs/patterns/ from every workflow in ./workflows/
npm run generate-patterns

# Overwrite any already-existing pattern files
npm run generate-patterns -- --overwrite

# Preview what would be written without touching the filesystem
npm run generate-patterns -- --dry-run
```

The script scans `workflows/` recursively, calls the AI on each `workflow.json`,
and writes the result to `docs/patterns/<slug>.md`. Patterns in `docs/patterns/`
are included in the npm package and available to all users automatically.

**Pattern file format:**

```markdown
<!-- keywords: bigquery, google bigquery, sql, merge, http request -->

# Pattern: BigQuery Operations via HTTP Request

## Critical Rules
- NEVER use n8n-nodes-base.googleBigQuery — it returns no output for DDL/DML.
  Always use n8n-nodes-base.httpRequest with the BigQuery REST API.

## DDL / DML Queries
...
```

---

### `n8m mcp` — Launch the MCP server

Expose `n8m`'s agentic capabilities as tools to any
[Model Context Protocol](https://modelcontextprotocol.io/) client (Claude
Desktop, Cursor, etc.).

```bash
n8m mcp
# → Starting n8m MCP Server...
```

The server runs over stdio and registers two tools:

| Tool | Description |
|---|---|
| `create_workflow` | Generate an n8n workflow from a natural-language goal |
| `test_workflow` | Deploy a workflow ephemerally to n8n and validate it |

Add it to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "n8m": {
      "command": "npx",
      "args": ["n8m", "mcp"]
    }
  }
}
```

---

### `n8m resume` — Resume a paused session

The agent can pause mid-run for human review (HITL). Resume it with its thread
ID.

```bash
n8m resume <thread-id>
```

Sessions are persisted to a local SQLite database, so they survive crashes and
restarts.

---

### `n8m prune` — Clean up your instance

Removes duplicate workflows and leftover test artifacts (`[n8m:test:*]` prefixed
names).

```bash
# Preview what would be deleted
n8m prune --dry-run

# Delete without confirmation
n8m prune --force
```

---

### `n8m config` — Manage configuration

All credentials are saved to `~/.n8m/config.json` and persist across sessions
(including `npx` invocations).

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
        ┌─────────────┐      .n8m/patterns/    docs/patterns/
        │  Architect  │  ◄── RAG: node defs + matched patterns
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
        ./workflows/<slug>/
           ├── workflow.json
           └── README.md (with Mermaid diagram)


Developer → n8m learn <workflow.json>
               │
               ▼
          AI analyzes validated workflow
               │
               ▼
        .n8m/patterns/<slug>.md  ← feeds back into Engineer on next create
```

- **Local first**: credentials and workflow files live on your machine
- **Organized Projects**: Workflows are grouped into folders with auto-generated
  documentation
- **SQLite persistence**: session state survives interruptions
- **HITL pauses**: the agent stops for your review before committing
- **Bring your own AI**: works with OpenAI, Claude, Gemini, Ollama, or any
  OpenAI-compatible API
- **Self-improving**: every validated workflow you `learn` from strengthens
  future generations

> **For developers**: See the [Developer Guide](docs/DEVELOPER_GUIDE.md) for a
> deep-dive into the agentic graph internals, RAG implementation, how to add new
> agent nodes, and how to extend the CLI.

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

## Sponsors

n8m is MIT-licensed and free forever. Sponsorship directly funds AI API costs,
continued development, and the time it takes to keep up with n8n's rapidly
evolving node ecosystem.

### Sponsor tiers

| Tier | Amount | What you get |
|------|--------|--------------|
| **Supporter** | $5 / mo | Name in the README sponsors list |
| **Studio** | $25 / mo | Logo in the README + priority issue responses |
| **Enterprise** | $100 / mo | Logo + a direct line for feature requests and integration questions |

[Become a sponsor on Ko-fi](https://ko-fi.com/lcanady) · [GitHub Sponsors](https://github.com/sponsors/lcanady)

---

### Current Sponsors

#### Partial Sponsors

[The Daily Caller](https://dailycaller.com)

---

## Roadmap

### Shipped

- [x] Agentic graph (Architect → Engineer → QA)
- [x] SQLite session persistence
- [x] HITL interrupts and resume
- [x] Sub-workflow dependency resolution in tests
- [x] Open source — no account required
- [x] Multi-provider AI support (OpenAI, Claude, Gemini, Ollama, any OpenAI-compatible API)
- [x] Automatic documentation generation (Mermaid + AI Summary)
- [x] Project-based folder organization
- [x] AI-driven test scenario generation (`--ai-scenarios`)
- [x] Static node type reference & fallback mechanism
- [x] Multi-workflow project generation support
- [x] Fixture record & replay — offline testing with real execution data
- [x] Hand-crafted fixture scaffolding (`n8m fixture init`) with JSON Schema
- [x] Pattern library — extract & reuse knowledge from validated workflows (`n8m learn`)
- [x] GitHub pattern archive import (`n8m learn --github owner/repo`)
- [x] MCP server — expose n8m as tools for Claude Desktop and other MCP clients
- [x] **`n8m rollback`** — restore a workflow to a previous git-tracked version with a single command
- [x] **Credential awareness** — AI consults available credential types on the target instance so it stops generating nodes it can't authenticate

### Near-term

- [ ] **`n8m watch`** — file-system watcher that auto-deploys on save with live reload in the n8n editor
- [ ] **`n8m diff`** — human-readable structural diff between two workflow versions (nodes added/removed/changed)
- [ ] **Parallel test runs** — fire multiple fixture payloads concurrently and report aggregate pass/fail

### Medium-term

- [ ] **`n8m debug`** — attach to a running execution and stream node-by-node output to the terminal in real time
- [ ] **`n8m chat`** — interactive REPL where every message applies an incremental AI edit and immediately re-tests
- [ ] **Workflow linter** — static analysis before deploy: dead branches, missing error handlers, unconnected nodes, credential gaps
- [ ] **`n8m learn --from-executions`** — scrape recent successful executions and distil reusable patterns into `.n8m/patterns/` automatically
- [ ] **Multi-instance deploy** — deploy the same workflow to staging and production in one command with environment-variable substitution

### Longer-term

- [ ] **Visual diff** — `n8m diff --ui` opens a side-by-side workflow comparison in the n8n canvas
- [ ] **Workflow marketplace** — `n8m publish` / `n8m install <slug>` to share and consume community patterns with version pinning
- [ ] **Execution replay** — record a live execution and automatically promote it to a fixture, closing the capture loop entirely
- [ ] **Agent memory across sessions** — the engineer remembers which node patterns worked well for a given integration and prefers them on future builds
- [ ] **LangGraph trace export** — export the full agentic reasoning trace (Architect → Engineer → Reviewer → QA) as a structured log for debugging and auditing
