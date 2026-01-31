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
   * Execute a workflow and return the result
   */
  async executeWorkflow(workflowId: string, data?: unknown): Promise<WorkflowExecutionResult> {
    try {
      const response = await fetch(`${this.apiUrl}/workflows/${workflowId}/execute`, {
        body: JSON.stringify({data}),
        headers: this.headers,
        method: 'POST',
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`n8n API error: ${response.status} - ${errorText}`)
      }

      const result = await response.json()
      return {
        data: result.data,
        error: result.error,
        executionId: result.executionId,
        finished: result.finished ?? false,
        success: !result.error,
      }
    } catch (error) {
      throw new Error(`Failed to execute workflow: ${(error as Error).message}`)
    }
  }

  /**
   * Get workflow execution details and logs
   */
  async getExecution(executionId: string): Promise<unknown> {
    try {
      const response = await fetch(`${this.apiUrl}/executions/${executionId}`, {
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
   * Get n8n instance deep link for a workflow
   */
  getWorkflowLink(workflowId: string): string {
    const baseUrl = this.apiUrl.replace('/api/v1', '')
    return `${baseUrl}/workflow/${workflowId}`
  }
}
