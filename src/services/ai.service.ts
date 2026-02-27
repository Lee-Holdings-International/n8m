import { OpenAI } from 'openai';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { jsonrepair } from 'jsonrepair';
import { NodeDefinitionsService } from './node-definitions.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface GenerateOptions {
  model?: string;
  provider?: string;
  temperature?: number;
}

export interface WorkflowSpec {
  suggestedName: string;
  description: string;
  nodes: { type: string; purpose: string; config?: any }[];
  questions?: string[];
  strategyName?: string;
  aiModel?: string;
  aiProvider?: string;
}

export const PROVIDER_PRESETS: Record<string, { baseURL?: string; defaultModel: string; models: string[] }> = {
  openai: {
    defaultModel: 'gpt-4o',
    models: [
      'gpt-5', 'gpt-5-latest', 'gpt-5-pro', 'gpt-5-mini', 'gpt-5-mini-latest', 'gpt-5-nano',
      'gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini'
    ]
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com/v1', 
    defaultModel: 'claude-sonnet-4-6',
    models: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5'
    ]
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-3-flash',
    models: [
      'gemini-3.1-pro', 'gemini-3-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'
    ]
  },
};

export class AIService {
  private static instance: AIService;
  private clients: Map<string, OpenAI> = new Map();
  private defaultProvider: string;
  private defaultModel: string;
  private apiKey: string;
  private baseURL?: string;

  private constructor() {
    let fileConfig: Record<string, string> = {};
    try {
      const configFile = path.join(os.homedir(), '.n8m', 'config.json');
      fileConfig = JSON.parse(fsSync.readFileSync(configFile, 'utf-8'));
    } catch {
      // Config file doesn't exist yet
    }

    this.apiKey = process.env.AI_API_KEY || fileConfig['aiKey'];
    this.baseURL = process.env.AI_BASE_URL || fileConfig['aiBaseUrl'];
    this.defaultProvider = (process.env.AI_PROVIDER || fileConfig['aiProvider'])?.toLowerCase() || 'openai';

    if (!this.apiKey && process.env.GEMINI_API_KEY) {
      this.apiKey = process.env.GEMINI_API_KEY;
      if (!this.defaultProvider) this.defaultProvider = 'gemini';
    }

    if (!presetConfigs[this.defaultProvider]) {
        // Handle unknown provider
    }

    const preset = PROVIDER_PRESETS[this.defaultProvider];
    this.defaultModel = process.env.AI_MODEL || fileConfig['aiModel'] || preset?.defaultModel || 'gpt-4o';
  }

  private getClient(provider: string): OpenAI {
    if (this.clients.has(provider)) {
      return this.clients.get(provider)!;
    }

    const preset = PROVIDER_PRESETS[provider];
    if (provider === 'anthropic') return null as any;

    const baseURL = this.baseURL || preset?.baseURL;
    
    const client = new OpenAI({
      apiKey: this.apiKey || 'no-key',
      ...(baseURL ? { baseURL } : {}),
      defaultHeaders: provider === 'openai' ? undefined : { 'anthropic-version': '2023-06-01' }
    });

    this.clients.set(provider, client);
    return client;
  }

  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  private async callAnthropicNative(prompt: string, model: string, options: GenerateOptions): Promise<string> {
    const preset = PROVIDER_PRESETS['anthropic'];
    const url = `${this.baseURL || preset.baseURL}/messages`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.7,
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API Error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as any;
    return result.content?.[0]?.text || '';
  }

