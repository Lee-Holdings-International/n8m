import { GoogleGenAI } from "@google/genai";

export interface GenerateOptions {
  model?: string;
  temperature?: number;
}

export class AIService {
  private static instance: AIService;
  private client: GoogleGenAI;
  
  private constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("⚠️ GEMINI_API_KEY not set. AI features will fail.");
    }
    this.client = new GoogleGenAI({ apiKey: apiKey || 'dummy-key-for-migration' });
  }

  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }


  /**
   * List available Gemini models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      const models: string[] = [];
      
      // Async iterator support
      for await (const model of response) {
        if (model.name) {
          models.push(model.name);
        }
      }
      
      return models;
    } catch (error) {
      console.error("Failed to list models:", error);
      throw error;
    }
  }

  /**
   * Generate content using Gemini
   */
  async generateContent(prompt: string, options: GenerateOptions = {}) {
    try {
      const modelName = options.model || "gemini-2.0-flash"; // Default to stable 2.0 flash
      
      const response = await this.client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          temperature: options.temperature ?? 0.7,
        }
      });

      return response.text ?? "";
    } catch (error) {
      console.error("Gemini generation failed:", error);
      throw error;
    }
  }

  /**
   * Generate an n8n workflow from a description
   */
  async generateWorkflow(description: string, model: string = "gemini-2.0-flash") {
    const systemPrompt = `You are an expert n8n workflow architect. 
    Your task is to generate a valid n8n workflow JSON based on the user's description.
    
    Output ONLY valid JSON. No markdown formatting, no explanations.
    The JSON must follow the n8n workflow schema with 'nodes' and 'connections' arrays.
    
    User Description: ${description}`;

    const response = await this.generateContent(systemPrompt, { model });
    
    // Clean up potential markdown code blocks if the model adds them
    let cleanJson = response || "{}";
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error("Failed to parse generated workflow JSON", e);
      throw new Error("AI generated invalid JSON");
    }
  }
  /**
   * Generate mock data for a workflow execution
   */
  async generateMockData(context: string, model: string = "gemini-1.5-pro", previousFailures: string[] = []): Promise<any> {
    let failureContext = "";
    if (previousFailures.length > 0) {
        failureContext = `\n\nIMPORTANT: The following attempts FAILED. Do NOT repeat these patterns.\nErrors:\n${previousFailures.join('\n')}`;
    }

    const systemPrompt = `You are a QA Data Generator.
    Your task is to generate a realistic JSON payload to trigger an n8n workflow.
    
    You will be given the context of the workflow (name, nodes, logical rules).
    You must deduce the required input structure to satisfy conditions (e.g. Switch nodes).
    
    Output ONLY valid JSON.
    
    Context: ${context}${failureContext}`;

    const response = await this.generateContent(systemPrompt, { model });
    
    let cleanJson = response || "{}";
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error("Failed to parse generated mock data", e);
      return { message: "AI generation failed, fallback data" };
    }
    }

  /**
   * Diagnostic Repair: Fix a workflow based on execution error
   */
  async generateWorkflowFix(workflowJson: any, errorContext: string, model: string = "gemini-1.5-pro"): Promise<any> {
      const prompt = `You are a Senior n8n Workflow Engineer.
      A workflow failed during execution. Your task is to analyze the JSON and the Error, and provide a FIXED version of the workflow JSON.

      Error Context:
      ${errorContext}

      Workflow JSON:
      ${JSON.stringify(workflowJson, null, 2)}

      Review the nodes involved in the error. 
      If a node produced 0 items, check its input data mapping or filter conditions.
      If a node crashed, check missing parameters.

      Output ONLY valid JSON. No markdown. RETURN THE ENTIRE FIXED WORKFLOW JSON.
      `;

      const response = await this.generateContent(prompt, { model });
      
      try {
        let cleanJson = response || "{}";
        cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();
        return JSON.parse(cleanJson);
      } catch (e) {
         console.error("Failed to parse AI workflow fix", e);
         throw new Error("AI generated invalid JSON for fix");
      }
  }
}
