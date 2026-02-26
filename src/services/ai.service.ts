import OpenAI from 'openai';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

export interface GenerateOptions {
  model?: string;
  temperature?: number;
}

// Base URLs and default models for known providers
const PROVIDER_PRESETS: Record<string, { baseURL?: string; defaultModel: string }> = {
  openai: {
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.5-flash',
  },
};

export class AIService {
  private static instance: AIService;
  private client: OpenAI;
  private model: string;

  private constructor() {
    // Load persisted config from ~/.n8m/config.json as fallback for env vars
    let fileConfig: Record<string, string> = {};
    try {
      const configFile = path.join(os.homedir(), '.n8m', 'config.json');
      fileConfig = JSON.parse(fsSync.readFileSync(configFile, 'utf-8'));
    } catch {
      // Config file doesn't exist yet — that's fine
    }

    let apiKey = process.env.AI_API_KEY || fileConfig['aiKey'];
    let baseURL = process.env.AI_BASE_URL || fileConfig['aiBaseUrl'];
    let provider = (process.env.AI_PROVIDER || fileConfig['aiProvider'])?.toLowerCase();

    // Backward compat: GEMINI_API_KEY still works
    if (!apiKey && process.env.GEMINI_API_KEY) {
      apiKey = process.env.GEMINI_API_KEY;
      if (!provider) provider = 'gemini';
    }

    if (!apiKey) {
      console.warn('⚠️  No AI key found. Run: n8m config --ai-key <your-key> --ai-provider openai');
    }

    const preset = provider ? PROVIDER_PRESETS[provider] : undefined;

    // Apply preset base URL unless the user explicitly set one
    if (preset?.baseURL && !baseURL) {
      baseURL = preset.baseURL;
    }

    this.model = process.env.AI_MODEL || fileConfig['aiModel'] || preset?.defaultModel || 'gpt-4o';

    this.client = new OpenAI({
      apiKey: apiKey || 'no-key',
      ...(baseURL ? { baseURL } : {}),
      defaultHeaders: provider === 'anthropic'
        ? { 'anthropic-version': '2023-06-01' }
        : undefined,
    });
  }

  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  /**
   * Core generation method — works with any OpenAI-compatible API
   */
  async generateContent(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const model = options.model || this.model;
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (process.stdout.isTTY) {
          process.stdout.write('   (AI Thinking...)\n');
        }

        const stream = await this.client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? 0.7,
          stream: true,
        });

        let text = '';
        for await (const chunk of stream) {
          text += chunk.choices[0]?.delta?.content || '';
        }

        return text;

      } catch (error: any) {
        if (process.stdout.isTTY) process.stdout.write('\n');
        lastError = error;

        const isRetryable =
          error.status === 503 ||
          error.status === 529 ||
          (error.message && (
            error.message.includes('fetch failed') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('timeout')
          ));

        if (attempt < maxRetries && isRetryable) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`[AIService] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        break;
      }
    }

    throw lastError;
  }

  /**
   * Generate an n8n workflow from a description
   */
  async generateWorkflow(description: string) {
    const systemPrompt = `You are an expert n8n workflow architect.
    Your task is to generate a valid n8n workflow JSON based on the user's description.

    Output ONLY valid JSON. No markdown formatting, no explanations.
    The JSON must follow the n8n workflow schema with 'nodes' and 'connections' arrays.

    User Description: ${description}`;

    const response = await this.generateContent(systemPrompt);

    let cleanJson = response || '{}';
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, '').trim();

    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error('Failed to parse generated workflow JSON', e);
      throw new Error('AI generated invalid JSON');
    }
  }

  /**
   * Generate a Workflow Specification from a description
   */
  async generateSpec(description: string) {
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

    const response = await this.generateContent(prompt);
    let cleanJson = response || '{}';
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, '').trim();

    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error('Failed to parse generated spec JSON', e);
      throw new Error('AI generated invalid JSON for spec');
    }
  }

  /**
   * Refine a Specification based on user feedback
   */
  async refineSpec(spec: any, feedback: string) {
    const prompt = `You are an n8n Solutions Architect.
    Update the following Workflow Specification based on the user's feedback/answers.

    Current Specification:
    ${JSON.stringify(spec, null, 2)}

    User Feedback:
    ${feedback}

    Ensure 'questions' is empty if the feedback resolves the ambiguity.
    Output the UPDATED JSON Specification only.`;

    const response = await this.generateContent(prompt);
    let cleanJson = response || '{}';
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, '').trim();

    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error('Failed to parse refined spec JSON', e);
      throw new Error('AI generated invalid JSON for refined spec');
    }
  }

  /**
   * Generate workflow JSONs from an approved Specification
   */
  async generateWorkflowFromSpec(spec: any) {
    const prompt = `You are an n8n Workflow Engineer.
      Generate the valid n8n workflow JSON(s) based on the following approved Specification.

      Specification:
      ${JSON.stringify(spec, null, 2)}

      IMPORTANT:
      1. Descriptive Naming: Name nodes descriptively (e.g. "Fetch Bitcoin Price" instead of "HTTP Request").
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
             { "name": "Workflow Name", "nodes": [...], "connections": {...} }
         ]
      }

      Output ONLY valid JSON. No commentary. No markdown.
      `;

    const response = await this.generateContent(prompt);
    let cleanJson = response || '{}';
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, '').trim();

    try {
      const result = JSON.parse(cleanJson);
      if (result.workflows && Array.isArray(result.workflows)) {
        result.workflows = result.workflows.map((wf: any) => this.fixHallucinatedNodes(wf));
      }
      return result;
    } catch (e) {
      console.error('Failed to parse workflow JSON from spec', e);
      throw new Error('AI generated invalid JSON for workflow from spec');
    }
  }

  /**
   * Generate mock data for a workflow execution
   */
  async generateMockData(context: string, previousFailures: string[] = []): Promise<any> {
    let failureContext = '';
    if (previousFailures.length > 0) {
      failureContext = `\n\nIMPORTANT: The following attempts FAILED. Do NOT repeat these patterns.\nErrors:\n${previousFailures.join('\n')}`;
    }

    const systemPrompt = `You are a QA Data Generator.
    Your task is to generate a realistic JSON payload to trigger an n8n workflow.

    CRITICAL: Output ONLY valid raw JSON. No markdown, no explanations, no "Okay" or "Here is".
    If you include any text outside the JSON, the system will crash.

    Context: ${context}${failureContext}`;

    const response = await this.generateContent(systemPrompt);

    let cleanJson = response || '{}';
    cleanJson = cleanJson.replace(/```json\n?|\n?```/g, '').trim();

    try {
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error('Failed to parse generated mock data', e);
      return { message: 'AI generation failed, fallback data' };
    }
  }

  /**
   * Diagnostic Repair: Fix a workflow based on execution error
   */
  async generateWorkflowFix(workflowJson: any, errorContext: string, model?: string, _useSearch: boolean = false, validNodeTypes: string[] = []): Promise<any> {
    const prompt = `You are a Senior n8n Workflow Engineer.
      A workflow failed during execution. Your task is to analyze the JSON and the Error, and provide a FIXED version of the workflow JSON.

      Error Context:
      ${errorContext}

      Workflow JSON:
      ${JSON.stringify(workflowJson, null, 2)}

      Review the nodes involved in the error.
      ${validNodeTypes.length > 0 ? `CRITICAL: You MUST only use node types from the following ALLOWED list: ${JSON.stringify(validNodeTypes.slice(0, 100))}... (and other standard n8n-nodes-base.* types). If a node type is not valid, replace it with 'n8n-nodes-base.httpRequest' or 'n8n-nodes-base.set'.` : ''}
      IMPORTANT: If the error is "Unrecognized node type: n8n-nodes-base.schedule", you MUST fix it to "n8n-nodes-base.scheduleTrigger".
      If a node produced 0 items, check its input data mapping or filter conditions.
      If a node crashed, check missing parameters.

      Output ONLY valid JSON. No markdown. RETURN THE ENTIRE FIXED WORKFLOW JSON.
      `;

    const response = await this.generateContent(prompt, { model });

    try {
      let cleanJson = response || '{}';
      cleanJson = cleanJson.replace(/```json\n?|\n?```/g, '').trim();
      const fixed = JSON.parse(cleanJson);

      const invalidNodeMatch = errorContext.match(/Unrecognized node type: ([\w.-]+)/);
      const explicitlyInvalid = invalidNodeMatch ? [invalidNodeMatch[1]] : [];

      const corrected = this.fixHallucinatedNodes(fixed);
      return this.validateAndShim(corrected, validNodeTypes, explicitlyInvalid);
    } catch (e) {
      console.error('Failed to parse AI workflow fix', e);
      throw new Error('AI generated invalid JSON for fix');
    }
  }

  /**
   * Auto-correct common n8n node type hallucinations
   */
  private fixHallucinatedNodes(workflow: any): any {
    if (!workflow.nodes || !Array.isArray(workflow.nodes)) return workflow;

    const corrections: Record<string, string> = {
      'n8n-nodes-base.rssFeed': 'n8n-nodes-base.rssFeedRead',
      'rssFeed': 'n8n-nodes-base.rssFeedRead',
      'n8n-nodes-base.gpt': 'n8n-nodes-base.openAi',
      'n8n-nodes-base.openai': 'n8n-nodes-base.openAi',
      'openai': 'n8n-nodes-base.openAi',
      'n8n-nodes-base.openAiChat': 'n8n-nodes-base.openAi',
      'n8n-nodes-base.openAIChat': 'n8n-nodes-base.openAi',
      'n8n-nodes-base.openaiChat': 'n8n-nodes-base.openAi',
      'n8n-nodes-base.gemini': 'n8n-nodes-base.googleGemini',
      'n8n-nodes-base.cheerioHtml': 'n8n-nodes-base.htmlExtract',
      'cheerioHtml': 'n8n-nodes-base.htmlExtract',
      'n8n-nodes-base.schedule': 'n8n-nodes-base.scheduleTrigger',
      'schedule': 'n8n-nodes-base.scheduleTrigger',
      'n8n-nodes-base.cron': 'n8n-nodes-base.scheduleTrigger',
      'n8n-nodes-base.googleCustomSearch': 'n8n-nodes-base.googleGemini',
      'googleCustomSearch': 'n8n-nodes-base.googleGemini',
    };

    workflow.nodes = workflow.nodes.map((node: any) => {
      if (node.type && corrections[node.type]) {
        console.log(`[AI Fix] Correcting node type: ${node.type} -> ${corrections[node.type]}`);
        node.type = corrections[node.type];
      }
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

    for (const [sourceNode, targets] of Object.entries(workflow.connections)) {
      if (!targets || typeof targets !== 'object') continue;
      const targetObj = targets as any;

      if (targetObj.main) {
        let mainArr = targetObj.main;
        if (!Array.isArray(mainArr)) mainArr = [[{ node: String(mainArr), type: 'main', index: 0 }]];

        const fixedMain = mainArr.map((segment: any) => {
          if (!segment) return [];
          if (!Array.isArray(segment)) return [segment];
          return segment.map((conn: any) => {
            if (!conn) return { node: 'Unknown', type: 'main', index: 0 };
            if (typeof conn === 'string') return { node: conn, type: 'main', index: 0 };
            return {
              node: String(conn.node || 'Unknown'),
              type: conn.type || 'main',
              index: conn.index || 0,
            };
          });
        });

        fixedConnections[sourceNode] = { main: fixedMain };
      } else {
        fixedConnections[sourceNode] = targetObj;
      }
    }

    workflow.connections = fixedConnections;
    return workflow;
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

    const isTrigger = (name: string) => name.toLowerCase().includes('trigger') || name.toLowerCase().includes('webhook');

    workflow.nodes = workflow.nodes.map((node: any) => {
      if (!node || !node.type) return node;
      const type = node.type.toLowerCase();

      const shouldShim = invalidSet.has(type) || (validSet.size > 0 && !validSet.has(type));
      if (!shouldShim) return node;

      console.warn(`[Validation] Unknown/Invalid node type detected: ${node.type}. Shimming...`);

      const originalType = node.type;
      const notes = `[Shim] Original Type: ${originalType}. Replaced because type is not installed on this n8n instance.`;

      const apiKeywords = [
        'api', 'http', 'slack', 'discord', 'telegram', 'google', 'aws',
        'github', 'stripe', 'twilio', 'linear', 'notion', 'airtable',
        'alpaca', 'openai', 'hubspot', 'mailchimp', 'postgres', 'mysql',
        'redis', 'mongo', 'firebase', 'supabase',
      ];

      const isApi = apiKeywords.some(keyword => originalType.includes(keyword));

      let replacementType = 'n8n-nodes-base.set';
      if (isTrigger(originalType)) {
        replacementType = 'n8n-nodes-base.webhook';
      } else if (isApi) {
        replacementType = 'n8n-nodes-base.httpRequest';
      }

      return {
        ...node,
        type: replacementType,
        typeVersion: 1,
        notes,
        credentials: {},
        parameters: { options: {} },
      };
    });

    return workflow;
  }
}