  async generateContent(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const provider = options.provider || this.defaultProvider;
    const model = options.model || (options.provider ? PROVIDER_PRESETS[options.provider]?.defaultModel : this.defaultModel);
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (process.stdout.isTTY) {
          process.stdout.write(`   (AI Thinking: ${model})\n`);
        }

        if (provider === 'anthropic' && !this.baseURL?.includes('openai')) {
          return await this.callAnthropicNative(prompt, model, options);
        }

        const client = this.getClient(provider);
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? 0.7,
        });

        return completion.choices[0]?.message?.content || '';
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError;
  }

  public getAlternativeModel(): string {
    // If user explicitly configured a model in .env/config, respect it for all strategies.
    // Diversification is only useful if we have a pool of models and no strict preference.
    if (process.env.AI_MODEL) {
        return this.defaultModel;
    }

    const preset = PROVIDER_PRESETS[this.defaultProvider];
    if (!preset) return this.defaultModel;

    const currentModelId = this.defaultModel.toLowerCase();
    
    if (this.defaultProvider === 'anthropic') {
      if (currentModelId.includes('sonnet')) return 'claude-haiku-4-5';
      return 'claude-sonnet-4-6';
    }

    const otherModels = preset.models.filter((m: string) => m.toLowerCase() !== currentModelId);
    return otherModels.length > 0 ? otherModels[0] : this.defaultModel;
  }

  public getDefaultModel(): string { return this.defaultModel; }
  public getDefaultProvider(): string { return this.defaultProvider; }

  async generateSpec(goal: string): Promise<WorkflowSpec> {
    const nodeService = NodeDefinitionsService.getInstance();
    const staticRef = nodeService.getStaticReference();

    const prompt = `You are an n8n Solution Architect.
       Create a technical specification for an n8n workflow that fulfills the following goal: "${goal}".
       
       [N8N NODE REFERENCE GUIDE]
       ${staticRef}

       Your output must be a JSON object with this structure:
       {
         "suggestedName": "The recommended name for the workflow",
         "description": "A clear description of what the workflow does",
         "nodes": [
           { "type": "n8n-nodes-base.nodeName", "purpose": "Why this node is used", "config": { ... } }
         ],
         "questions": ["Any clarification questions for the user"]
       }
       
       Use ONLY standard n8n node types (e.g. n8n-nodes-base.httpRequest, n8n-nodes-base.slack).
       Output ONLY the JSON object. No commentary.`;

    const response = await this.generateContent(prompt);
    let cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(jsonrepair(cleanJson));
  }

  async generateAlternativeSpec(goal: string, primarySpec: WorkflowSpec): Promise<WorkflowSpec> {
    const nodeService = NodeDefinitionsService.getInstance();
    const staticRef = nodeService.getStaticReference();

    const prompt = `You are a Senior n8n Engineer. 
       Given the goal: "${goal}" and a primary strategy: ${JSON.stringify(primarySpec)},
       design an ALTERNATIVE strategy (different approach or set of nodes) that achieves the same goal.
       
       [N8N NODE REFERENCE GUIDE]
       ${staticRef}

       Your output must be a JSON object with the same WorkflowSpec structure.
       Output ONLY the JSON object. No commentary.`;

    const response = await this.generateContent(prompt, { model: this.getAlternativeModel() });
    let cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(jsonrepair(cleanJson));
  }

  async generateWorkflowFix(workflow: any, error: string, model?: string, stream: boolean = false, validNodeTypes: string[] = []): Promise<any> {
    const nodeService = NodeDefinitionsService.getInstance();
    const staticRef = nodeService.getStaticReference();

    const prompt = `You are an n8n Expert.
       The following workflow has validation errors:
       ${JSON.stringify(workflow, null, 2)}
       
       Errors: ${error}

       [N8N NODE REFERENCE GUIDE]
       ${staticRef}
       
       ${validNodeTypes.length > 0 ? `Valid available node types: ${validNodeTypes.join(', ')}` : ''}

       Please fix the workflow and return the complete, corrected workflow JSON.
       Ensure all node types and connection structures are valid.
       Output ONLY the JSON object. No commentary.`;

    const response = await this.generateContent(prompt, { model });
    let cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
        const fixed = JSON.parse(jsonrepair(cleanJson));
        return fixed.workflows?.[0] || fixed;
    } catch (e) {
        console.error("Failed to parse fix JSON", e);
        return workflow;
    }
  }

  async generateMockData(context: string): Promise<any> {
      const prompt = `You are a testing expert. Generate mock data for the following context:
      ${context}
      Output ONLY valid JSON payload. No commentary.`;
      
      const response = await this.generateContent(prompt, { temperature: 0.9 });
      let cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
      return JSON.parse(jsonrepair(cleanJson));
  }

  async evaluateCandidates(goal: string, candidates: any[]): Promise<{ selectedIndex: number, reason: string }> {
    if (candidates.length === 0) return { selectedIndex: -1, reason: "No candidates" };
    if (candidates.length === 1) return { selectedIndex: 0, reason: "Single candidate" };

    const candidatesSummary = candidates.map((c, i) => {
        const wf = c.workflows?.[0] || c;
        const nodeTypes = (wf.nodes || []).map((n: any) => n.type);
        return `Candidate ${i}: Nodes: ${nodeTypes.join(', ')}`;
    }).join('\n');

    const prompt = `You are a Workflow Supervisor. Goal: "${goal}"
       Evaluate these alternate n8n workflow candidates:
       ${candidatesSummary}
       
       Select the best one based on robustness and simplicity.
       Return JSON: { "selectedIndex": number, "reason": "string" }
       Output ONLY JSON. No commentary.`;

    const response = await this.generateContent(prompt);
    let cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(jsonrepair(cleanJson));
  }
}

// Dummy for compilation fix
const presetConfigs: any = PROVIDER_PRESETS;
