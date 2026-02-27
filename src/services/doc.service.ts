import { AIService } from "./ai.service.js";

/**
 * Service for generating workflow documentation and diagrams.
 */
export class DocService {
  private static instance: DocService;
  private aiService: AIService;

  private constructor() {
    this.aiService = AIService.getInstance();
  }

  static getInstance(): DocService {
    if (!DocService.instance) {
      DocService.instance = new DocService();
    }
    return DocService.instance;
  }

  /**
   * Generates a Mermaid.js flowchart diagram from an n8n workflow JSON.
   */
  generateMermaid(workflowJson: any): string {
    const nodes = workflowJson.nodes || [];
    const connections = workflowJson.connections || {};

    let mermaid = "graph TD\n";

    // 1. Define Nodes
    nodes.forEach((node: any) => {
      // Escape node names for Mermaid
      const safeName = node.name.replace(/"/g, "'");
      // Use different shapes/styles based on node type if desired
      // Simple box for now: nodeName["Display Text"]
      mermaid += `  ${this.toID(node.name)}["${safeName}"]\n`;
    });

    // 2. Define Connections
    for (const [sourceName, sourceConns] of Object.entries(connections)) {
      if (sourceConns && (sourceConns as any).main) {
        (sourceConns as any).main.forEach((targets: any[]) => {
          targets.forEach((target) => {
             mermaid += `  ${this.toID(sourceName)} --> ${this.toID(target.node)}\n`;
          });
        });
      }
    }

    return mermaid;
  }

  /**
   * Generates an AI-driven README/Summary for the workflow.
   */
  async generateReadme(workflowJson: any): Promise<string> {
    const prompt = `You are a technical writer for n8n.
    Generate a concise, professional README for the following n8n workflow.
    
    Workflow JSON:
    ${JSON.stringify(workflowJson, null, 2)}
    
    The README should include:
    1. A clear Title.
    2. A brief 1-2 sentence Summary of what the workflow does.
    3. A "Nodes Used" section listing the key nodes.
    4. An "Execution Flow" section explaining the logic.
    
    Output in Markdown format.
    `;

    return await this.aiService.generateContent(prompt) || "Failed to generate documentation.";
  }

  /**
   * Generates a folder-safe slug from a name.
   */
  generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Uses AI to suggest a concise, professional project title for the workflow.
   */
  async generateProjectTitle(workflowJson: any): Promise<string> {
    const prompt = `Based on the following n8n workflow JSON, suggest a concise, professional project title (3-5 words).
    
    Workflow JSON Snippet:
    ${JSON.stringify({
      name: workflowJson.name,
      nodes: (workflowJson.nodes || []).map((n: any) => ({ name: n.name, type: n.type }))
    }, null, 2)}
    
    Output ONLY the title string. No quotes. No commentary.`;

    const title = await this.aiService.generateContent(prompt);
    return title?.trim() || workflowJson.name || 'Untitled Workflow';
  }

  private toID(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, "_");
  }
}
