# n8n Node Reference for AI Models

This document serves as a static reference for common n8n nodes when the live
fetch from the n8n instance fails. It covers some of the most frequently used
nodes and their parameters.

## Core Nodes

### 1. Manual Trigger (n8n-nodes-base.start)

- **Description**: The starting point for manual execution.
- **Parameters**: (None usually required)

### 2. HTTP Request (n8n-nodes-base.httpRequest)

- **Description**: Send HTTP requests to any API.
- **Key Parameters**:
  - `method`: HTTP method (GET, POST, PUT, DELETE, etc.)
  - `url`: The endpoint URL.
  - `authentication`: "none", "predefinedCredentialType".
  - `sendBody`: (boolean) Whether to send a body (required for POST/PUT).
  - `body`: { `contentType`: "json"|"form-data"|"binary", `content`: { ... } }
  - `sendHeaders`: (boolean)
  - `headerParameters`: List of { name, value }.

### 3. Slack (n8n-nodes-base.slack)

- **Description**: Send messages, manage channels, users, files, and reactions in Slack.
- **Resources & Operations**:
  - `message`: post | update | delete | get | getAll | search
  - `channel`: create | archive | unarchive | get | getAll | history | invite | join | kick | leave | open | rename | replies | setPurpose | setTopic
  - `file`: upload | get | getAll
  - `reaction`: add | remove | get
  - `user`: get | getAll | getPresence
  - `userGroup`: create | disable | enable | get | getAll
- **Core Parameters** (message.post):
  - `channel`: Channel name (`#general`) or ID (`C1234567890`). Required.
  - `text`: Plain-text fallback. Required when no blocks/attachments present. Supports mrkdwn if `otherOptions.mrkdwn=true`.
  - `blocksUi`: **Block Kit blocks** as a JSON array string. See Block Kit section below.
  - `attachments`: Legacy Slack attachment array as JSON string. Prefer `blocksUi` for new workflows.
- **otherOptions** (collection, all optional):
  - `thread_ts`: Timestamp of parent message — posts as a thread reply. Source from `$json.ts` on a previous Slack response.
  - `reply_broadcast`: `true` to also broadcast a thread reply to the channel.
  - `mrkdwn`: `true` to enable Markdown in `text`.
  - `username`: Override the bot display name for this post.
  - `icon_emoji`: Override bot icon with an emoji (`:robot_face:`).
  - `icon_url`: Override bot icon with an image URL.
  - `unfurl_links` / `unfurl_media`: Control link/media previews.

#### Block Kit (`blocksUi`) — CRITICAL NOTES

`blocksUi` must be a **valid JSON array string** at runtime. n8n parses it with
`JSON.parse()` — if the expression produces anything invalid the node throws
`"Parameter 'blocksUi' could not be parsed"`.

**Rules:**
1. The entire value must be a JSON array: `[{...}, {...}]`
2. n8n expressions (`={{ ... }}`) go **inside string values**, never at the array wrapper level.
3. If a referenced field might be `null`/`undefined`, guard it: `={{ $json.body.content ?? '' }}`
4. Keep block text under 3000 chars. Max 50 blocks per message.

**Supported block types**: `section`, `header`, `divider`, `image`, `actions`, `context`, `input`

**Minimal working examples:**

```json
// Simple text section
[{"type":"section","text":{"type":"mrkdwn","text":"={{ $json.body.content }}"}}]

// Header + body
[
  {"type":"header","text":{"type":"plain_text","text":"={{ $json.body.title }}","emoji":true}},
  {"type":"section","text":{"type":"mrkdwn","text":"={{ $json.body.content }}"}},
  {"type":"divider"}
]

// Section with two fields side-by-side
[{"type":"section","fields":[
  {"type":"mrkdwn","text":"*Status:*\n={{ $json.status }}"},
  {"type":"mrkdwn","text":"*Priority:*\n={{ $json.priority }}"}
]}]

// Action buttons
[{"type":"actions","elements":[
  {"type":"button","text":{"type":"plain_text","text":"Approve"},"style":"primary","action_id":"approve","value":"={{ $json.id }}"},
  {"type":"button","text":{"type":"plain_text","text":"Reject"},"style":"danger","action_id":"reject","value":"={{ $json.id }}"}
]}]

// Context (small grey text)
[{"type":"context","elements":[{"type":"mrkdwn","text":"Posted by n8m • {{ $now.toISO() }}"}]}]
```

