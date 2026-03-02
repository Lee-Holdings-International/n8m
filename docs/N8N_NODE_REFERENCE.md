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

## Configuration Patterns

- **Authentication**: Most nodes use either `authentication: "none"` or a
  credential type.
- **Expressions**: Use `={{ ... }}` for dynamic values, e.g.,
  `={{ $json.fieldName }}`.
- **Node Connections**: Nodes are connected using the `connections` property in
  the workflow JSON, mapping source node outputs to target node inputs.
