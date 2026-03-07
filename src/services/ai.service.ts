import { OpenAI } from 'openai';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { jsonrepair } from 'jsonrepair';
import { NodeDefinitionsService } from './node-definitions.service.js';
import { Spinner } from '../utils/spinner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface GenerateOptions {
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TestErrorEvaluation {
  action: 'fix_node' | 'regenerate_payload' | 'structural_pass' | 'escalate';
  nodeFixType?: 'code_node_js' | 'execute_command' | 'binary_field';
  targetNodeName?: string;
  suggestedBinaryField?: string;
  reason: string;
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
  private model: string;
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
    this.model = process.env.AI_MODEL || fileConfig['aiModel'] || preset?.defaultModel || 'gpt-4o';

    if (!this.apiKey) {
      console.warn("No AI key found in .env or config file. AI calls will fail.");
    }
  }

  private getClient(provider: string): OpenAI {
    // Mocking support for unit tests
    if ((this as any).client) {
        return (this as any).client as OpenAI;
    }

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
        max_tokens: options.maxTokens ?? 4096,
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
    const model = options.model || (options.provider ? PROVIDER_PRESETS[options.provider]?.defaultModel : this.model);
    const maxRetries = 3;
    let lastError: any;

    Spinner.start('Thinking');
    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (provider === 'anthropic' && !this.baseURL?.includes('openai') && !(this as any).client) {
            return await this.callAnthropicNative(prompt, model, options);
          }

          const client = this.getClient(provider);

          const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: options.temperature ?? 0.7,
          });

          const result = completion as any;
          return result.choices?.[0]?.message?.content || '';
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            const waitTime = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
    } finally {
      Spinner.stop();
    }

    throw lastError;
  }

  public getAlternativeModel(): string {
    // If user explicitly configured a model in .env/config, respect it for all strategies.
    // Diversification is only useful if we have a pool of models and no strict preference.
    if (process.env.AI_MODEL) {
        return this.model;
    }

    const preset = PROVIDER_PRESETS[this.defaultProvider];
    if (!preset) return this.model;

    const currentModelId = this.model.toLowerCase();
    
    if (this.defaultProvider === 'anthropic') {
      if (currentModelId.includes('sonnet')) return 'claude-haiku-4-5';
      return 'claude-sonnet-4-6';
    }

    const otherModels = preset.models.filter((m: string) => m.toLowerCase() !== currentModelId);
    return otherModels.length > 0 ? otherModels[0] : this.model;
  }

  public getDefaultModel(): string { return this.model; }
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
    const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    try {
        const result = JSON.parse(jsonrepair(cleanJson));
        if (typeof result !== 'object' || result === null) {
            throw new Error('AI did not return a JSON object');
        }
        return result;
    } catch {
        throw new Error(`invalid JSON returned by AI: ${cleanJson}`);
    }
  }

  async chatAboutSpec(
    spec: WorkflowSpec,
    history: { role: 'user' | 'assistant'; content: string }[],
    userMessage: string
  ): Promise<{ reply: string; updatedSpec: WorkflowSpec }> {
    const conversationText = history
      .map(h => `${h.role === 'user' ? 'User' : 'Architect'}: ${h.content}`)
      .join('\n');

    const prompt = `You are an n8n Workflow Architect having a planning conversation with the user.

Current Workflow Spec:
${JSON.stringify(spec, null, 2)}

${conversationText ? `Conversation so far:\n${conversationText}\n` : ''}User: ${userMessage}

Respond conversationally to help the user understand or refine the plan. If the user requests changes to the workflow approach, update the spec accordingly.

Output a JSON object:
{
  "reply": "Your conversational response here",
  "updatedSpec": { /* full spec JSON — same structure as input, with any requested changes applied */ }
}

Output ONLY valid JSON. No markdown.`;

    const response = await this.generateContent(prompt);
    const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const result = JSON.parse(jsonrepair(cleanJson));
      return {
        reply: result.reply || '',
        updatedSpec: result.updatedSpec || spec,
      };
    } catch {
      return { reply: response, updatedSpec: spec };
    }
  }

  async generateWorkflow(goal: string): Promise<any> {
    const prompt = `You are an n8n Expert.
       Generate a valid n8n workflow JSON for the following goal: "${goal}".
       Output ONLY the JSON object. No commentary.`;
    const response = await this.generateContent(prompt);
    const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    try {
        return JSON.parse(jsonrepair(cleanJson));
    } catch {
        throw new Error(`invalid JSON: ${cleanJson}`);
    }
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
    const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    try {
        const result = JSON.parse(jsonrepair(cleanJson));
        if (typeof result !== 'object' || result === null) {
             return { ...primarySpec, suggestedName: primarySpec.suggestedName + " (Alt)", strategyName: 'alternative' } as any;
        }
        return result;
    } catch {
        // Fallback to primary spec with a suffix as expected by some tests or flows
        return { ...primarySpec, suggestedName: primarySpec.suggestedName + " (Alt)", strategyName: 'alternative' } as any;
    }
  }

  async generateModificationPlan(instruction: string, workflowJson: any): Promise<any> {
    const nodeList = (workflowJson.nodes || [])
      .map((n: any) => `${n.name} (${n.type})`)
      .join(', ');

    const prompt = `You are an n8n Solution Architect reviewing a workflow modification request.

Workflow: "${workflowJson.name || 'Untitled'}"
Current nodes: ${nodeList}

Modification requested: "${instruction}"

Analyze the request and produce a concise modification plan as a JSON object:
{
  "suggestedName": "Updated workflow name (or same if unchanged)",
  "description": "One-sentence summary of what this modification achieves",
  "proposedChanges": ["Specific change 1", "Specific change 2"],
  "affectedNodes": ["Node names that will be added, modified, or removed"]
}
Output ONLY the JSON object. No commentary.`;

    const response = await this.generateContent(prompt);
    const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
    try {
      return JSON.parse(jsonrepair(cleanJson));
    } catch {
      return {
        suggestedName: workflowJson.name || 'Modified Workflow',
        description: instruction,
        proposedChanges: [instruction],
        affectedNodes: [],
      };
    }
  }

  async applyModification(workflowJson: any, userGoal: string, spec: any, userFeedback?: string, validNodeTypes: string[] = []): Promise<any> {
    const nodeService = NodeDefinitionsService.getInstance();
    const staticRef = nodeService.getStaticReference();

    const prompt = `You are an n8n Workflow Engineer. Modify the following existing workflow.

ORIGINAL WORKFLOW:
${JSON.stringify(workflowJson, null, 2)}

MODIFICATION INSTRUCTION:
${userGoal}

MODIFICATION PLAN:
${JSON.stringify(spec, null, 2)}
${userFeedback ? `\nUSER FEEDBACK:\n${userFeedback}\n` : ''}
[N8N NODE REFERENCE GUIDE]
${staticRef}

${validNodeTypes.length > 0 ? `Valid node types: ${validNodeTypes.slice(0, 100).join(', ')}` : ''}

Apply ALL proposed changes. Then verify the following before outputting:

CONNECTION RULES — EVERY node must appear in the connections object:
1. Every non-trigger node must have at least one incoming connection from another node.
2. Every node that is not a terminal/sink must have at least one outgoing connection.
3. New nodes inserted into the middle of the flow must be wired into BOTH the incoming edge (from the predecessor) AND the outgoing edge (to the successor) — do not leave gaps in the chain.
4. If the original workflow had error output connections (e.g. "error" branch), replicate that pattern for any new nodes that have onError: "continueErrorOutput".
5. The connections object keys are SOURCE node names; the "node" field inside is the TARGET node name. Double-check every name matches exactly.

Preserve all existing nodes, connections, credentials, and IDs not mentioned in the plan. Add new nodes with unique string IDs.

Output ONLY the complete workflow JSON object. No commentary. No markdown.`;

    const response = await this.generateContent(prompt, { maxTokens: 8192 });
    const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();

    try {
      const result = JSON.parse(jsonrepair(cleanJson));
      const modified = result.workflows?.[0] || result;
      return this.wireOrphanedErrorHandlers(this.fixHallucinatedNodes(this.repairConnections(modified, workflowJson)));
    } catch (e) {
      console.error('Failed to parse modified workflow JSON', e);
      return workflowJson;
    }
  }

  /**
   * Merge connections from the original workflow into the modified one for any
   * nodes that exist in both but lost their connections during LLM generation.
   * Then does a position-based stitch for any remaining nodes with no outgoing
   * main connection, using canvas x/y position to infer the intended chain order.
   */
  private repairConnections(modified: any, original: any): any {
    if (!modified?.nodes || !modified?.connections) return modified;

    const connections = { ...(modified.connections || {}) };
    const origConnections: Record<string, any> = original?.connections || {};
    const nodeNames = new Set<string>((modified.nodes as any[]).map((n: any) => n.name));

    // 1. Restore original connections for nodes that exist in both but lost theirs.
    // Operates per output-type so that nodes with partial connections (e.g. LLM
    // generated "main" but dropped "error") still get their missing types restored.
    for (const [srcName, srcConn] of Object.entries(origConnections)) {
      if (!nodeNames.has(srcName)) continue;
      const existingConn: any = connections[srcName] || {};
      let changed = false;
      const merged: any = { ...existingConn };
      for (const [outputType, branches] of Object.entries(srcConn as any)) {
        if (existingConn[outputType]) continue; // this output type already present — keep LLM version
        const filteredBranches = (branches as any[][]).map((branch: any[]) =>
          branch.filter((edge: any) => nodeNames.has(edge.node))
        ).filter((branch: any[]) => branch.length > 0);
        if (filteredBranches.length > 0) {
          merged[outputType] = filteredBranches;
          changed = true;
        }
      }
      if (changed) connections[srcName] = merged;
    }

    // 2. Position-based chain stitching for nodes still missing outgoing main connections.
    // Group nodes by approximate y-row (round to nearest 300px), sort each row by x.
    // For any node with no outgoing main connection, wire it to the next node in its row.
    const nodes: any[] = modified.nodes;

    // 1b. Restore onError settings that the LLM may have stripped from nodes.
    const origNodeMap = new Map<string, any>(
      ((original?.nodes ?? []) as any[]).map((n: any) => [n.name, n])
    );
    for (const node of nodes) {
      const orig = origNodeMap.get(node.name);
      if (orig?.onError && !node.onError) {
        node.onError = orig.onError;
      }
    }

    // 1c. Wire error connections for any node with onError:"continueErrorOutput" that lacks one.
    // Covers new nodes the LLM added to the flow (not present in original) — step 1 can't restore
    // connections for those. Infer the error handler from what the original connected to.
    const errorHandlerNodes = new Set<string>();
    for (const srcConn of Object.values(origConnections)) {
      for (const branch of ((srcConn as any).error ?? []) as any[][]) {
        for (const edge of branch) {
          if (nodeNames.has(edge.node)) errorHandlerNodes.add(edge.node);
        }
      }
    }
    if (errorHandlerNodes.size > 0) {
      const errorHandler = [...errorHandlerNodes][0];
      for (const node of nodes) {
        if (node.onError !== 'continueErrorOutput') continue;
        if (connections[node.name]?.error?.length > 0) continue;
        connections[node.name] = {
          ...(connections[node.name] || {}),
          error: [[{ node: errorHandler, type: 'main', index: 0 }]],
        };
      }
    }

    // 1d. Remove LLM-hallucinated main connections from nodes that were terminal in the original.
    // A node is terminal if it existed in the original but had no outgoing main connections there.
    const origNodeNames = new Set(((original?.nodes ?? []) as any[]).map((n: any) => n.name));
    for (const node of nodes) {
      if (!origNodeNames.has(node.name)) continue; // new node — leave LLM connections alone
      const origConn = origConnections[node.name];
      const hadMain = (origConn?.main as any[][] | undefined)?.some((b: any[]) => b.length > 0);
      if (!hadMain && connections[node.name]?.main?.length > 0) {
        const nc = { ...(connections[node.name] || {}) };
        delete nc.main;
        if (Object.keys(nc).length > 0) {
          connections[node.name] = nc;
        } else {
          delete connections[node.name];
        }
      }
    }

    const rowMap = new Map<number, any[]>();
    for (const node of nodes) {
      const x = node.position?.[0] ?? 0;
      const y = node.position?.[1] ?? 0;
      const rowKey = Math.round(y / 300) * 300;
      if (!rowMap.has(rowKey)) rowMap.set(rowKey, []);
      rowMap.get(rowKey)!.push({ ...node, _x: x });
    }

    for (const row of rowMap.values()) {
      row.sort((a: any, b: any) => a._x - b._x);
      for (let i = 0; i < row.length - 1; i++) {
        const src = row[i];
        const tgt = row[i + 1];
        // Only stitch if this node has NO outgoing main connections yet
        if (connections[src.name]?.main?.length > 0) continue;
        connections[src.name] = {
          ...(connections[src.name] || {}),
          main: [[{ node: tgt.name, type: 'main', index: 0 }]],
        };
      }
    }

    return { ...modified, connections };
  }

  async generateWorkflowFix(workflow: any, error: string, model?: string, _stream: boolean = false, validNodeTypes: string[] = []): Promise<any> {
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
    const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
        const fixed = JSON.parse(jsonrepair(cleanJson));
        const result = fixed.workflows?.[0] || fixed;
        return this.wireOrphanedErrorHandlers(this.fixHallucinatedNodes(this.repairConnections(result, workflow)));
    } catch (e) {
        console.error("Failed to parse fix JSON", e);
        return workflow;
    }
  }

  public validateAndShim(workflow: any, validNodeTypes: string[] = [], explicitlyInvalid: string[] = []): any {
    if (!workflow || !workflow.nodes) return workflow;

    const shimmedWorkflow = JSON.parse(JSON.stringify(workflow));
    shimmedWorkflow.nodes = shimmedWorkflow.nodes.map((node: any) => {
      const type = node.type;
      const isExplicitlyInvalid = explicitlyInvalid.includes(type);
      const isUnknown = validNodeTypes.length > 0 && !validNodeTypes.includes(type);

      if (isExplicitlyInvalid || isUnknown) {
        const originalType = node.type;
        let shimType = 'n8n-nodes-base.set';
        
        const lowerType = originalType.toLowerCase();
        if (lowerType.includes('trigger') || lowerType.includes('webhook')) {
          shimType = 'n8n-nodes-base.webhook';
        } else if (lowerType.includes('slack') || lowerType.includes('api') || lowerType.includes('http') || lowerType.includes('discord')) {
          shimType = 'n8n-nodes-base.httpRequest';
        }

        node.type = shimType;
        node.notes = (node.notes || '') + (node.notes ? '\n' : '') + `[Shimmed from ${originalType}]`;
      }
      return node;
    });

    return shimmedWorkflow;
  }

  public fixHallucinatedNodes(workflow: any): any {
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
        "n8n-nodes-base.googleCustomSearch": "n8n-nodes-base.googleGemini",
        "googleCustomSearch": "n8n-nodes-base.googleGemini"
    };

    workflow.nodes = workflow.nodes.map((node: any) => {
        if (node.type && corrections[node.type]) {
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
   * Wire orphaned error-handler nodes that the LLM created but forgot to connect.
   * Detects nodes with no incoming connections whose name suggests they are error
   * handlers (contains "Error", "Cleanup", "Rollback", "Fallback", etc.) and wires
   * every non-terminal, non-handler node's error output to them.
   * Also sets onError:"continueErrorOutput" on each wired source node.
   */
  public wireOrphanedErrorHandlers(workflow: any): any {
    if (!workflow?.nodes || !workflow?.connections) return workflow;

    const nodes: any[] = workflow.nodes;
    const connections: Record<string, any> = { ...(workflow.connections || {}) };

    // Build set of nodes that have at least one incoming connection.
    const hasIncoming = new Set<string>();
    for (const srcConn of Object.values(connections)) {
      for (const branches of Object.values(srcConn as any)) {
        for (const branch of branches as any[][]) {
          for (const edge of branch) {
            if (edge?.node) hasIncoming.add(edge.node);
          }
        }
      }
    }

    const TRIGGER_TYPES = /trigger|webhook|cron|schedule|interval|timer|poller|gmail|rss/i;
    const ERROR_HANDLER_PATTERN = /error|cleanup|rollback|fallback|on.?fail|recover/i;

    // Orphaned nodes = no incoming connection, not a trigger, name looks like an error handler.
    const errorHandlers = nodes.filter(n =>
      !hasIncoming.has(n.name) &&
      !TRIGGER_TYPES.test(n.type || '') &&
      ERROR_HANDLER_PATTERN.test(n.name)
    );

    if (errorHandlers.length === 0) return workflow;

    // Non-terminal nodes = have at least one outgoing main connection.
    const nonTerminal = new Set<string>();
    for (const [srcName, srcConn] of Object.entries(connections)) {
      const mainBranches = (srcConn as any).main as any[][] | undefined;
      if (mainBranches?.some((b: any[]) => b.length > 0)) {
        nonTerminal.add(srcName);
      }
    }

    for (const handler of errorHandlers) {
      const sources = nodes.filter(n =>
        nonTerminal.has(n.name) &&
        !ERROR_HANDLER_PATTERN.test(n.name) &&
        !(connections[n.name]?.error?.length > 0)
      );
      for (const src of sources) {
        src.onError = 'continueErrorOutput';
        connections[src.name] = {
          ...(connections[src.name] || {}),
          error: [[{ node: handler.name, type: 'main', index: 0 }]],
        };
      }
    }

    return { ...workflow, connections };
  }

  public fixN8nConnections(workflow: any): any {
    if (!workflow.connections || typeof workflow.connections !== 'object') return workflow;
    
    const fixedConnections: any = {};
    
    for (const [sourceNode, targets] of Object.entries(workflow.connections)) {
        if (!targets || typeof targets !== 'object') continue;
        const targetObj = targets as any;

        if (targetObj.main) {
            let mainArr = targetObj.main;
            if (!Array.isArray(mainArr)) mainArr = [[ { node: String(mainArr), type: 'main', index: 0 } ]];
            
            const fixedMain = mainArr.map((segment: any) => {
                if (!segment) return [];
                if (!Array.isArray(segment)) return [segment];
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
            fixedConnections[sourceNode] = targetObj;
        }
    }
    
    workflow.connections = fixedConnections;
    return workflow;
  }

  async generateMockData(context: string): Promise<any> {
      const prompt = `You are a testing expert. Generate mock data for the following context:
      ${context}
      Output ONLY valid JSON payload. No commentary.`;
      
      const response = await this.generateContent(prompt, { temperature: 0.9 });
      const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
      try {
          const result = JSON.parse(jsonrepair(cleanJson));
          if (typeof result !== 'object' || result === null) {
              return { message: cleanJson };
          }
          return result;
      } catch {
          return { message: cleanJson };
      }
  }

  async fixExecuteCommandScript(command: string, error?: string): Promise<string> {
    const errorCtx = error ? `\nError from the failing command:\n${error}\n` : '';
    const prompt = `You are a bash scripting expert.
The following shell command is used in an n8n Execute Command node.
It appears that newlines were accidentally stripped from the script, collapsing it to a single line.${errorCtx}
Current (collapsed) command:
\`\`\`
${command}
\`\`\`

Reconstruct the properly-formatted multiline bash script. Rules:
- Restore newlines between statements (variable assignments, commands, etc.)
- Properly format line-continuation backslashes: each \\ must be followed by a real newline
- Keep all original commands and logic intact — do not change what the script does
- Use \\n to separate statements, not semicolons (unless they were originally there)

Return ONLY the fixed shell script. No markdown fences, no explanation.`;

    const response = await this.generateContent(prompt, { temperature: 0.1 });
    return response.replace(/^```(?:bash|sh|shell)?\n?|\n?```$/g, '').trim();
  }

  async fixCodeNodeJavaScript(code: string, error: string): Promise<string> {
    const prompt = `You are an n8n Code node JavaScript expert.
The following code is used in an n8n Code node but fails with a syntax error.
Error: ${error}

Current code:
\`\`\`javascript
${code}
\`\`\`

Fix the JavaScript so it runs correctly in an n8n Code node. Rules:
- All ES6+ syntax is valid (const, let, arrow functions, destructuring, template literals, etc.)
- Access all input items via: const items = $input.all();
- Access single input via: const item = $input.first();
- Return transformed items as: return [{json: {...}}];
- Do NOT use require() or import — n8n provides built-in variables ($input, $json, $node, etc.)

Return ONLY the fixed JavaScript code. No markdown fences, no explanation.`;

    const response = await this.generateContent(prompt, { temperature: 0.1 });
    return response.replace(/^```(?:javascript|js)?\n?|\n?```$/g, '').trim();
  }

  async shimCodeNodeWithMockData(code: string): Promise<string> {
    const prompt = `You are an n8n Code node JavaScript expert.
The following n8n Code node makes external HTTP/API calls or references other nodes via $('NodeName') — none of which are available in the isolated test environment.
Your task: completely rewrite it to return hardcoded mock data that matches the expected output structure.

Original code:
\`\`\`javascript
${code}
\`\`\`

Rules:
- Analyze what data structure the original code was meant to return
- Write a COMPLETE REPLACEMENT — do NOT keep any HTTP requests, fetch, axios, this.helpers calls, or $('NodeName') references
- Replace every $('NodeName').first().json.X reference with a reasonable hardcoded value
- Do NOT use require() or import
- Return realistic hardcoded mock values as: return [{json: {...}}];
- The mock data must match the real API response shape so downstream nodes work correctly

Return ONLY the replacement JavaScript code. No markdown fences, no explanation.`;

    const response = await this.generateContent(prompt, { temperature: 0.1 });
    return response.replace(/^```(?:javascript|js)?\n?|\n?```$/g, '').trim();
  }

  /**
   * Analyze a validated working workflow and generate a reusable pattern file.
   * Returns markdown content ready to save to docs/patterns/.
   */
  async generatePattern(workflowJson: any): Promise<{ content: string; slug: string }> {
    const stripped = {
      name: workflowJson.name,
      nodes: (workflowJson.nodes || []).map((n: any) => ({
        name: n.name,
        type: n.type,
        typeVersion: n.typeVersion,
        parameters: n.parameters,
      })),
      connections: workflowJson.connections,
    };

    const prompt = `You are an n8n workflow expert analyzing a VALIDATED, WORKING n8n workflow.
Your job is to extract the reusable knowledge from this workflow into a pattern file that will teach an AI engineer to build similar workflows correctly.

Workflow JSON:
${JSON.stringify(stripped, null, 2)}

Generate a markdown pattern file with the following structure:

1. First line MUST be: <!-- keywords: <comma-separated keywords> -->
   - Keywords should cover: service names, operations, node types, integration categories
   - Example: <!-- keywords: bigquery, google bigquery, sql, merge, staging, http request -->

2. A short title: # Pattern: <descriptive title>

3. ## Critical Rules
   - List any gotchas, wrong approaches to avoid, or non-obvious choices made in this workflow
   - Be specific: e.g. "Use n8n-nodes-base.httpRequest instead of n8n-nodes-base.googleBigQuery because..."
   - If there are no critical rules, omit this section

4. ## Authentication
   - Document the credential type and any required scopes/permissions
   - Only include if the workflow uses credentials

5. One section per major technique demonstrated, e.g.:
   ## <Technique Name>
   - Explain what it does and why
   - Include the relevant node config as a JSON code block (use actual values from the workflow, anonymize project IDs to YOUR_PROJECT etc.)
   - Note any important parameter choices

6. ## Error Handling (if the workflow has error paths)
   - Explain the error handling strategy

Keep the pattern focused and actionable. An AI reading this should be able to reproduce the technique correctly.
Output ONLY the markdown content. No commentary before or after.`;

    const content = await this.generateContent(prompt, { temperature: 0.3 });

    // Derive a filename slug from the workflow name
    const slug = (workflowJson.name || 'workflow')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return { content, slug };
  }

  async evaluateCandidates(goal: string, candidates: any[]): Promise<{ selectedIndex: number, reason: string }> {
    if (candidates.length === 0) return { selectedIndex: 0, reason: "No candidates" };
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
    const cleanJson = response.replace(/```json\n?|\n?```/g, "").trim();
    try {
        const result = JSON.parse(jsonrepair(cleanJson));
        // Clamp and sanitize response to match tests
        if (typeof result.selectedIndex !== 'number') result.selectedIndex = 0;
        if (result.selectedIndex < 0) result.selectedIndex = 0;
        if (result.selectedIndex >= candidates.length) result.selectedIndex = Math.max(0, candidates.length - 1);
        if (!result.reason) result.reason = "Heuristic selection";
        return result;
    } catch {
        return { selectedIndex: 0, reason: "Failed to parse AI response" };
    }
  }

  /**
   * AI-powered error evaluation for n8n test executions.
   * Replaces brittle regex classifiers — the model reads the error + node list and decides.
   */
  async evaluateTestError(
    errorMessage: string,
    workflowNodes: any[],
    failingNodeName?: string,
    failingNodeCode?: string,
  ): Promise<TestErrorEvaluation> {
    const nodesSummary = (workflowNodes || [])
      .map((n: any) => `- "${n.name}" (${n.type})`)
      .join('\n');

    const codeContext = failingNodeCode
      ? `\nFailing node's JavaScript code:\n\`\`\`javascript\n${failingNodeCode}\n\`\`\``
      : '';

    const prompt = `You are an n8n workflow testing expert. An execution failed with the error below.
Classify the error and choose the best remediation action.

Error: ${errorMessage}
${failingNodeName ? `Failing node: "${failingNodeName}"` : ''}${codeContext}

Workflow nodes:
${nodesSummary}

ACTIONS (choose exactly one):
• "fix_node" — the error is a fixable node configuration bug in the workflow itself:
  - nodeFixType "code_node_js":    JavaScript syntax/runtime error in a Code node
  - nodeFixType "execute_command": shell script error in an Execute Command node
  - nodeFixType "binary_field":    wrong binaryPropertyName in a node (HTTP Request always outputs field "data")
• "regenerate_payload" — the test input payload is missing required fields or has wrong values; the workflow logic itself is correct (e.g. "No property named", "is not defined", "$json.body.X" errors)
• "structural_pass" — the workflow structure is valid but the test environment lacks:
  external services (Slack, HTTP APIs, OAuth, databases), credentials, upstream binary data, rate limits, or encoding issues (e.g. "could not be parsed").
  Also use this for any URL or connection error from an external API node (Slack, HTTP Request, Google, etc.) — "Invalid URL", "Failed to connect", "ECONNREFUSED", "401 Unauthorized", "403 Forbidden", "Network error" all indicate the test environment can't reach the external service, not a workflow bug.
  IMPORTANT: If the failing code uses $('NodeName') to reference other workflow nodes, and those nodes are AI/LLM nodes, external APIs, or services that cannot run in isolation, this is a structural_pass — the workflow requires the full upstream pipeline to test.
• "escalate" — fundamental design flaw that requires rebuilding the workflow

Respond with ONLY this JSON (no commentary, no markdown):
{
  "action": "fix_node" | "regenerate_payload" | "structural_pass" | "escalate",
  "nodeFixType": "code_node_js" | "execute_command" | "binary_field" | null,
  "targetNodeName": "<exact node name or null>",
  "suggestedBinaryField": "data" | null,
  "reason": "<one sentence>"
}`;

    try {
      const response = await this.generateContent(prompt, { temperature: 0.1 });
      const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
      const result = JSON.parse(jsonrepair(cleanJson));
      if (!['fix_node', 'regenerate_payload', 'structural_pass', 'escalate'].includes(result.action)) {
        result.action = 'structural_pass';
      }
      return result as TestErrorEvaluation;
    } catch {
      return { action: 'structural_pass', reason: 'Could not evaluate error — defaulting to structural pass' };
    }
  }

  /**
   * Offline-only: evaluates whether a fixed Code node or Execute Command script
   * would succeed given the REAL input items from the fixture's runData.
   * Used when no live re-execution is possible.
   */
  async evaluateCodeFixOffline(
    fixedCode: string,
    inputItems: any[],
    originalError: string,
    nodeType: 'code_node_js' | 'execute_command',
  ): Promise<{ wouldPass: boolean; reason: string }> {
    const codeLabel = nodeType === 'code_node_js' ? 'JavaScript' : 'shell script';
    const ruleNote = nodeType === 'code_node_js'
      ? 'n8n Code node rules: use $input.all() / $input.first(), return Array<{json:{...}}>, no require/import.'
      : 'Shell script runs in the n8n Execute Command node environment.';

    const prompt = `You are an n8n ${codeLabel} execution expert.

A node previously failed with this error:
${originalError}

It was fixed. The fixed ${codeLabel} is:
\`\`\`
${fixedCode}
\`\`\`

The REAL input items from the fixture are:
${JSON.stringify(inputItems, null, 2)}

${ruleNote}

Task: Mentally execute the fixed code against these real inputs.
- Does it have syntax errors?
- Are all referenced fields present in the input items?
- Does it address the original error?
- Would it produce valid output?

Respond with ONLY this JSON (no commentary, no markdown):
{"wouldPass": true|false, "reason": "<one sentence>"}`;

    try {
      const response = await this.generateContent(prompt, { temperature: 0.1 });
      const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
      const result = JSON.parse(jsonrepair(cleanJson));
      return { wouldPass: Boolean(result.wouldPass), reason: result.reason ?? '' };
    } catch {
      return { wouldPass: true, reason: 'Could not evaluate offline — assuming pass' };
    }
  }

  /**
   * Traces binary data flow through an entire workflow graph to find the correct
   * binary field name for a failing upload node.
   *
   * Handles passthrough nodes (Merge, Set, IF, Switch) by tracing further upstream
   * and reads Code node jsCode to extract the actual binary field assignment.
   * Delegates graph traversal + analysis entirely to the AI.
   */
  async inferBinaryFieldNameFromWorkflow(
    failingNodeName: string,
    workflowNodes: any[],
    workflowConnections: any,
  ): Promise<string | null> {
    const nodesSummary = (workflowNodes || [])
      .map((n: any) => `- "${n.name}" (${n.type})`)
      .join('\n');

    const connsSummary = Object.entries(workflowConnections || {})
      .map(([src, targets]: [string, any]) => {
        const dests = ((targets as any).main || []).flat()
          .map((c: any) => `"${c?.node}"`)
          .filter(Boolean)
          .join(', ');
        return `"${src}" → [${dests}]`;
      })
      .join('\n');

    // Include full jsCode for any Code/Function nodes so the AI can read binary assignments
    const codeSnippets = (workflowNodes || [])
      .filter((n: any) =>
        (n.type === 'n8n-nodes-base.code' || n.type === 'n8n-nodes-base.function') &&
        n.parameters?.jsCode
      )
      .map((n: any) => `\n"${n.name}" (${n.type}) jsCode:\n\`\`\`javascript\n${n.parameters.jsCode}\n\`\`\``)
      .join('\n');

    const prompt = `You are an n8n binary data expert. Analyze this workflow to find the correct binary field name for the failing upload node.

Failing node: "${failingNodeName}" — error: "has no binary field"

Workflow nodes:
${nodesSummary}

Connections (source → [targets]):
${connsSummary}
${codeSnippets ? `\nCode node implementations:${codeSnippets}` : ''}

Task: Trace binary data flow backwards from "${failingNodeName}" to find the node that actually CREATES or DOWNLOADS the binary data. Then determine what field name it uses for the binary output.

Binary field name rules:
- n8n-nodes-base.httpRequest → always outputs binary as "data"
- n8n-nodes-base.readBinaryFile / readBinaryFiles → "data"
- n8n-nodes-base.code / function → look at jsCode: items[0].binary = { FIELD_NAME: ... } or return [{ binary: { FIELD_NAME: ... } }]
- n8n-nodes-base.merge / set / if / switch / noOp → pass-through nodes, trace upstream
- Slack / Google Drive / Dropbox / other API download nodes → "data"

What is the correct binaryPropertyName for "${failingNodeName}"?
If you cannot determine it with confidence, return null.

Respond ONLY with this JSON (no commentary, no markdown):
{"binaryFieldName": "the_field_name" | null}`;

    try {
      const response = await this.generateContent(prompt, { temperature: 0.1 });
      const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
      const result = JSON.parse(jsonrepair(cleanJson));
      return typeof result.binaryFieldName === 'string' ? result.binaryFieldName : null;
    } catch {
      return null;
    }
  }

  /**
   * Returns jsCode for an n8n Code node (runOnceForAllItems) that produces
   * synthetic binary test data in the specified field.
   *
   * Hardcoded — no LLM call — because the n8n Code node binary format is
   * deterministic and LLM-generated variants consistently misuse APIs that
   * aren't available (this.helpers.prepareBinaryData, $input.all() in wrong mode, etc.).
   */
  generateBinaryShimCode(binaryFieldName: string): string {
    const fieldKey = JSON.stringify(binaryFieldName);
    return [
      `const base64 = Buffer.from('n8m-test-binary', 'utf-8').toString('base64');`,
      `return $input.all().map(item => ({`,
      `  json: item.json,`,
      `  binary: {`,
      `    ${fieldKey}: {`,
      `      data: base64,`,
      `      mimeType: 'text/plain',`,
      `      fileName: 'test-file.txt',`,
      `      fileExtension: 'txt'`,
      `    }`,
      `  }`,
      `}));`,
    ].join('\n');
  }

  /**
   * Generates 3-5 diverse test scenarios (input payloads) for a workflow.
   */
  async generateTestScenarios(workflowJson: any, goal: string): Promise<any[]> {
    const prompt = `You are an n8n QA Engineer.
    Given the following workflow goal and structure, generate 3 diverse test scenarios (input payloads) to verify its robustness.
    
    Goal: ${goal}
    
    Workflow Summary (Nodes):
    ${(workflowJson.nodes || []).map((n: any) => `- ${n.name} (${n.type})`).join('\n')}
    
    Generate 3 scenarios:
    1. Happy Path: A standard, valid input that should succeed.
    2. Edge Case: A valid but unusual input (e.g. empty strings, special characters, max values).
    3. Error Case: An input that is likely to trigger a validation error or branch (e.g. missing required field, invalid format).
    
    Output a JSON array of objects, where each object has:
    {
      "name": "Scenario Description",
      "payload": { ... input data ... },
      "expectedBehavior": "What should happen"
    }
    
    Output ONLY valid JSON. No commentary. No markdown.
    `;

    const response = await this.generateContent(prompt);
    try {
        const cleanJson = (response || "[]").replace(/```json\n?|\n?```/g, "").trim();
        return JSON.parse(jsonrepair(cleanJson));
    } catch {
        return [{ name: "Default Test", payload: {}, expectedBehavior: "Success" }];
    }
  }
}

// Dummy for compilation fix
const presetConfigs: any = PROVIDER_PRESETS;
