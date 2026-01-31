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
}
