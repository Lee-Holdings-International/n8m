<!-- keywords: bigquery, google bigquery, bq, sql, analytics, data warehouse, dataset, table, query, merge, insert, drop, create table -->

# Pattern: BigQuery Operations via HTTP Request

## Critical Rule
**NEVER use `n8n-nodes-base.googleBigQuery`** — it returns no output items for DDL/DML statements (CREATE, MERGE, UPDATE, DROP), breaking the workflow chain. Always use `n8n-nodes-base.httpRequest` with the BigQuery REST API instead.

## Authentication
All BigQuery HTTP nodes must use:
```json
{
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "googleApi"
}
```
The `googleApi` credential must have scopes: `https://www.googleapis.com/auth/bigquery`

---

## DDL / DML Queries (CREATE, MERGE, UPDATE, DROP)

Use the `jobs.query` synchronous endpoint. It always returns a JSON response, ensuring the workflow continues.

```json
{
  "parameters": {
    "method": "POST",
    "url": "=https://bigquery.googleapis.com/bigquery/v2/projects/YOUR_PROJECT/queries",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "googleApi",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ query: 'YOUR SQL HERE', useLegacySql: false, timeoutMs: 30000 }) }}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4
}
```

### CREATE TABLE example
```json
"jsonBody": "={{ JSON.stringify({ query: 'CREATE OR REPLACE TABLE `project.dataset.table` (Email STRING, Name STRING, Stripe_plan STRING, Unsubscribed BOOL)', useLegacySql: false, timeoutMs: 30000 }) }}"
```

### MERGE example (reference earlier node for dynamic table name)
```json
"jsonBody": "={{ JSON.stringify({ query: 'MERGE INTO `project.dataset.target` T USING `project.dataset.' + $('Parse CSV').item.json.stagingTable + '` S ON T.Email = S.Email WHEN MATCHED THEN UPDATE SET T.Name = S.Name WHEN NOT MATCHED THEN INSERT (Email, Name) VALUES (S.Email, S.Name)', useLegacySql: false, timeoutMs: 30000 }) }}"
```

### UPDATE example
```json
"jsonBody": "={{ JSON.stringify({ query: 'UPDATE `project.dataset.table` T SET T.active = false WHERE T.id NOT IN (SELECT id FROM `project.dataset.' + $('upstream').item.json.stagingTable + '`)', useLegacySql: false, timeoutMs: 30000 }) }}"
```

### DROP TABLE example
```json
"jsonBody": "={{ JSON.stringify({ query: 'DROP TABLE IF EXISTS `project.dataset.' + $('upstream').item.json.stagingTable + '`', useLegacySql: false, timeoutMs: 30000 }) }}"
```

---

## Streaming Insert (insertAll)

For inserting rows, use the `tabledata.insertAll` endpoint:

```json
{
  "parameters": {
    "method": "POST",
    "url": "=https://bigquery.googleapis.com/bigquery/v2/projects/YOUR_PROJECT/datasets/YOUR_DATASET/tables/{{ $('upstream').item.json.stagingTable }}/insertAll",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "googleApi",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ rows: $('Parse CSV').item.json.rows }) }}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4
}
```

Each row in `rows` must have an `insertId` (string) and `json` object:
```json
{ "insertId": "0", "json": { "Email": "user@example.com", "Name": "User" } }
```

---

## Error Cleanup Pattern

When a workflow creates a staging table, all intermediate nodes must have an error connection to a cleanup node that drops the table. This prevents orphaned tables on failure.

```json
"connections": {
  "Create Staging Table": {
    "main": [ [ { "node": "Insert Rows", "type": "main", "index": 0 } ] ],
    "error": [ [ { "node": "Drop Staging Table (Error)", "type": "main", "index": 0 } ] ]
  }
}
```

The error cleanup node uses `$('Generate Table Name').item.json.stagingTable` (not `$('Parse CSV')`) because errors may fire before the CSV parsing node runs.

---

## Required IAM Roles for Service Account
- `roles/bigquery.jobUser` — run jobs
- `roles/bigquery.dataEditor` — read/write table data
