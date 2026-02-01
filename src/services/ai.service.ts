import { GoogleGenAI } from "@google/genai";

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  useSearch?: boolean;
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
  /**
   * Generate content using Gemini
   */
  async generateContent(prompt: string, options: GenerateOptions = {}) {
    try {
      const modelName = options.model || "gemini-3-flash-preview"; 
      
      const config: any = {
        model: modelName,
        contents: prompt,
        config: {
          temperature: options.temperature ?? 0.7,
        }
      };

      if (options.useSearch) {
        config.tools = [{ googleSearch: {} }];
        // Add a small delay to "wait for results" as requested by user
        // and to let the grounded search actually happen.
        console.log("   🔍 Grounding search in progress... (Waiting for results)");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      const response = await this.client.models.generateContent(config);

      return response.text ?? "";
    } catch (error) {
      console.error("Gemini generation failed:", error);
      throw error;
    }
  }

  /**
   * Generate an n8n workflow from a description
   */
  async generateWorkflow(description: string, model: string = "gemini-3-flash-preview") {
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

// ... existing code ...

  /**
   * Generate a Workflow Specification from a description (Spec-Kit style)
   */
  async generateSpec(description: string, model: string = "gemini-3-flash-preview") {
    const prompt = `You are an n8n Solutions Architect. 
    Convert the following user request into a structured Workflow Specification.
    
    The Specification should be a JSON object with:
    1. goal: A clear statement of the objective.
    2. suggestedName: A concise, descriptive name for the main workflow (e.g., "Hourly Bitcoin Price Alert").
    3. tasks: A list of strings, each describing a logical step to achieve the goal.
    4. nodes: Potential n8n nodes involved (e.g. ['Webhook', 'HTTP Request', 'Slack']).
    5. assumptions: Any assumptions made about credentials or environment.
    6. questions: A list of string questions if the request is ambiguous or missing critical details. Empty if clear.

    Output ONLY valid JSON.
    
    User Request: ${description}`;

    const response = await this.generateContent(prompt, { model });
    let cleanJson = response || "{}";
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error("Failed to parse generated spec JSON", e);
      throw new Error("AI generated invalid JSON for spec");
    }
  }

  /**
   * Refine a Specification based on user feedback
   */
  async refineSpec(spec: any, feedback: string, model: string = "gemini-3-flash-preview") {
    const prompt = `You are an n8n Solutions Architect.
    Update the following Workflow Specification based on the user's feedback/answers.
    
    Current Specification:
    ${JSON.stringify(spec, null, 2)}
    
    User Feedback:
    ${feedback}
    
    Ensure 'questions' is empty if the feedback resolves the ambiguity.
    Output the UPDATED JSON Specification only.`;
    
    const response = await this.generateContent(prompt, { model });
    let cleanJson = response || "{}";
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error("Failed to parse refined spec JSON", e);
      throw new Error("AI generated invalid JSON for refined spec");
    }
  }

  /**
   * Generate workflow JSON from an approved Specification
   */
   /**
    * Generate workflow JSONs from an approved Specification
    * Supports generating multiple linked workflows.
    */
   async generateWorkflowFromSpec(spec: any, model: string = "gemini-3-flash-preview") {
      const prompt = `You are an n8n Workflow Engineer.
      Generate the valid n8n workflow JSON(s) based on the following approved Specification.
      
      Specification:
      ${JSON.stringify(spec, null, 2)}
      
      IMPORTANT:
      1. Desciptive Naming: Name nodes descriptively (e.g. "Fetch Bitcoin Price" instead of "HTTP Request").
      2. Multi-Workflow: If the spec requires multiple workflows (e.g. Main + Sub-workflow), generate them all.
      3. Linking: If one workflow calls another (using an 'Execute Workflow' node), use the "suggestedName" of the target workflow as the 'workflowId' parameter value. Do NOT use generic IDs like "SUBWORKFLOW_ID".
      4. Consistency: Ensure the "name" field in each workflow matches one of the suggestedNames from the spec.
      5. Standard Node Types: Use valid n8n-nodes-base types. 
         - Use "n8n-nodes-base.rssFeedRead" for RSS reading (NOT "rssFeed").
         - Use "n8n-nodes-base.httpRequest" for API calls.
         - Use "n8n-nodes-base.openai" for OpenAI.
         - Use "n8n-nodes-base.googleGemini" for Google Gemini.
         - Use "n8n-nodes-base.htmlExtract" for HTML/Cheerio extraction.

      Output a JSON object with this structure:
      {
         "workflows": [
             { "name": "Gemini-Suggested Name", "nodes": [...], "connections": {...} }
         ]
      }
      
      Output ONLY valid JSON.`;
      
      const response = await this.generateContent(prompt, { model });
      let cleanJson = response || "{}";
      cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();
      
      try {
        const result = JSON.parse(cleanJson);
        if (result.workflows && Array.isArray(result.workflows)) {
            result.workflows = result.workflows.map((wf: any) => this.fixHallucinatedNodes(wf));
        }
        return result;
      } catch (e) {
        console.error("Failed to parse workflow JSON from spec", e);
        throw new Error("AI generated invalid JSON for workflow from spec");
      }
   }

   /**
    * Auto-correct common n8n node type hallucinations
    */
   private fixHallucinatedNodes(workflow: any): any {
       if (!workflow.nodes || !Array.isArray(workflow.nodes)) return workflow;
       
       const corrections: Record<string, string> = {
           "n8n-nodes-base.rssFeed": "n8n-nodes-base.rssFeedRead",
           "rssFeed": "n8n-nodes-base.rssFeedRead",
           "n8n-nodes-base.gpt": "n8n-nodes-base.openAi",
           "n8n-nodes-base.openAiChat": "n8n-nodes-base.openAi",
           "n8n-nodes-base.openAIChat": "n8n-nodes-base.openAi",
           "n8n-nodes-base.openaiChat": "n8n-nodes-base.openAi",
           "n8n-nodes-base.gemini": "n8n-nodes-base.googleGemini",
           "n8n-nodes-base.cheerioHtml": "n8n-nodes-base.htmlExtract",
           "cheerioHtml": "n8n-nodes-base.htmlExtract",
           "n8n-nodes-base.schedule": "n8n-nodes-base.scheduleTrigger",
           "schedule": "n8n-nodes-base.scheduleTrigger",
           "n8n-nodes-base.cron": "n8n-nodes-base.scheduleTrigger"
       };

       workflow.nodes = workflow.nodes.map((node: any) => {
           if (node.type && corrections[node.type]) {
               console.log(`[AI Fix] Correcting node type: ${node.type} -> ${corrections[node.type]}`);
               node.type = corrections[node.type];
           }
           // Ensure base prefix if missing
           if (node.type && !node.type.startsWith('n8n-nodes-base.') && !node.type.includes('.')) {
                node.type = `n8n-nodes-base.${node.type}`;
           }
           return node;
       });

       return workflow;
   }
  /**
   * Generate mock data for a workflow execution
   */
  async generateMockData(context: string, model: string = "gemini-3-flash-preview", previousFailures: string[] = []): Promise<any> {
    let failureContext = "";
    if (previousFailures.length > 0) {
        failureContext = `\n\nIMPORTANT: The following attempts FAILED. Do NOT repeat these patterns.\nErrors:\n${previousFailures.join('\n')}`;
    }

    const systemPrompt = `You are a QA Data Generator.
    Your task is to generate a realistic JSON payload to trigger an n8n workflow.
    
    CRITICAL: Output ONLY valid raw JSON. No markdown, no explanations, no "Okay" or "Here is". 
    If you include any text outside the JSON, the system will crash.
    
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
  async generateWorkflowFix(workflowJson: any, errorContext: string, model: string = "gemini-3-flash-preview", useSearch: boolean = false): Promise<any> {
      const prompt = `You are a Senior n8n Workflow Engineer.
      A workflow failed during execution. Your task is to analyze the JSON and the Error, and provide a FIXED version of the workflow JSON.

      Error Context:
      ${errorContext}

      Workflow JSON:
      ${JSON.stringify(workflowJson, null, 2)}

      Review the nodes involved in the error. 
      ${useSearch ? 'CRITICAL: You MUST use Google Search to verify the EXACT n8n node type name (e.g. check if it is "n8n-nodes-base.openAi" vs "n8n-nodes-base.openAiChat"). Do NOT guess. Search for "n8n [NodeName] node type name" to be sure.' : ''}
      IMPORTANT: If the error is "Unrecognized node type: n8n-nodes-base.schedule", you MUST fix it to "n8n-nodes-base.scheduleTrigger".
      If a node produced 0 items, check its input data mapping or filter conditions.
      If a node crashed, check missing parameters.

      Output ONLY valid JSON. No markdown. RETURN THE ENTIRE FIXED WORKFLOW JSON.
      `;

      const response = await this.generateContent(prompt, { model, useSearch });
      
      try {
        let cleanJson = response || "{}";
        cleanJson = cleanJson.replace(/```json\n?|\n?```/g, "").trim();
        const fixed = JSON.parse(cleanJson);
        return this.fixHallucinatedNodes(fixed);
      } catch (e) {
         console.error("Failed to parse AI workflow fix", e);
         throw new Error("AI generated invalid JSON for fix");
      }
  }

}
