# n8m: The Agentic CLI for n8n

> **Professional Tooling for n8n Developers.** Bring CI/CD, Integration Testing,
> and GitOps to your low-code workflows.

[![TypeScript](https://badgen.net/badge/Built%20with/TypeScript/blue)](https://typescriptlang.org/)
[![oclif](https://badgen.net/badge/CLI/oclif/purple)](https://oclif.io/)
[![n8n](https://badgen.net/badge/n8n/Compatible/orange)](https://n8n.io)

**Stop clicking. Start shipping.** You love n8n for its node-based power, but
managing deployments and testing manually is a pain. `n8m` bridges the gap. It
provides a command-line interface to **test**, **manage**, and **deploy** your
workflows, treating them like first-class code.

---

## ⚡ Why n8m?

### 🧪 Headless Integration Testing

Finally, run your workflows as automated test suites. `n8m test` spins up an
**ephemeral environment**, injects your mock data, runs the flow, and validates
the output—all without opening a browser.

- **Global Self-Repair Loop**: `n8m` targets both structural staging errors
  (hallucinated nodes) and logical execution failures (zero items produced). It
  uses AI to analyze failures and patch your workflows automatically.
- **CI/CD Ready**: Fail your build if the workflow breaks logic or schema.
- **Ephemeral**: Zero cleanup required. Temporary assets are purged
  automatically.

### 🤖 Multi-Agent Orchestration (Superpowers)

`n8m` now features a state-of-the-art agentic graph that distributes work across
specialized AI nodes:

- **Architect**: Designs the system blueprint and identifies required workflows.
- **Engineer**: Generates the actual workflow JSON, with parallel execution for
  speed.
- **Reviewer**: Performs static analysis to catch common n8n misconfigurations.
- **QA**: Automatically validates the generated logic against your goal.

### 💾 Persistent Memory & HITL

- **Human-in-the-Loop**: The agent pauses before critical steps (like QA) to
  allow you to review progress.
- **Session Persistence**: All work is saved to a local SQLite database. If an
  agent crashes or you pause it, you can pick up exactly where you left off.
- **Continuous Learning**: The self-repair loop now uses past failures to inform
  better patches in real-time.

---

## 🛠️ Installation

```bash
npm install -g n8m
```

## 🚀 Quick Start

### 1. Authenticate & Configure

Connect to the eco-system and configure your local n8n target.

```bash
# Login to n8m services
n8m login

# Link your local/remote n8n instance
n8m config --n8n-url https://n8n.your-company.com --n8n-key <your-api-key>
```

### 2. Create from Idea

Generate a complete system of workflows from a simple description.

```bash
n8m create "RSS feed to Slack with a sub-workflow for message formatting"
```

### 3. Resume & Persistent sessions

If a session is paused or fails, resume it using its Unique ID.

```bash
n8m resume <thread-id>
```

### 4. Intelligent Modification

Modify existing workflows using natural language. This command preserves your
workflow ID to ensure you update the correct target, and can automatically
trigger a test run.

```bash
# Modify a local file
n8m modify ./workflows/my-flow.json

# Modify an active workflow from your instance
n8m modify --multiline
```

### 5. Test & Auto-Repair

Validate local files or existing workflows with the deep repair loop.

```bash
n8m test ./workflows/my-flow.json
```

---

## 🏗️ Architecture

`n8m` is designed as a secure bridge.

```mermaid
graph TD
    User[Developer] -->|1. Goal| Architect
    
    subgraph "n8m Agentic Core"
    Architect -->|2. Spec| Engineer
    Engineer -->|3. JSON| Reviewer
    Reviewer -->|4. Fix?| Engineer
    Reviewer -->|5. Verify| QA
    QA -->|6. Retry| Engineer
    end
    
    Engineer -.->|Parallel Build| GenAI[Gemini AI]
    QA -->|Success| Save[Local Files]
    
    subgraph Persistence
    DB[(SQLite State)]
    end
    Architect --- DB
    Engineer --- DB
```

- **Local First**: Deployment and Testing communicate directly with your n8n
  instance.
- **AI Augmented**: Self-healing patches are powered by industry-leading LLMs
  integrated into the test runner.

---

## 🗺️ Roadmap

### 📦 Latest Releases

- [x] **Agentic Graph**: Specialized nodes (Architect, Engineer, QA) for complex
      builds.
- [x] **State Persistence**: SQLite-backed checkpointer for session recovery.
- [x] **HITL Interrupts**: Native support for pausing and resuming workflows.
- [x] **Parallel Generation**: Scalable workflow creation for multi-component
      systems.

### ⚡ Coming Soon

- [ ] **Native n8n Canvas Integration**: Visualize the agent's progress directly
      inside the n8n UI.
- [ ] **Collaborative Agents**: Invite multiple agents to work on a single goal.

---

## 💻 Local Development

Want to hack on the CLI itself?

```bash
# Clone & Install
git clone https://github.com/lcanady/n8m.git
cd n8m
npm install

# Run Locally
npm run dev

# Execute via local bin
./bin/run.js help
```
