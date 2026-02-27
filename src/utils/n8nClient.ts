
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
      url.searchParams.set('limit', '5'); 

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
      const sanitized = this.sanitizeSettings(workflowData as Record<string, unknown>);
      const response = await fetch(`${this.apiUrl}/workflows/${workflowId}`, {
        body: JSON.stringify(sanitized),
        headers: this.headers,
        method: 'PUT',
      })

      await this.assertOk(response, 'update workflow')
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
      const payload = this.sanitizeSettings({
        name,
        ...(workflowData as Record<string, unknown>),
      })
      
      // Debug logging for payload validation errors
      // console.log('DEBUG: createWorkflow payload keys:', Object.keys(payload));

      const response = await fetch(`${this.apiUrl}/workflows`, {
        body: JSON.stringify(payload),
        headers: this.headers,
        method: 'POST',
      })

      await this.assertOk(response, 'create workflow')

      const result = await response.json()
      return {id: result.id}
    } catch (error) {
      throw new Error(`Failed to create workflow: ${(error as Error).message}`)
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
          console.warn(`[N8nClient] node-types request failed (${response.status}) — validation/shimming disabled`);
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

      return allWorkflows;
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
   * Get n8n instance deep link for a workflow
   */
  getWorkflowLink(workflowId: string): string {
    const baseUrl = this.apiUrl.replace('/api/v1', '')
    return `${baseUrl}/workflow/${workflowId}`
  }
}
