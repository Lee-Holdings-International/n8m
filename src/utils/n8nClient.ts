import chalk from 'chalk'

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

    // Constructor validation moved to method call time to allow lazy loading
    // from config file if not provided here. 
    this.headers = {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': this.apiKey,
    }
  }

  /**
   * Activate a workflow
   */
  async activateWorkflow(workflowId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/workflows/${workflowId}/activate`, {
      headers: this.headers,
      method: 'POST',
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to activate workflow: ${response.status} - ${errorText}`)
    }
  }

  /**
   * Deactivate a workflow
   */
  async deactivateWorkflow(workflowId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/workflows/${workflowId}/deactivate`, {
      headers: this.headers,
      method: 'POST',
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to deactivate workflow: ${response.status} - ${errorText}`)
    }
  }

  /**
   * Execute a workflow and return the result
   */
  async executeWorkflow(workflowId: string, data?: unknown): Promise<WorkflowExecutionResult> {
    try {
      // NOTE: Public API does not always expose a direct 'execute' endpoint for all workflow types.
      // For validation purposes, we 'activate' the workflow which runs internal validation.
      const response = await fetch(`${this.apiUrl}/workflows/${workflowId}/activate`, {
        headers: this.headers,
        method: 'POST',
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`n8n Validation Error: ${response.status} - ${errorText}`)
      }

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

      if (!response.ok) {
        throw new Error(`Failed to get execution: ${response.status}`)
      }

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

      if (!response.ok) {
        throw new Error(`Failed to get executions: ${response.status}`)
      }

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
      const response = await fetch(`${this.apiUrl}/workflows/${workflowId}`, {
        body: JSON.stringify(workflowData),
        headers: this.headers,
        method: 'PUT',
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to update workflow: ${response.status} - ${errorText}`)
      }
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

      if (!response.ok) {
        throw new Error(`Failed to get workflow: ${response.status}`)
      }

      return response.json()
    } catch (error) {
      throw new Error(`Failed to fetch workflow: ${(error as Error).message}`)
    }
  }

  /**
   * Create a new workflow
   */
  async createWorkflow(name: string, workflowData: unknown): Promise<{id: string}> {
    try {
      const payload = {
        name,
        ...(workflowData as Record<string, unknown>),
      }
      
      // Debug logging for payload validation errors
      // console.log('DEBUG: createWorkflow payload keys:', Object.keys(payload));

      const response = await fetch(`${this.apiUrl}/workflows`, {
        body: JSON.stringify(payload),
        headers: this.headers,
        method: 'POST',
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create workflow: ${response.status} - ${errorText}`)
      }

      const result = await response.json()
      return {id: result.id}
    } catch (error) {
      throw new Error(`Failed to create workflow: ${(error as Error).message}`)
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

          if (!response.ok) {
            throw new Error(`Failed to get workflows: ${response.status}`)
          }

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

      if (!response.ok) {
        throw new Error(`Failed to delete workflow: ${response.status}`)
      }
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
      const webhookPath = "n8m-shim-" + Math.random().toString(36).substring(7);
      
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
          webhookId: webhookPath
      };

      // Flattener Node (Code)
      // Hoists 'body' and 'query' to root so downstream nodes see expected schema
      const flattenerId = "shim-flattener-" + Math.random().toString(36).substring(7);
      const flattenerNode = {
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
