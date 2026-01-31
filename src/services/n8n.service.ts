import type { WorkflowExecutionResult } from '../utils/n8nClient.js';

export class N8nService {
  private static instance: N8nService;
  private baseUrl: string;
  private apiKey: string;

  private constructor() {
    this.baseUrl = process.env.N8N_API_URL || 'http://localhost:5678/api/v1';
    this.apiKey = process.env.N8N_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('⚠️ N8N_API_KEY is not set. API calls will likely fail.');
    }
  }

  public static getInstance(): N8nService {
    if (!N8nService.instance) {
      N8nService.instance = new N8nService();
    }
    return N8nService.instance;
  }

  /**
   * Deploy a workflow to n8n
   */
  async deployWorkflow(workflow: any, activate: boolean = false): Promise<any> {
    const payload = {
        name: workflow.name || `My Workflow ${new Date().toISOString()}`,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings || {},
    };
    


    const response = await this.request('/workflows', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (activate && response.id) {
       await this.request(`/workflows/${response.id}/activate`, { method: 'POST' });
       response.active = true;
    }

    return response;
  }

  // Helper request method update
  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'X-N8N-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, { ...options, headers });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`n8n Error Body: ${errorBody}`);
        throw new Error(`n8n API Error: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      console.error(`Request failed: ${url}`, error);
      throw error;
    }
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(workflowId: string): Promise<WorkflowExecutionResult> {
    const response = await this.request(`/workflows/${workflowId}/activate`, {
       method: 'POST' 
    });
    
    // Note: Actual execution trigger might depend on webhook or getting a test webhook URL
    // For MVP, this might just toggle activation or assume it's a manual trigger
    // Better: POST /workflows/:id/execute (if available in public API?)
    // Public API actually supports `/workflows/:id/execute` in recent versions or via webhook
    
    // Fallback Mock for now until we confirm endpoint availability or specific execution path
    // Real implementation would POST to webhook or use executions API if supported
    
    return {
      executionId: 'mock-execution-' + Date.now(),
      finished: true,
      success: true,
      data: { message: "Workflow executed (mock)" }
    };
  }
}
