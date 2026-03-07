# n8m Developer Guide

> A deep-dive into the internals of `n8m` for contributors and developers who
> want to understand, extend, or build on the project.

## Table of Contents

- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [The Agentic Graph](#the-agentic-graph)
  - [TeamState](#teamstate)
  - [Agent Nodes](#agent-nodes)
  - [Graph Edges & Control Flow](#graph-edges--control-flow)
- [AI Service](#ai-service)
- [Node Definitions & RAG](#node-definitions--rag)
- [CLI Commands](#cli-commands)
- [Testing Infrastructure](#testing-infrastructure)
- [Extending n8m](#extending-n8m)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)

---

## Project Structure

```
n8m/
├── bin/                      # CLI entry points
├── docs/                     # Documentation (you are here)
├── src/
│   ├── agentic/              # LangGraph multi-agent system
│   │   ├── graph.ts          # Graph definition, edges, and exports
│   │   ├── state.ts          # TeamState (shared agent memory)
│   │   ├── checkpointer.ts   # SQLite persistence for sessions
│   │   └── nodes/            # Individual agent node implementations
│   │       ├── architect.ts  # Blueprint designer
│   │       ├── engineer.ts   # Workflow JSON generator
│   │       ├── reviewer.ts   # Static structural validator
│   │       ├── supervisor.ts # Candidate selector (fan-in)
│   │       └── qa.ts         # Live ephemeral tester
│   ├── commands/             # oclif CLI command handlers
│   │   ├── create.ts
│   │   ├── modify.ts
│   │   ├── test.ts
│   │   ├── deploy.ts
│   │   ├── doc.ts
│   │   ├── fixture.ts        # capture/init sub-commands for offline fixtures
│   │   ├── learn.ts          # extract pattern knowledge from validated workflows
│   │   ├── mcp.ts            # MCP server entry point
│   │   ├── resume.ts
│   │   ├── prune.ts
│   │   └── config.ts
│   ├── services/             # Core business logic services
│   │   ├── ai.service.ts     # LLM abstraction layer
│   │   ├── doc.service.ts    # Documentation generation
│   │   ├── n8n.service.ts    # n8n API helpers
│   │   ├── mcp.service.ts    # MCP server integration
│   │   └── node-definitions.service.ts  # RAG for n8n node schemas
│   ├── utils/
│   │   ├── n8nClient.ts      # n8n REST API client
│   │   ├── config.ts         # Config file management
│   │   ├── theme.ts          # CLI formatting/theming
│   │   ├── fixtureManager.ts # Read/write .n8m/fixtures/ (single-file + directory)
│   │   └── sandbox.ts        # Isolated script runner for custom QA tools
│   └── resources/
│       └── node-definitions-fallback.json  # Static node schema fallback
├── docs/
│   └── N8N_NODE_REFERENCE.md # Human-readable node reference (for LLM context)
├── test/                     # Mocha unit tests
└── workflows/                # Local workflow project folders
    └── <slug>/
        ├── workflow.json
        └── README.md
```

---

## Architecture Overview

`n8m` uses a **multi-agent LangGraph pipeline** to translate a natural-language
goal into a validated n8n workflow JSON. The pipeline is composed of several
specialized AI agents, each with a distinct role:

```
Developer → n8m create "Send daily Slack digest"
                │
                ▼
        ┌───────────────┐
        │   Architect   │  Generates 2 strategies (Primary + Alternative)
        └───────┬───────┘
                │ Send() fan-out
       ┌────────┴────────┐
       ▼                 ▼
  ┌──────────┐     ┌──────────┐   (Parallel Engineers — each works on one strategy)
  │ Engineer │     │ Engineer │
  └────┬─────┘     └────┬─────┘
       └────────┬────────┘
                │ candidates[]
                ▼
        ┌──────────────┐
        │  Supervisor  │  AI picks the best candidate
        └──────┬───────┘
               │
               ▼
        ┌───────────┐
        │  Reviewer  │  Static structural validation (node types, orphans, connections)
        └──────┬────┘
          pass │ fail
         ┌─────┴─────┐
         ▼           ▼
       ┌─────┐   ┌──────────┐
       │ QA  │   │ Engineer │◄─ repair loop
       └──┬──┘   └──────────┘
     pass │ fail
          │       ┌──────────┐
          │       │ Engineer │◄─ self-correction loop
          ▼
         END
  ./workflows/<slug>/
     ├── workflow.json
     └── README.md
```

The pipeline leverages [LangGraph](https://github.com/langchain-ai/langgraphjs)
for orchestration, with SQLite-backed checkpointing for session persistence and
HITL (Human-in-the-Loop) interrupts.

---

## The Agentic Graph

### TeamState

Defined in `src/agentic/state.ts`. This is the **shared memory** of the entire
pipeline — all agents read from and write to this object.

```typescript
// src/agentic/state.ts
export const TeamState = Annotation.Root({
    userGoal: Annotation<string>, // The original user prompt
    spec: Annotation<any>, // Workflow spec from Architect
    workflowJson: Annotation<any>, // The generated/fixed workflow
    validationErrors: Annotation<string[]>, // Errors from Reviewer or QA
    validationStatus: Annotation<"passed" | "failed">,
    availableNodeTypes: Annotation<string[]>, // Node types from live n8n instance
    revisionCount: Annotation<number>, // How many repair loops have run
    strategies: Annotation<any[]>, // Multiple Architect strategies (for parallel Engineers)
    candidates: Annotation<any[]>, // Each Engineer pushes here (fan-in reducer)
    collaborationLog: Annotation<string[]>, // Agent audit trail
    userFeedback: Annotation<string>, // HITL feedback from user
    testScenarios: Annotation<any[]>, // AI-generated test input payloads
    customTools: Annotation<Record<string, string>>, // Dynamic scripts for QA sandbox
});
```

**Key design note**: `candidates` uses a custom `reducer` that concatenates
incoming arrays. This is what enables the parallel fan-out pattern — each
Engineer pushes one candidate, and LangGraph merges them for the Supervisor to
evaluate.

### Agent Nodes

Each node is a plain `async function(state) => Partial<TeamState>`. They live in
`src/agentic/nodes/`.

| Node         | File            | Role                                                                                                                                                                                                                |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architect`  | `architect.ts`  | Calls `AIService.generateSpec()` twice (primary + alternative) to produce two strategies. Returns `{ strategies, spec }`.                                                                                           |
| `engineer`   | `engineer.ts`   | Receives one strategy via `Send()`. Performs RAG lookup for relevant node schemas, then calls `AIService` to generate full workflow JSON. Returns `{ candidates: [result] }` or repairs an existing `workflowJson`. |
| `supervisor` | `supervisor.ts` | Receives all candidates from Engineers. Calls `AIService.evaluateCandidates()` to have an AI pick the best one. Sets `workflowJson`.                                                                                |
| `reviewer`   | `reviewer.ts`   | Performs **pure static validation** (no AI, no network). Detects hallucinated node types, orphaned nodes, and missing sub-workflow IDs.                                                                             |
| `qa`         | `qa.ts`         | Deploys the workflow ephemerally to your n8n instance, runs test scenarios via webhook, verifies execution results, and cleans up.                                                                                  |

### Graph Edges & Control Flow

```typescript
// src/agentic/graph.ts (simplified)
workflow
    .addEdge(START, "architect")
    // Fan-out: One Engineer for each Architect strategy
    .addConditionalEdges("architect", (state) => {
        if (state.strategies?.length > 0) {
            return state.strategies.map((s) =>
                new Send("engineer", { spec: s })
            );
        }
        return "engineer"; // fallback
    }, ["engineer"])
    // Route: if repairing (errors present) → skip Supervisor → go to Reviewer
    .addConditionalEdges("engineer", (state) => {
        return state.validationErrors?.length > 0 ? "reviewer" : "supervisor";
    }, ["supervisor", "reviewer"])
    .addEdge("supervisor", "reviewer")
    // Reviewer: pass → QA, fail → back to Engineer
    .addConditionalEdges(
        "reviewer",
        (state) => state.validationStatus === "passed" ? "passed" : "failed",
        { passed: "qa", failed: "engineer" },
    )
    // QA: pass → END, fail → back to Engineer (self-correction loop)
    .addConditionalEdges(
        "qa",
        (state) => state.validationStatus === "passed" ? "passed" : "failed",
        { passed: END, failed: "engineer" },
    );

// HITL interrupts fire before these nodes, pausing for user review
export const graph = workflow.compile({
    checkpointer,
    interruptBefore: ["engineer", "qa"],
});
```

**HITL (Human-in-the-Loop)**: The graph pauses execution before `engineer` and
`qa`. The CLI commands (`create.ts`, `test.ts`) detect this pause by checking
`graph.getState()`, prompt the user for input, then call
`graph.stream(null, ...)` to resume.

---

## AI Service

`src/services/ai.service.ts` is the **single abstraction layer** for all LLM
calls. It supports OpenAI, Anthropic (Claude), Google Gemini, and any
OpenAI-compatible API (Ollama, Groq, etc.).

### Key Methods

| Method                                          | Description                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `generateContent(prompt, options?)`             | Low-level LLM call with retry logic (3 attempts, exponential backoff).               |
| `generateSpec(goal)`                            | Produces a `WorkflowSpec` (blueprint) from a user goal.                              |
| `generateAlternativeSpec(goal, primarySpec)`    | Generates a second, different strategy — uses the "alternative model" for diversity. |
| `generateWorkflowFix(workflow, errors, model?)` | Sends a failing workflow + error list to the LLM for repair.                         |
| `evaluateCandidates(goal, candidates)`          | AI picks the best candidate workflow from the list.                                  |
| `generateTestScenarios(workflowJson, goal)`     | Returns 3 test payloads: happy path, edge case, error case.                          |
| `evaluateTestError(error, nodes, failingNode)`  | Classifies a live test failure and returns a `TestErrorEvaluation` describing what action to take. Used by the self-healing loop in `test.ts` and `qa.ts`. |
| `inferBinaryFieldName(predecessorNode)`         | Given a Code node that produces binary output, reads its `jsCode` and asks the AI what the binary field name is. Returns `string \| null`. |
| `fixHallucinatedNodes(workflow)`                | Corrects known-bad node type strings (e.g. `rssFeed` → `rssFeedRead`).               |
| `validateAndShim(workflow, validNodeTypes)`     | Replaces truly unknown node types with safe shims (`n8n-nodes-base.set`).            |

### Provider Configuration

The service reads credentials from (in priority order):

1. Environment variables (`AI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`,
   `AI_BASE_URL`)
2. `~/.n8m/config.json` (written by `n8m config`)

Anthropic is called via its native `/messages` REST API because it doesn't fully
conform to the OpenAI SDK. All others use the OpenAI SDK with a custom
`baseURL`.

### Parallel Strategies & Model Diversity

The Architect generates a primary strategy using the default model, and an
alternative strategy using `getAlternativeModel()`. This method returns a
different model tier from the same provider (e.g., `claude-haiku` if using
`claude-sonnet`), ensuring genuine architectural diversity in the two candidates
before the Supervisor picks the winner.

---

## Node Definitions & RAG

`src/services/node-definitions.service.ts` provides **Retrieval-Augmented
Generation** for n8n node schemas, helping the Engineer produce accurate node
configurations.

### Loading Strategy (with Fallback)

```
1. Fetch live node types from n8n instance via /nodes endpoint
   ↓ (on failure)
2. Load from src/resources/node-definitions-fallback.json (static snapshot)
   ↓ (on failure)
3. Empty — RAG disabled, Engineer uses base knowledge only
```

### How RAG Works in the Engineer Node

```typescript
// src/agentic/nodes/engineer.ts
const nodeService = NodeDefinitionsService.getInstance();
await nodeService.loadDefinitions();

// Build a query from goal + spec description
const queryText = state.userGoal + " " + state.spec.suggestedName;

// Keyword search — returns up to 8 reduced definitions
const relevantDefs = nodeService.search(queryText, 8);

// Static markdown reference (loaded from docs/N8N_NODE_REFERENCE.md)
const staticRef = nodeService.getStaticReference();

// Both are injected into the Engineer's LLM prompt
const ragContext =
    `[N8N NODE REFERENCE GUIDE]\n${staticRef}\n\n[AVAILABLE NODE SCHEMAS]\n${
        nodeService.formatForLLM(relevantDefs)
    }`;
```

### Updating the Fallback / Reference

- **`src/resources/node-definitions-fallback.json`**: A JSON snapshot of n8n
  node type definitions. Update this periodically from a live n8n instance.
- **`docs/N8N_NODE_REFERENCE.md`**: A human-readable markdown reference injected
  into the Architect and Engineer prompts. Editable manually. This is the
  primary guide for the AI when choosing node types and parameters.

---

## CLI Commands

All commands are built with [oclif](https://oclif.io/) and live in
`src/commands/`. They handle user I/O and then delegate to the agentic graph or
services.

| Command   | File          | Description                                                                                                          |
| --------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `create`  | `create.ts`   | Runs `runAgenticWorkflowStream()`, handles HITL prompts, organizes output into project folders, auto-generates docs. |
| `modify`  | `modify.ts`   | Loads an existing workflow, builds a modification goal, passes to `runAgenticWorkflow()`.                            |
| `test`    | `test.ts`     | Resolves sub-workflow dependencies, runs the agentic validator/repairer, handles ephemeral deploy/cleanup. Also drives the offline fixture replay loop. |
| `deploy`  | `deploy.ts`   | Directly pushes a local JSON to the n8n instance.                                                                    |
| `doc`     | `doc.ts`      | Uses `DocService` to generate Mermaid diagrams + AI summaries, organizes loose files into project folders.           |
| `fixture` | `fixture.ts`  | Two sub-commands: `capture` (pull real execution data from n8n → named fixture) and `init` (scaffold empty template). Fixtures stored in `.n8m/fixtures/<workflowId>/<name>.json`. |
| `learn`   | `learn.ts`    | Extracts reusable patterns from validated workflow JSON and writes `.md` pattern files to `.n8m/patterns/`. Also supports `--github owner/repo` to import patterns from a public GitHub archive. |
| `mcp`     | `mcp.ts`      | Launches the MCP (Model Context Protocol) server over stdio, exposing `create_workflow` and `test_workflow` as tools for Claude Desktop and other MCP clients. |
| `resume`  | `resume.ts`   | Resumes a paused graph session by thread ID from the SQLite checkpointer.                                            |
| `prune`   | `prune.ts`    | Deletes `[n8m:test:*]` prefixed workflows from the n8n instance.                                                     |
| `config`  | `config.ts`   | Reads/writes `~/.n8m/config.json`.                                                                                   |

### Project Folder Output

When a workflow is created or saved, it is organized into a slug-named folder:

```
./workflows/
  └── send-daily-slack-digest/
      ├── workflow.json    ← the n8n workflow
      └── README.md        ← AI-generated doc with Mermaid diagram
```

The slug is generated by `DocService.generateSlug()`, which lowercases the name
and replaces non-alphanumeric characters with hyphens.

---

## Testing Infrastructure

Tests live in `test/` and run with [Mocha](https://mochajs.org/) +
[Sinon](https://sinonjs.org/).

```bash
# Run all tests
npm test

# Watch mode
npm run dev
```

### Key Testing Principles

- **No live AI calls in tests**: `process.env.NODE_ENV=test` is set by
  `.mocharc.json`. The `AIService` and `N8nClient` must be fully mocked in test
  files via `sinon.stub()` before calling any tested code. Importing them causes
  the singleton to initialize — ensure stubs are applied first.
- **Ephemeral test workflows**: `n8m test` deploys workflows to n8n with a
  `[n8m:test]` name prefix and deletes them in the `finally` block — even on
  failure.
- **AI Scenario Generation**: Use `--ai-scenarios` flag to have the QA node
  generate 3 diverse test payloads automatically (happy path, edge case, error).

---

## Extending n8m

### Adding a New Agent Node

1. Create a new file in `src/agentic/nodes/my-node.ts`:
   ```typescript
   import { TeamState } from "../state.js";

   export const myNode = async (state: typeof TeamState.State) => {
       // Read from state, do work, return partial state
       return {
           collaborationLog: ["myNode: did something"],
       };
   };
   ```

2. Register it in `src/agentic/graph.ts`:
   ```typescript
   import { myNode } from "./nodes/my-node.js";

   const workflow = new StateGraph(TeamState)
       .addNode("myNode", myNode);
   // ... add edges
   ```

3. Add any new state fields to `src/agentic/state.ts`.

### Adding a New CLI Command

1. Create `src/commands/my-command.ts` extending `Command` from `@oclif/core`.
2. Register it in `package.json` under the `oclif.commands` field (or in the
   commands directory manifest).

### Adding a New AI Provider

`AIService` wraps the OpenAI SDK with custom `baseURL`. For any
OpenAI-compatible API:

```bash
n8m config --ai-base-url https://api.my-provider.com/v1 --ai-key <key> --ai-model my-model
```

For non-compatible APIs, implement a new private call method in `AIService`
(similar to `callAnthropicNative`) and route to it in `generateContent()`.

---

## Self-Healing Test Loop

Both `src/commands/test.ts` (`testRemoteWorkflowDirectly`) and
`src/agentic/nodes/qa.ts` implement the same AI-powered repair cycle:

```
1. Fire webhook / execute workflow
2. Poll for execution result
3. On failure → call AIService.evaluateTestError(error, nodes, failingNodeName)
4. Dispatch on returned action:
   ├── fix_node/code_node_js     → patch JS syntax in the Code node's jsCode
   ├── fix_node/execute_command  → patch shell script in Execute Command node
   ├── fix_node/binary_field     → correct a wrong binary field name (see below)
   ├── regenerate_payload        → ask AI to produce a new test input payload
   ├── structural_pass           → test environment limitation; mark as pass
   └── escalate                  → fundamental design flaw; abort with message
5. Apply fix, redeploy, retry
```

### `TestErrorEvaluation` interface

```typescript
// src/services/ai.service.ts
export interface TestErrorEvaluation {
  action: 'fix_node' | 'regenerate_payload' | 'structural_pass' | 'escalate';
  nodeFixType?: 'code_node_js' | 'execute_command' | 'binary_field';
  targetNodeName?: string;
  suggestedBinaryField?: string;
  reason: string;
}
```

### Binary field fix flow

When `nodeFixType === 'binary_field'` (error: `"has no binary field 'X'"`):

1. Find the predecessor node via the workflow's `connections` map.
2. If predecessor is an **HTTP Request** node → use `'data'` (always correct).
3. If predecessor is a **Code node** → call `AIService.inferBinaryFieldName(node)`,
   which reads `jsCode` and asks the AI what the binary field is called.
4. Any other predecessor type → `structural_pass` (can't determine field).
5. After **any** `binary_field` fix attempt, a subsequent binary error on the
   same run → `structural_pass` (avoids infinite loops in test environments
   that don't support binary pin injection).

---

## Fixture Infrastructure

Fixtures are managed by `src/utils/fixtureManager.ts` (`FixtureManager` class).

### Storage format

```
.n8m/fixtures/
  <workflowId>/          ← new multi-fixture directory (one file per scenario)
    happy-path.json
    error-case.json
  <workflowId>.json      ← legacy single-file format (still supported for reads)
```

`FixtureManager.loadAll(workflowId)` prefers the directory format, falling back
to the single legacy file if no directory exists.

### `WorkflowFixture` schema

```typescript
interface WorkflowFixture {
  version: '1.0';
  capturedAt: string;         // ISO timestamp
  workflowId: string;
  workflowName: string;
  description?: string;       // human label, e.g. "happy-path"
  expectedOutcome?: 'pass' | 'fail';  // default: 'pass'
  workflow: any;              // full workflow JSON
  execution: {
    id?: string;
    status: string;
    startedAt?: string;
    data: {
      resultData: {
        error?: any;
        runData: Record<string, any[]>;  // keyed by exact node name
      };
    };
  };
}
```

### Key methods

| Method | Description |
|---|---|
| `exists(workflowId)` | Returns `true` if any fixture (directory or legacy file) exists for the workflow. |
| `loadAll(workflowId)` | Returns all fixtures for a workflow as an array; used by `test.ts` to run every scenario. |
| `load(workflowId)` | Legacy: loads the single `.n8m/fixtures/<workflowId>.json` file. |
| `loadFromPath(filePath)` | Loads a fixture from an explicit path (used with `--fixture` flag). |
| `saveNamed(fixture, name)` | Saves to the per-workflow directory (new multi-fixture format). |
| `save(fixture)` | Legacy single-file save; used by `offerSaveFixture` after live test runs. |
| `getCapturedDate(workflowId)` | Returns the most recent `capturedAt` date across all fixtures. |

---

## MCP Server

`src/services/mcp.service.ts` implements an MCP server using the
`@modelcontextprotocol/sdk` package with a **stdio transport**.

```
Claude Desktop / Cursor / other MCP client
        │  stdio
        ▼
  MCPService (n8m-agent)
    ├── create_workflow(goal)   → runAgenticWorkflow(goal)
    └── test_workflow(workflowJson, goal) → deploys + validates ephemerally
```

The server runs as a long-lived process started by `n8m mcp`. It does not use
the HITL interrupt mechanism (no interactive prompts), so workflow generation
runs fully autonomously.

To integrate with Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "n8m": { "command": "npx", "args": ["n8m", "mcp"] }
  }
}
```

---

## Environment Variables

| Variable         | Description                                | Priority          |
| ---------------- | ------------------------------------------ | ----------------- |
| `AI_API_KEY`     | API key for the AI provider                | Env > Config file |
| `AI_PROVIDER`    | `openai`, `anthropic`, or `gemini`         | Env > Config file |
| `AI_MODEL`       | Override the default model                 | Env > Config file |
| `AI_BASE_URL`    | Base URL for any OpenAI-compatible API     | Env > Config file |
| `N8N_API_URL`    | URL of your n8n instance                   | Env > Config file |
| `N8N_API_KEY`    | n8n API key                                | Env > Config file |
| `GEMINI_API_KEY` | Alias for `AI_API_KEY` when using Gemini   | Env only          |
| `NODE_ENV`       | Set to `test` to prevent live AI/n8n calls | Env only          |

---

## Local Development

```bash
git clone https://github.com/lcanady/n8m.git
cd n8m
npm install

# Watch mode (recompiles on change)
npm run dev

# Run the CLI directly from source
./bin/run.js help
./bin/run.js create "Send a Slack message every morning"

# Run tests
npm test
```

### Build

```bash
npm run build  # Compiles TypeScript to dist/
```

The project uses `tsconfig.json` with `"module": "NodeNext"` and
`"moduleResolution": "NodeNext"`. All imports in source files must include the
`.js` extension, even for TypeScript files (this is resolved to `.ts` by the
TypeScript compiler at build time but must be explicit).
