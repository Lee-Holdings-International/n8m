# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-03-06

### Added
- **`n8m rollback`** — new command to restore a workflow file to any previous git-tracked version. Presents an interactive commit history, shows a node-level diff preview, confirms before writing, and optionally redeploys to n8n (`--deploy`).
- **Credential awareness** — before generating, `n8m create` and `n8m modify` now fetch the credential types configured on the target n8n instance (`GET /api/v1/credentials`) and pass them to every AI agent (Architect, Engineer). The AI is instructed to only plan nodes whose credential type is available; unlisted services fall back to HTTP Request. Gracefully skipped when n8n is not configured or the API key lacks credentials permissions.
- `N8nClient.getCredentials()` — new paginated method returning `{ id, name, type }[]`; returns `[]` on 401/403/network errors so missing permissions never block workflow generation.
- `buildCredentialContext()` — exported pure function that renders the credential section injected into Architect and Engineer prompts; returns `""` for empty/null input preserving offline behaviour.
- `GitService` — new service (`src/services/git.service.ts`) wrapping git operations: `isGitRepo()`, `getRepoRoot()`, `getRelativePath()`, `getFileHistory()`, `getFileAtCommit()`.
- `diffWorkflowNodes()` and `formatCommitChoice()` — exported pure helpers for diff preview and commit display formatting.
- `availableCredentials` field added to `TeamState` LangGraph state; `runAgenticWorkflowStream()` accepts an `initialState` spread so callers can inject it at graph start.

### Tests
- 100 new test assertions across four new test files: `n8n-client.credentials.test.ts`, `credential-context.test.ts`, `git.service.test.ts`, `rollback.test.ts` (275 total, all passing).

---

## [0.3.3] - 2026-03-06

### Fixed
- Updated import path for checkbox from `inquirer` to `@inquirer/checkbox`

---

## [0.3.2] - 2026-03-06

### Added
- Pattern search functionality and AI pattern generation (`learn` command, `searchPatterns`, BigQuery HTTP pattern doc)

---

## [0.2.4] - 2026-03-04

### Changed
- Refined workflow name assignment and updated graph state handling

---

## [0.2.3] - 2026-03-04

### Changed
- Simplified workflow graph edges and enhanced user interaction for strategy selection

---

## [0.2.2] - 2026-03-04

### Added
- Fixture capture now allows selection from multiple recent executions with improved logging
- Fixture management for offline testing of n8n workflows
- Slack node enhanced with additional operations and detailed descriptions

---

## [0.2.1] - 2026-02-27

No functional changes (version bump).

---

## [0.2.0] - 2026-02-27

### Added
- Documentation generation command
- Project-based workflow organisation
- Model Context Protocol (MCP) integration

---

## [0.1.3] - 2026-02-27

### Changed
- Centralised AI workflow generation, hallucination correction, and robust JSON parsing within `AIService`

### Added
- Multi-provider AI support (OpenAI, Anthropic, etc.)
- n8n node definition fallback
- Static node reference documentation

---

## [0.1.2] - 2026-02-26

### Added
- Multi-agent collaboration with evaluation logging in architect and supervisor nodes

---

## [0.1.1] - 2026-02-26

### Fixed
- Author and homepage fields in `package.json`
- Package name updated to scoped format (`@lhi/n8m`) with npm `--access` flag
- Removed unnecessary TypeScript suppression comments in `multilinePrompt`
- Restored `multilinePrompt` helper and corrected import paths
- Anchored `/workflows` gitignore rule

### Added
- `workflow_dispatch` trigger on the publish GitHub Actions workflow for manual releases
- Refactored `promptMultiline` import and new `multilinePrompt` utility

---

## [0.1.0] - 2026-01-30

### Added
- Initial n8m CLI implementation with core commands (`create`, `deploy`, `modify`, `test`, `resume`, `prune`, `logout`)
- Agentic framework: LangGraph graph with Architect, Engineer, Supervisor, Reviewer, and QA nodes
- RAG for the engineer agent using live n8n node schemas
- AI-driven workflow modification command
- Multiline input prompt and improved AI node mapping / connection handling
- `sanitizeWorkflow` utility applied before saving and deploying
- Unit tests for `N8nClient`, `NodeDefinitionsService`, reviewer node, sandbox, and supervisor node
- Billing functionality and API key authentication
- Updated design system and theming utilities