**Thread reply example:**
```json
{
  "resource": "message",
  "operation": "post",
  "channel": "#alerts",
  "text": "={{ $json.summary }}",
  "otherOptions": {
    "thread_ts": "={{ $json.ts }}",
    "reply_broadcast": false
  }
}
```

#### Trigger (n8n-nodes-base.slackTrigger)

Receives Slack events via webhooks. Key `triggerOn` values:
- `message` — new message in a channel
- `appMention` — bot is @mentioned
- `reactionAdded` / `reactionRemoved`
- `teamJoin` — new user joins workspace
- `channelCreated` — new public channel

### 4. Set (n8n-nodes-base.set)

- **Description**: Manipulate data or create new variables.
- **Key Parameters**:
  - `values`: Array of { `name`, `type` (string/number/boolean), `value` }.
  - `options`: { `keepOnlySet`: boolean }.

### 5. IF (n8n-nodes-base.if)

- **Description**: Conditional logic (True/False branches).
- **Key Parameters**:
  - `conditions`: { `string`|`number`|`boolean`: [ { `value1`, `operation`,
    `value2` } ] }
  - Common operations: `equals`, `contains`, `isEmpty`, `isTrue`.

### 6. Webhook (n8n-nodes-base.webhook)

- **Description**: Receive external HTTP requests.
- **Key Parameters**:
  - `httpMethod`: GET, POST, etc.
  - `path`: URL path.
  - `responseMode`: "onReceived", "lastNode".

### 7. Google Sheets (n8n-nodes-base.googleSheets)

- **Description**: Read/Write data to Google Sheets.
- **Key Parameters**:
  - `resource`: "sheet".
  - `operation`: "append", "update", "read".
  - `sheetId`: Spreadsheet ID.
  - `range`: Sheet name and range (e.g., "Sheet1!A:Z").

### 8. Code (n8n-nodes-base.code)

- **Description**: Run arbitrary JavaScript/TypeScript.
- **Key Parameters**:
  - `language`: "javaScript" or "typeScript".
  - `jsCode`: The code string.

### 9. Schedule Trigger (n8n-nodes-base.scheduleTrigger)

- **Description**: Triggers a workflow on a time-based schedule (cron).
- **Key Parameters**:
  - `rule`: Object with `interval` array. Each entry has:
    - `field`: `"cronExpression"` | `"hours"` | `"days"` | `"weeks"` | `"months"`
    - `expression`: cron string when `field` is `"cronExpression"` (e.g. `"0 9 * * 1-5"`)
    - `hoursInterval` / `minutesInterval`: numeric intervals for simpler schedules
- **Notes**: Use `cronExpression` for precise schedules (e.g. every weekday at 9 AM). Do NOT use `n8n-nodes-base.cron` — it is deprecated.

### 10. Execute Workflow (n8n-nodes-base.executeWorkflow)

- **Description**: Call another n8n workflow as a sub-workflow and get its output.
- **Key Parameters**:
  - `source`: `"database"` (reference by ID) or `"localFile"` (path to JSON).
  - `workflowId`: ID of the workflow to call (when `source` is `"database"`).
  - `options.waitForSubWorkflow`: `true` to wait for the sub-workflow to finish (default).

### 11. Execute Workflow Trigger (n8n-nodes-base.executeWorkflowTrigger)

- **Description**: The trigger node that receives data when another workflow calls this one via Execute Workflow.
- **Parameters**: None required. The node receives whatever data the calling workflow sends.
- **Notes**: Use this as the start node in sub-workflows. Do NOT pair it with `n8n-nodes-base.start` in the same workflow.

### 12. Merge (n8n-nodes-base.merge)

- **Description**: Combine data from multiple input branches.
- **Key Parameters**:
  - `mode`: `"append"` | `"mergeByIndex"` | `"mergeByKey"` | `"multiplex"` | `"passThrough"` | `"wait"`
  - `propertyName1` / `propertyName2`: Key fields for `"mergeByKey"` mode.
- **Common use**: `"append"` to collect results from parallel branches; `"mergeByKey"` to join datasets on a shared field.

### 13. Switch (n8n-nodes-base.switch)

- **Description**: Route items to different outputs based on a value (multi-branch IF).
- **Key Parameters**:
  - `dataType`: `"string"` | `"number"` | `"boolean"`
  - `value1`: The value to compare (expression).
  - `rules.rules`: Array of `{ value2, outputKey }` pairs.
  - `fallbackOutput`: Index to route non-matching items (default: ignored).

