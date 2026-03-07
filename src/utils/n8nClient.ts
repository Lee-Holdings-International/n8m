
export interface N8nClientConfig {
  apiUrl?: string
  apiKey?: string
}

export interface WorkflowExecutionResult {
  executionId: string
  finished: boolean
  success: boolean
  data?: unknown
  error?: string
}

export interface WorkflowValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * n8n API Client
 * 
 * Handles authentication and environment variables automatically.
 * Follows @typescript-expert patterns for robust error handling and type safety.
 */
export class N8nClient {
  private apiUrl: string
  private apiKey: string
  private headers: Record<string, string>

  constructor(config?: N8nClientConfig) {
    // Priority: Explicit Config > Environment > Defaults
    this.apiUrl = config?.apiUrl ?? process.env.N8N_API_URL ?? 'http://localhost:5678/api/v1'
    this.apiKey = config?.apiKey ?? process.env.N8N_API_KEY ?? ''

    // Normalize: ensure the URL ends with /api/v1 (config may store bare base URL)
    if (!this.apiUrl.includes('/api/v1')) {
      this.apiUrl = this.apiUrl.replace(/\/?$/, '') + '/api/v1'
    }

    // Constructor validation moved to method call time to allow lazy loading
    // from config file if not provided here.
    this.headers = {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': this.apiKey,
    }
  }

  /**
   * Assert that an API response is OK, throwing an actionable error for 401/403.
   */
  private async assertOk(response: Response, operation: string): Promise<void> {
    if (response.ok) return;
    const errorText = await response.text();
    if (response.status === 403) {
      throw new Error(
        `${operation} failed (403 Forbidden). Your n8n API key does not have permission to access this resource. ` +
        `In n8n, go to Settings → n8n API and ensure the key belongs to the same owner/project as the workflow. ` +
        `n8n says: ${errorText}`
      );
    }
    if (response.status === 401) {
      throw new Error(
        `${operation} failed (401 Unauthorized). Your n8n API key is missing or invalid. ` +
        `Run: n8m config --n8n-key <your-key>`
      );
    }
    throw new Error(`${operation} failed: ${response.status} - ${errorText}`);
  }

  /**
   * Activate a workflow
   */
  async activateWorkflow(workflowId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/workflows/${workflowId}/activate`, {
      headers: this.headers,
      method: 'POST',
    })

    await this.assertOk(response, 'activate workflow')
  }

  /**
   * Deactivate a workflow
   */
  async deactivateWorkflow(workflowId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/workflows/${workflowId}/deactivate`, {
      headers: this.headers,
      method: 'POST',
    })

