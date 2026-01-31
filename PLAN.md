# n8m CLI Architecture & Skill Mapping

This document outlines the "Skill Bridge" architecture for `n8m`, mapping CLI
commands to specific Antigravity skills.

## Architecture: The Skill Bridge

The `n8m` CLI acts as a **Skill Bridge**. Its primary responsibility is to:

1. **Collect Input**: Parse CLI flags and arguments from the user.
2. **Context Assembly**: Gather relevant local environment data (e.g., `.n8n`
   config, local workflows).
3. **Skill Delegation**: Pass the collected context to a specialized Antigravity
   skill for the heavy lifting.

## Command Mapping

| CLI Command  | Antigravity Skill  | Purpose                                                                                |
| :----------- | :----------------- | :------------------------------------------------------------------------------------- |
| `n8m create` | `@n8n-architect`   | Generate or modify n8n workflows based on natural language or blueprints.              |
| `n8m deploy` | `@n8n-api-manager` | Push local workflows to an n8n instance via the API, handling secrets and credentials. |
| `n8m test`   | `@n8n-test-runner` | Execute end-to-end tests for workflows, validating nodes and output.                   |

## DX Standards

As defined in `.agent/rules/dx-standards.md`, all commands must prioritize
developer experience:

- **Visuals**: Color-coded logs (Chalk) and progress bars (cli-progress).
- **Direct Access**: Instant n8n deep links provided upon successful action.
- **Feedback**: Immediate validation of inputs before skill delegation.