### 14. Loop Over Items (n8n-nodes-base.splitInBatches)

- **Description**: Iterate over a list in chunks, re-running downstream nodes for each batch.
- **Key Parameters**:
  - `batchSize`: Number of items per loop iteration.
  - `options.reset`: `true` to reset the counter on the first run.
- **Notes**: Connect the "loop" output back to the nodes you want to repeat. Connect the "done" output to what runs after the loop.

### 15. Wait (n8n-nodes-base.wait)

- **Description**: Pause execution and resume on a webhook call, a time delay, or a specific date/time.
- **Key Parameters**:
  - `resume`: `"timeInterval"` | `"specificTime"` | `"webhook"`
  - `amount` + `unit`: For `"timeInterval"` (e.g. `amount: 5`, `unit: "minutes"`).
  - `dateTime`: ISO string for `"specificTime"`.

### 16. Respond to Webhook (n8n-nodes-base.respondToWebhook)

- **Description**: Send an HTTP response back to the caller of a Webhook node.
- **Key Parameters**:
  - `respondWith`: `"text"` | `"json"` | `"binary"` | `"noData"` | `"redirect"`
  - `responseBody`: The body to return (for `"text"` or `"json"`).
  - `responseCode`: HTTP status code (default `200`).
- **Notes**: Only valid when the upstream Webhook node has `responseMode: "lastNode"`. Must be the final node in the chain.

### 17. Gmail (n8n-nodes-base.gmail)

- **Description**: Send, receive, and manage Gmail messages and labels.
- **Resources & Operations**:
  - `message`: `send` | `get` | `getAll` | `delete` | `reply` | `addLabels` | `removeLabels` | `markAsRead` | `markAsUnread`
  - `label`: `create` | `delete` | `get` | `getAll`
- **Core send parameters**:
  - `sendTo`: Recipient email address.
  - `subject`: Email subject.
  - `message`: Body text (HTML supported when `emailType: "html"`).
  - `options.attachmentsUi`: List of binary field names to attach.

### 18. Gmail Trigger (n8n-nodes-base.gmailTrigger)

- **Description**: Polls Gmail and triggers when new messages arrive matching a filter.
- **Key Parameters**:
  - `filters.labelIds`: Array of Gmail label IDs to watch (e.g. `["INBOX", "UNREAD"]`).
  - `pollTime.mode`: `"everyMinute"` | `"everyHour"` | `"custom"` (cron).
  - `simple`: `true` to return simplified output; `false` for raw Gmail API response.

### 19. Postgres (n8n-nodes-base.postgres)

- **Description**: Execute queries against a PostgreSQL database.
- **Key Parameters**:
  - `operation`: `"executeQuery"` | `"insert"` | `"update"` | `"delete"` | `"select"`
  - `query`: Raw SQL (for `"executeQuery"`).
  - `table`: Target table name.
  - `schema`: Schema name (default `"public"`).
  - `columns`: Comma-separated column names for insert/update.
- **Authentication**: Requires `postgres` credential type.

### 20. MySQL (n8n-nodes-base.mySql)

- **Description**: Execute queries against a MySQL/MariaDB database.
- **Key Parameters**: Same pattern as Postgres (`operation`, `query`, `table`).
- **Authentication**: Requires `mySql` credential type.

### 21. Airtable (n8n-nodes-base.airtable)

- **Description**: Read, create, update, and delete Airtable records.
- **Resources & Operations**:
  - `record`: `create` | `delete` | `get` | `list` | `update`
- **Key Parameters**:
  - `baseId`: Airtable Base ID (starts with `app`).
  - `tableId`: Table ID or name.
  - `fields`: Object of field values for create/update.
  - `filterByFormula`: Airtable formula string for list filtering.

### 22. Discord (n8n-nodes-base.discord)

- **Description**: Send messages and manage content in Discord channels.
- **Resources & Operations**:
  - `message`: `send` | `get` | `getAll` | `delete` | `react` | `pin` | `unpin`
  - `channel`: `create` | `delete` | `get` | `getAll` | `update`
  - `member`: `ban` | `get` | `getAll` | `kick` | `roleAdd` | `roleRemove`
- **Core send parameters**:
  - `channelId`: Target channel ID.
  - `content`: Message text. Supports Discord markdown.
  - `options.embeds`: Array of embed objects.

### 23. GitHub (n8n-nodes-base.github)

