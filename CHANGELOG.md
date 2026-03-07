# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-03-06

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
