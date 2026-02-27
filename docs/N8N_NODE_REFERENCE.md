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

- **Description**: Interact with Slack.
- **Key Parameters**:
  - `resource`: "message", "channel", "user", "file".
  - `operation`: e.g., "post" (for message), "create" (for channel).
  - `channel`: Channel name or ID.
  - `text`: Message text.
  - `attachments`: (array of objects).

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