- **Description**: Interact with the GitHub REST API — repos, issues, PRs, releases, files.
- **Resources & Operations**:
  - `issue`: `create` | `edit` | `get` | `getAll` | `lock` | `createComment`
  - `pullRequest`: `create` | `get` | `getAll` | `createReview` | `merge`
  - `release`: `create` | `delete` | `get` | `getAll` | `update`
  - `file`: `create` | `delete` | `edit` | `get` | `list`
  - `repository`: `get` | `getLicense` | `getProfile` | `listPopularPaths`
- **Key Parameters**:
  - `owner`: Repository owner (user or org).
  - `repository`: Repository name.

### 24. Notion (n8n-nodes-base.notion)

- **Description**: Read and write Notion pages, databases, blocks, and users.
- **Resources & Operations**:
  - `database`: `get` | `getAll` | `search`
  - `databasePage`: `create` | `get` | `getAll` | `update`
  - `page`: `archive` | `create` | `get` | `search` | `update`
  - `block`: `append` | `getAll` | `delete`
  - `user`: `get` | `getAll`
- **Key Parameters**:
  - `pageId` / `databaseId`: Notion object IDs (32-char hex, no dashes required).
  - `propertiesUi`: Collection of property values for page create/update.

### 25. OpenAI (n8n-nodes-base.openAi)

- **Description**: Call OpenAI APIs for text, image, audio, and embeddings.
- **Resources & Operations**:
  - `text`: `message` (chat completions)
  - `image`: `generate` | `analyze`
  - `audio`: `transcribe` | `translate` | `generateSpeech`
  - `assistant`: `create` | `delete` | `get` | `list` | `message` | `update`
  - `file`: `delete` | `get` | `list` | `upload`
- **Key chat parameters**:
  - `modelId`: e.g. `"gpt-4o"`, `"gpt-4o-mini"`.
  - `messages.values`: Array of `{ role, content }` objects.
  - `options.temperature` / `options.maxTokens`.

### 26. AI Agent (n8n-nodes-langchain.agent)

- **Description**: An LLM-powered agent that can call tools in a loop to complete a goal.
- **Key Parameters**:
  - `text`: The user prompt / task description. Supports `={{ $json.query }}`.
  - `options.systemMessage`: System prompt to set the agent's persona.
  - `options.maxIterations`: Maximum tool-call iterations (default 10).
- **Notes**: This is a LangChain node (`n8n-nodes-langchain`), not `n8n-nodes-base`. It requires sub-nodes connected to the `ai_tool`, `ai_memory`, and `ai_languageModel` inputs.

### 27. HTTP Request Tool (n8n-nodes-langchain.toolHttpRequest)

- **Description**: Expose an HTTP endpoint as a tool available to an AI Agent node.
- **Key Parameters**:
  - `url`: The endpoint URL.
  - `method`: HTTP method.
  - `sendBody` / `bodyParameters`: Body to send.
  - `description`: Human-readable description the LLM uses to decide when to call this tool.
- **Notes**: Connect to the `ai_tool` input of an AI Agent node.

### 28. Respond to AI Agent (n8n-nodes-langchain.toolWorkflow)

- **Description**: Expose another n8n workflow as a callable tool for an AI Agent.
- **Key Parameters**:
  - `workflowId`: ID of the sub-workflow to invoke.
  - `description`: What this tool does (seen by the LLM).

---

## Configuration Patterns

- **Authentication**: Most nodes use either `authentication: "none"` or a
  credential type string in `nodeCredentialType`.
- **Expressions**: Use `={{ ... }}` for dynamic values, e.g.,
  `={{ $json.fieldName }}`. Guard potentially null values:
  `={{ $json.field ?? 'default' }}`.
- **Accessing upstream nodes**: `$('Node Name').item.json.field` or
  `$('Node Name').all()` to get all items from a named node.
- **Binary data**: Access binary fields via `$binary.fieldName`. When passing
  binary between nodes, ensure the field name matches exactly what the
  producing node outputs (HTTP Request → `data`, Code nodes → whatever the
  code sets).
- **Node Connections**: Nodes are connected using the `connections` property in
  the workflow JSON, mapping source node outputs to target node inputs.
- **Error handling**: Add `"onError": "continueErrorOutput"` to a node's
  settings to route errors to a secondary output instead of stopping the
  workflow.
- **typeVersion**: Always set the correct `typeVersion` for each node type.
  When in doubt, use the version from the live n8n instance's node schema.
  Using an incorrect version can cause silent failures or missing parameters.
