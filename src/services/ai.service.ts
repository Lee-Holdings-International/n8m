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

    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let timer: NodeJS.Timeout | null = null;
      let streamedText = "";
      
      try {
        const timeoutDuration = 120000; // 120s
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeoutDuration / 1000}s`)), timeoutDuration));
        
        // Visual Feedback: Start Thinking
        if (process.stdout.isTTY) {
           process.stdout.write(`   (AI Thinking...)\n`); // Newline to start streaming below
        }

        // Use streaming for visibility
        const streamResult = await Promise.race([
            this.client.models.generateContentStream(config),
            timeoutPromise
        ]) as any;

        if (!streamResult) throw new Error("No response from generateContentStream");
        
        // Handle SDK variations (some return { stream: ... }, some return the iterable directly)
        const stream = streamResult.stream || streamResult;

        if (!stream[Symbol.asyncIterator]) {
            // If not iterable, maybe it returned a normal response context?
            console.warn("[AIService] response is not an async iterable, checking text...");
            if (typeof streamResult.text === 'function') return streamResult.text();
            if (streamResult.text) return streamResult.text;
             throw new Error("Response is not a valid stream");
        }

        // Iterate the stream
        for await (const chunk of stream) {
            let chunkText = "";
            if (typeof chunk === 'string') {
                chunkText = chunk;
            } else if (typeof chunk.text === 'function') {
                chunkText = chunk.text();
            } else if (chunk.text) {
                chunkText = chunk.text;
            }
            
            streamedText += chunkText;
        }
        
        return streamedText;

      } catch (error: any) {
        if (process.stdout.isTTY) process.stdout.write("\n"); // Clear line/newline

        lastError = error;
        const isNetworkError = error.message && (error.message.includes('fetch failed') || error.message.includes('network') || error.cause?.code === 'ECONNRESET');
        const isTimeout = error.message && error.message.includes('Timeout');
        
        if (attempt < maxRetries && (isNetworkError || isTimeout)) {
           const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
           console.warn(`[AIService] Request failed (Attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay/1000}s...`);
           await new Promise(resolve => setTimeout(resolve, delay));
           continue;
        }
        
        // If it's the last attempt or not a retryable error, break and throw
        break;
      }
    }

    // After the retry loop, if we are here, it means all retries failed or it wasn't a network error.
    // Now handle the 503 fallback or re-throw the last error.
    if (lastError.status === 503 && modelName.includes("flash")) {
        console.log("   ⚠ Primary model overloaded. Falling back to gemini-2.5-flash...");
        try {
          config.model = "gemini-2.5-flash";
          // Simple non-streaming fallback for now, or copy streaming logic?
          // Let's keep it simple for fallback to minimize code duplication risk in this edit
          const fallbackResponse = await this.client.models.generateContent(config);
          return fallbackResponse.text ?? "";
        } catch (fallbackError) {
          console.error("Fallback also failed:", fallbackError);
          throw fallbackError;
        }
      }
      console.error("Gemini generation failed:", lastError);
      throw lastError;
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
         - Use "n8n-nodes-base.openAi" for OpenAI.
         - Use "n8n-nodes-base.googleGemini" for Google Gemini.
         - Use "n8n-nodes-base.htmlExtract" for HTML/Cheerio extraction.
      6. Connections Structure: The "connections" object keys MUST BE THE SOURCE NODE NAME. The "node" field inside the connection array MUST BE THE TARGET NODE NAME.
      7. Connection Nesting: Ensure the correct n8n connection structure: "SourceNodeName": { "main": [ [ { "node": "TargetNodeName", "type": "main", "index": 0 } ] ] }.

      Output a JSON object with this structure:
      {
         "workflows": [
             { "name": "Gemini-Suggested Name", "nodes": [...], "connections": {...} }
         ]
      }
      
      Output ONLY valid JSON. No commentary. No markdown.
      `;
      
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
           "n8n-nodes-base.openai": "n8n-nodes-base.openAi",
           "openai": "n8n-nodes-base.openAi",
           "n8n-nodes-base.openAiChat": "n8n-nodes-base.openAi",
           "n8n-nodes-base.openAIChat": "n8n-nodes-base.openAi",
           "n8n-nodes-base.openaiChat": "n8n-nodes-base.openAi",
           "n8n-nodes-base.gemini": "n8n-nodes-base.googleGemini",
           "n8n-nodes-base.cheerioHtml": "n8n-nodes-base.htmlExtract",
           "cheerioHtml": "n8n-nodes-base.htmlExtract",
           "n8n-nodes-base.schedule": "n8n-nodes-base.scheduleTrigger",
           "schedule": "n8n-nodes-base.scheduleTrigger",
           "n8n-nodes-base.cron": "n8n-nodes-base.scheduleTrigger",
           "n8n-nodes-base.googleCustomSearch": "n8n-nodes-base.googleGemini", // Fallback to Gemini if Custom Search is missing
           "googleCustomSearch": "n8n-nodes-base.googleGemini"
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

       return this.fixN8nConnections(workflow);
   }

   /**
    * Force-fix connection structure to prevent "object is not iterable" errors
    */
   private fixN8nConnections(workflow: any): any {
       if (!workflow.connections || typeof workflow.connections !== 'object') return workflow;
       
       const fixedConnections: any = {};
       const nodes = workflow.nodes || [];
       const nodeNames = new Set(nodes.map((n: any) => n.name));

       for (let [sourceNode, targets] of Object.entries(workflow.connections)) {
           // 1. Ensure keys are strings
           sourceNode = String(sourceNode);
           
           if (!targets || typeof targets !== 'object') continue;
           const targetObj = targets as any;

           // 2. Ensure "main" exists and is an array
           if (targetObj.main) {
               let mainArr = targetObj.main;
               if (!Array.isArray(mainArr)) mainArr = [[ { node: String(mainArr), type: 'main', index: 0 } ]];
               
               const fixedMain = mainArr.map((segment: any) => {
                if (!segment) return [];
                if (!Array.isArray(segment)) {
                    // Wrap in array if it's a single object
                    return [segment];
                }
                return segment.map((conn: any) => {
                    if (!conn) return { node: 'Unknown', type: 'main', index: 0 };
                    if (typeof conn === 'string') return { node: conn, type: 'main', index: 0 };
                    return {
                        node: String(conn.node || 'Unknown'),
                        type: conn.type || 'main',
                        index: conn.index || 0
                    };
                });
            });
               
               fixedConnections[sourceNode] = { main: fixedMain };
           } else {
               // If it's just raw data like { "Source": { "node": "Target" } }, wrap it
               fixedConnections[sourceNode] = targetObj;
           }
       }
       
       workflow.connections = fixedConnections;
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
  async generateWorkflowFix(workflowJson: any, errorContext: string, model: string = "gemini-3-flash-preview", useSearch: boolean = false, validNodeTypes: string[] = []): Promise<any> {
      const prompt = `You are a Senior n8n Workflow Engineer.
      A workflow failed during execution. Your task is to analyze the JSON and the Error, and provide a FIXED version of the workflow JSON.

      Error Context:
      ${errorContext}

      Workflow JSON:
      ${JSON.stringify(workflowJson, null, 2)}

      Review the nodes involved in the error. 
      ${validNodeTypes.length > 0 ? `CRITICAL: You MUST only use node types from the following ALLOWED list: ${JSON.stringify(validNodeTypes.slice(0, 100))}... (and other standard n8n-nodes-base.* types). If a node type is not valid, replace it with 'n8n-nodes-base.httpRequest' or 'n8n-nodes-base.set'.` : ''}
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
        
        // Extract specifically reported invalid nodes from the error message
        const invalidNodeMatch = errorContext.match(/Unrecognized node type: ([\w\.-]+)/);
        const explictlyInvalid = invalidNodeMatch ? [invalidNodeMatch[1]] : [];
        
        // Apply hallucinations fix first, then strict validation if available OR if we have explicit invalid nodes
        const corrected = this.fixHallucinatedNodes(fixed);
        return this.validateAndShim(corrected, validNodeTypes, explictlyInvalid);
      } catch (e) {
         console.error("Failed to parse AI workflow fix", e);
         throw new Error("AI generated invalid JSON for fix");
      }
  }

  /**
   * Validate against real node types and shim unknown ones
   */
  public validateAndShim(workflow: any, validNodeTypes: string[] = [], explicitlyInvalid: string[] = []): any {
    const valid = validNodeTypes || [];
    const invalid = explicitlyInvalid || [];

    if (valid.length === 0 && invalid.length === 0) return workflow;
    if (!workflow || !workflow.nodes || !Array.isArray(workflow.nodes)) return workflow;

    const validSet = new Set(valid.map(t => t.toLowerCase()));
    const invalidSet = new Set(invalid.map(t => t.toLowerCase()));

    // Simple heuristic to identify trigger nodes and n8n nodes
    const isTrigger = (name: string) => name.toLowerCase().includes('trigger') || name.toLowerCase().includes('webhook');
    
    workflow.nodes = workflow.nodes.map((node: any) => {
        if (!node || !node.type) return node;
        const type = node.type.toLowerCase();
        
        // Shim if:
        // 1. Explicitly marked as invalid (from error message)
        // 2. OR Whitelist exists and node is NOT in it
        const shouldShim = invalidSet.has(type) || (validSet.size > 0 && !validSet.has(type));

        if (!shouldShim) return node;

        console.warn(`[Validation] Unknown/Invalid node type detected: ${node.type}. Shimming...`);
        
        // 1. Preserve critical info in notes
        const originalType = node.type;
        const notes = `[Antigravity Shim] Original Type: ${originalType}. This node was replaced because the type is not installed on this n8n instance.`;

        // 2. Decide replacement
        let replacementType = 'n8n-nodes-base.set'; // Default safe node
        
        // Common API / Service keywords
        const apiKeywords = [
            'api', 'http', 'slack', 'discord', 'telegram', 'google', 'aws', 
            'github', 'stripe', 'twilio', 'linear', 'notion', 'airtable', 
            'alpaca', 'openai', 'hubspot', 'mailchimp', 'postgres', 'mysql',
            'redis', 'mongo', 'firebase', 'supabase'
        ];
        
        const isApi = apiKeywords.some(keyword => originalType.includes(keyword));

        if (isTrigger(originalType)) {
             replacementType = 'n8n-nodes-base.webhook';
        } else if (isApi) {
             replacementType = 'n8n-nodes-base.httpRequest';
        }

        // 3. Construct Shim Node
        return {
            ...node,
            type: replacementType,
            typeVersion: 1,
            notes: notes,
            credentials: {}, // Clear credentials as they wont match
            parameters: {
                // Keep some generic params if possible, or just reset?
                // For safety, we just keep the node structure but change type.
                // But params might cause validation error if they don't match new type.
                // So we reset params but maybe keep 'options'
                options: {}
            }
        };
    });

    return workflow;
  }

}