    await this.assertOk(response, 'deactivate workflow')
  }

  /**
   * Execute a workflow and return the result
   */
  async executeWorkflow(workflowId: string, _data?: unknown): Promise<WorkflowExecutionResult> {
    try {
      // NOTE: Public API does not always expose a direct 'execute' endpoint for all workflow types.
      // For validation purposes, we 'activate' the workflow which runs internal validation.
      const response = await fetch(`${this.apiUrl}/workflows/${workflowId}/activate`, {
        headers: this.headers,
        method: 'POST',
      })

      await this.assertOk(response, 'execute workflow')

      // If activation succeeds, we assume basic validation passed.
      const result = await response.json()
      return {
        data: result,
        error: undefined,
        executionId: 'val-' + Math.random().toString(36).substring(7),
        finished: true,
        success: true, 
      }
    } catch (error) {
      throw new Error(`Failed to validate workflow: ${(error as Error).message}`)
    }
  }

  /**
   * Get workflow execution details and logs
   */
  async getExecution(executionId: string): Promise<unknown> {
    try {
      const response = await fetch(`${this.apiUrl}/executions/${executionId}?includeData=true`, {
        headers: this.headers,
        method: 'GET',
      })

      await this.assertOk(response, 'get execution')

      return response.json()
    } catch (error) {
      throw new Error(`Failed to fetch execution: ${(error as Error).message}`)
    }
  }


  /**
   * Get executions for a workflow
   */
  async getWorkflowExecutions(workflowId: string): Promise<any[]> {
    try {
      const url = new URL(`${this.apiUrl}/executions`);
      url.searchParams.set('workflowId', workflowId);
      url.searchParams.set('limit', '25');

      const response = await fetch(url.toString(), {
        headers: this.headers,
        method: 'GET',
      })

      await this.assertOk(response, 'get workflow executions')

      const result = await response.json();
      return result.data;
    } catch (error) {
      throw new Error(`Failed to fetch workflow executions: ${(error as Error).message}`)
    }
  }

  /**
   * Update a workflow JSON
   */
  async updateWorkflow(workflowId: string, workflowData: unknown): Promise<void> {
    try {
      const w = workflowData as Record<string, unknown>;
      const settings = { ...(w.settings as Record<string, unknown> || {}) };
      delete settings.timezone;

      const SAFE_NODE_PROPS = new Set([
        'id', 'name', 'type', 'typeVersion', 'position', 'parameters',
        'credentials', 'disabled', 'webhookId', 'notes', 'notesInFlow',
        'continueOnFail', 'alwaysOutputData', 'executeOnce', 'retryOnFail',
        'maxTries', 'waitBetweenTries',
      ]);

      const buildPayload = (sanitizeNodes: boolean, includeVersionId: boolean) => {
        const nodes = sanitizeNodes
          ? ((w.nodes as any[]) || []).map((node: any) => {
              const clean: Record<string, unknown> = {};
              for (const key of Object.keys(node)) {
                if (SAFE_NODE_PROPS.has(key)) clean[key] = node[key];
              }
              return clean;
            })
          : w.nodes;
        const payload: Record<string, unknown> = {
          name: w.name,
          nodes,
          connections: w.connections,
          settings,
        };
        if (includeVersionId && w.versionId) payload.versionId = w.versionId;
        return payload;
      };

      const attempts = [
        buildPayload(false, true),   // full nodes + versionId
        buildPayload(true, true),    // sanitized nodes + versionId
        buildPayload(true, false),   // sanitized nodes, no versionId
      ];

      let response!: Response;
      let errorText = '';
      for (const payload of attempts) {
        response = await fetch(`${this.apiUrl}/workflows/${workflowId}`, {
          body: JSON.stringify(payload),
          headers: this.headers,
          method: 'PUT',
        });
        if (response.ok) return;
        errorText = await response.text();
        if (response.status !== 400 || !errorText.includes('additional properties')) break;
      }

      throw new Error(`update workflow failed: ${response.status} - ${errorText}`);
    } catch (error) {
      throw new Error(`Failed to update workflow: ${(error as Error).message}`)
    }
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(workflowId: string): Promise<unknown> {
    try {
      const response = await fetch(`${this.apiUrl}/workflows/${workflowId}`, {
        headers: this.headers,
        method: 'GET',
      })

      await this.assertOk(response, 'get workflow')

      return response.json()
    } catch (error) {
      throw new Error(`Failed to fetch workflow: ${(error as Error).message}`)
    }
  }

  /**
   * Strip invalid timezone from workflow settings so n8n activation never 400s.
   */
  private sanitizeSettings(data: Record<string, unknown>): Record<string, unknown> {
    if (!data.settings || typeof data.settings !== 'object') return data;
    const settings = { ...(data.settings as Record<string, unknown>) };
    // Always remove timezone — n8n validates against its own list and AI-generated
    // values (including seemingly valid ones like "UTC") cause activation 400s.
    // n8n will use the instance-level default timezone instead.
    delete settings.timezone;
    return { ...data, settings };
  }

  /**
   * Create a new workflow
   */
  async createWorkflow(name: string, workflowData: unknown): Promise<{id: string}> {
    try {
      const w = workflowData as Record<string, unknown>;
      const settings = { ...(w.settings as Record<string, unknown> || {}) };
      delete settings.timezone;

      const payload: Record<string, unknown> = {
        name,
        nodes: w.nodes ?? [],
        connections: w.connections ?? {},
        settings,
      };

      const response = await fetch(`${this.apiUrl}/workflows`, {
        body: JSON.stringify(payload),
        headers: this.headers,
        method: 'POST',
      })

      await this.assertOk(response, 'create workflow')

      const result = await response.json()
      return {id: result.id}
    } catch (error) {
      const msg = (error as Error).message;
      if (msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
        throw new Error(`Cannot connect to n8n at ${this.apiUrl}. Ensure n8n is running and the URL is correct.`);
      }
      throw new Error(`Failed to create workflow: ${msg}`)
    }
  }

  /**
   * Get all installed node types directly from the n8n REST API.
   * Handles paginated responses and returns the full node type objects.
   */
  async getNodeTypes(): Promise<any[]> {
    try {
      let all: any[] = [];
      let cursor: string | undefined = undefined;

      do {
        const url = new URL(`${this.apiUrl}/node-types`);
        if (cursor) url.searchParams.set('cursor', cursor);

        const response = await fetch(url.toString(), {
          headers: this.headers,
          method: 'GET',
        });

        if (!response.ok) {
          return [];
        }

        const result = await response.json();

        if (Array.isArray(result)) {
          all = [...all, ...result];
          cursor = undefined;
        } else if (result.data && Array.isArray(result.data)) {
          all = [...all, ...result.data];
          cursor = result.nextCursor ?? undefined;
        } else {
          // Unknown format — stop paging
          break;
        }
      } while (cursor);

      return all;
    } catch (error) {
      console.warn(`[N8nClient] Failed to fetch node types: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Get all workflows
   */
  async getWorkflows(): Promise<{id: string, name: string, active: boolean, updatedAt: string}[]> {
    try {
      let allWorkflows: any[] = [];
      let cursor: string | undefined = undefined;

      do {
          const url = new URL(`${this.apiUrl}/workflows`);
          if (cursor) url.searchParams.set('cursor', cursor);
          // increase limit to max to minimize requests
          url.searchParams.set('limit', '250'); 

          const response = await fetch(url.toString(), {
            headers: this.headers,
            method: 'GET',
          })

          await this.assertOk(response, 'get workflows')

          const result = await response.json();
          allWorkflows = [...allWorkflows, ...result.data];
          cursor = result.nextCursor;
          
      } while (cursor);

      return allWorkflows.filter((w: any) => !w.isArchived);
    } catch (error) {
      throw new Error(`Failed to fetch workflows: ${(error as Error).message}`)
    }
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/workflows/${workflowId}`, {
        headers: this.headers,
        method: 'DELETE',
      })

      await this.assertOk(response, 'delete workflow')
    } catch (error) {
      throw new Error(`Failed to delete workflow: ${(error as Error).message}`)
    }
  }

  /**
   * Inject a trigger node to satisfy activation requirements.
   * Uses a Webhook to allow actual activation (Manual triggers don't allow activation).
   */
  injectManualTrigger(workflowData: any): any {
      const shimNodeId = "shim-trigger-" + Math.random().toString(36).substring(7);
      const webhookPath = String("n8m-shim-" + Math.random().toString(36).substring(7));
      
      // Shim Node (Trigger)
      const shimNode = {
          parameters: {
              httpMethod: "POST",
              path: webhookPath,
              responseMode: "onReceived",
              options: {}
          },
          id: shimNodeId,
          name: "N8M_Shim_Webhook",
          type: "n8n-nodes-base.webhook",
          typeVersion: 1,
          position: [0, 0],
          webhookId: String(webhookPath)
      };

      // Flattener Node (Code)
      // Hoists 'body' and 'query' to root so downstream nodes see expected schema
      const flattenerId = "shim-flattener-" + Math.random().toString(36).substring(7);
      const flattenerNode: any = {
          parameters: {
              jsCode: `return items.map(item => {
    const body = item.json.body || {};
    const query = item.json.query || {};
    // Prioritize body over query, and existing item props
    return {
        json: {
            ...item.json,
            ...query,
            ...body
        }
    };
});`
          },
          id: flattenerId,
          name: "Shim_Flattener",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [200, 0]
      };
      
      // Ensure no webhookId on flattener or non-webhooks
      delete flattenerNode.webhookId;

      const nodes = [...(workflowData.nodes || []), shimNode, flattenerNode];
      const connections = { ...(workflowData.connections || {}) };

      // Try to connect to the first non-trigger node to make it a valid flow
      const targetNode = nodes.find((n: any) => n.id !== shimNodeId && n.id !== flattenerId && !n.type.includes('Trigger'));
      
      if (targetNode) {
          // Connect Webhook -> Flattener
          if (!connections[shimNode.name]) {
              connections[shimNode.name] = {
                  main: [
                      [
                          {
                              node: flattenerNode.name,
                              type: 'main',
                              index: 0
                          }
                      ]
                  ]
              };
          }
          
          // Connect Flattener -> Target
          if (!connections[flattenerNode.name]) {
              connections[flattenerNode.name] = {
                  main: [
                      [
                          {
                              node: targetNode.name,
                              type: 'main',
                              index: 0
                          }
                      ]
                  ]
              };
          }
      }

      return {
          ...workflowData,
          nodes,
          connections
      };
  }

  /**
   * Temporarily set pin data on a workflow so test executions receive
   * synthetic binary data instead of running binary-generating nodes live.
   * Pass pinData:{} to clear injected pins and restore the original state.
   *
   * The public /api/v1/ schema may reject pinData as an "additional property".
   * In that case we fall back to the internal /rest/ API that n8n's own UI uses,
   * which accepts pinData without schema restriction.
   */
  async setPinData(workflowId: string, workflowData: any, pinData: Record<string, any[]>): Promise<void> {
    const settings = { ...(workflowData.settings || {}) };
    delete settings.timezone; // n8n rejects many timezone values
    const payload: Record<string, unknown> = {
      name: workflowData.name,
      nodes: workflowData.nodes,
      connections: workflowData.connections,
      settings,
      pinData,
    };
    // Preserve versionId and staticData so the internal API doesn't reset them
    if (workflowData.versionId) payload.versionId = workflowData.versionId;
    if (workflowData.staticData) payload.staticData = workflowData.staticData;

    // Attempt 1: public /api/v1/ endpoint
    const pubResponse = await fetch(`${this.apiUrl}/workflows/${workflowId}`, {
      body: JSON.stringify(payload),
      headers: this.headers,
      method: 'PUT',
    });

    if (pubResponse.ok) return;

    const pubErr = await pubResponse.text();

    // Attempt 2: internal /rest/ endpoint (used by n8n UI; accepts pinData)
    if (pubResponse.status === 400 && pubErr.includes('additional properties')) {
      const restUrl = this.apiUrl.replace('/api/v1', '/rest');
      const restResponse = await fetch(`${restUrl}/workflows/${workflowId}`, {
        body: JSON.stringify(payload),
        headers: this.headers,
        method: 'PUT',
      });
      if (restResponse.ok) return;
      const restErr = await restResponse.text();
      throw new Error(`set pin data failed: ${restResponse.status} - ${restErr}`);
    }

    if (pubResponse.status === 403) {
      throw new Error(
        `set pin data failed (403 Forbidden). Ensure your API key has permission to update this workflow. n8n says: ${pubErr}`
      );
    }
    if (pubResponse.status === 401) {
      throw new Error(`set pin data failed (401 Unauthorized). Run: n8m config --n8n-key <your-key>`);
    }
    throw new Error(`set pin data failed: ${pubResponse.status} - ${pubErr}`);
  }

  /**
   * Get n8n instance deep link for a workflow
   */
  getWorkflowLink(workflowId: string): string {
    const baseUrl = this.apiUrl.replace('/api/v1', '')
    return `${baseUrl}/workflow/${workflowId}`
  }

  /**
   * Node types that never make external HTTP calls — pure logic, control flow,
   * data transformation, or local execution.  Everything else is a candidate
   * for shimming during test runs.
   */
  private static readonly PASS_THROUGH_TYPES = new Set([
    'n8n-nodes-base.webhook',
    'n8n-nodes-base.manualTrigger',
    'n8n-nodes-base.scheduleTrigger',
    'n8n-nodes-base.intervalTrigger',
    'n8n-nodes-base.code',
    'n8n-nodes-base.function',
    'n8n-nodes-base.functionItem',
    'n8n-nodes-base.if',
    'n8n-nodes-base.switch',
    'n8n-nodes-base.set',
    'n8n-nodes-base.editFields',
    'n8n-nodes-base.merge',
    'n8n-nodes-base.noOp',
    'n8n-nodes-base.executeWorkflow',
    'n8n-nodes-base.executeWorkflowTrigger',
    'n8n-nodes-base.respondToWebhook',
    'n8n-nodes-base.wait',
    'n8n-nodes-base.splitInBatches',
    'n8n-nodes-base.aggregate',
    'n8n-nodes-base.splitOut',
    'n8n-nodes-base.itemLists',
    'n8n-nodes-base.filter',
    'n8n-nodes-base.sort',
    'n8n-nodes-base.limit',
    'n8n-nodes-base.removeDuplicates',
    'n8n-nodes-base.dateTime',
    'n8n-nodes-base.html',
    'n8n-nodes-base.htmlExtract',
    'n8n-nodes-base.xml',
    'n8n-nodes-base.markdown',
    'n8n-nodes-base.compression',
    'n8n-nodes-base.convertToFile',
    'n8n-nodes-base.extractFromFile',
    'n8n-nodes-base.crypto',
    'n8n-nodes-base.executeCommand',
    'n8n-nodes-base.stickyNote',
    'n8n-nodes-base.start',
  ]);

  /**
   * Replace every node that makes external network calls with an inert Code shim
   * returning plausible fake data.  Node NAMES (and IDs) are preserved so
   * connections stay valid.  Used to ensure tests never hit real external services.
   *
   * Shimming criteria: the node has credentials configured OR is an HTTP Request node.
   * Pure-logic nodes in PASS_THROUGH_TYPES are always left untouched.
   */
  static shimNetworkNodes(nodes: any[]): any[] {
    return nodes.map((node: any) => {
      if (!node) return node;
      if (N8nClient.PASS_THROUGH_TYPES.has(node.type)) return node;
      // LangChain sub-nodes (@n8n/ namespace) communicate via supplyData(), not main outputs.
      // Replacing them with Code nodes breaks the supplyData protocol — skip shimming.
      if (node.type?.startsWith('@n8n/')) return node;
      const hasCredentials = node.credentials && Object.keys(node.credentials).length > 0;
      const isHttpRequest = node.type === 'n8n-nodes-base.httpRequest';
      if (!hasCredentials && !isHttpRequest) return node;
      return {
        id: node.id,
        name: node.name,
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: node.position,
        parameters: {
          mode: 'runOnceForAllItems',
          jsCode: N8nClient.buildNetworkShimCode(node.type),
        },
        ...(node.onError ? { onError: node.onError } : {}),
      };
    });
  }

  /** Generate the JS body for a Code shim that stands in for an external-calling node. */
  static buildNetworkShimCode(nodeType: string): string {
    const t = nodeType.toLowerCase();
    if (t.includes('httprequest')) {
      return `// [n8m:shim] HTTP Request — no external call made during testing\nreturn [{ json: { status: 200, statusText: 'OK', body: '{"ok":true,"shimmed":true}', headers: { 'content-type': 'application/json' } } }];`;
    }
    if (t.includes('openai') || t.includes('anthropic') || t.includes('gemini') || t.includes('lmchat') || t.includes('languagemodel')) {
      return `// [n8m:shim] AI node — no external call made during testing\nreturn [{ json: { message: { role: 'assistant', content: '[test shim: AI response]' }, finish_reason: 'stop', usage: { total_tokens: 0 } } }];`;
    }
    if (t.includes('slack')) {
      return `// [n8m:shim] Slack — no external call made during testing\nreturn [{ json: { ok: true, ts: '1000000000.000001', channel: 'C00000000', message: { text: '[test shim]' } } }];`;
    }
    if (t.includes('gmail') || t.includes('emailsend') || t.includes('sendemail') || t.includes('imap')) {
      return `// [n8m:shim] Email — no external call made during testing\nreturn [{ json: { id: 'shim-msg-id', threadId: 'shim-thread-id', labelIds: ['SENT'] } }];`;
    }
    if (t.includes('googledrive') || t.includes('googlesheets') || t.includes('googledocs')) {
      return `// [n8m:shim] Google service — no external call made during testing\nreturn [{ json: { kind: 'drive#file', id: 'shim-id', name: 'shim', mimeType: 'application/json' } }];`;
    }
    if (t.includes('github') || t.includes('gitlab')) {
      return `// [n8m:shim] Git service — no external call made during testing\nreturn [{ json: { id: 1, number: 1, title: '[test shim]', state: 'open', html_url: 'https://example.com' } }];`;
    }
    if (t.includes('telegram') || t.includes('discord') || t.includes('teams') || t.includes('mattermost')) {
      return `// [n8m:shim] Messaging service — no external call made during testing\nreturn [{ json: { ok: true, result: { message_id: 1, text: '[test shim]' } } }];`;
    }
    if (t.includes('airtable') || t.includes('notion') || t.includes('jira') || t.includes('asana') || t.includes('trello')) {
      return `// [n8m:shim] Project management service — no external call made during testing\nreturn [{ json: { id: 'shim-id', name: '[test shim]', status: 'ok' } }];`;
    }
    // Default: generic success response for any other credentialed service node
    return `// [n8m:shim] External service — no external call made during testing\nreturn [{ json: { ok: true, shimmed: true, id: 'shim-id', result: '[test shim]' } }];`;
  }
}
