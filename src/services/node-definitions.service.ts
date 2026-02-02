import { N8nClient } from '../utils/n8nClient.js';
import { ConfigManager } from '../utils/config.js';

export interface ReducedNodeDefinition {
    name: string;
    displayName: string;
    description: string;
    properties: any[];
}

export class NodeDefinitionsService {
    private static instance: NodeDefinitionsService;
    private definitions: any[] = [];
    private client: N8nClient;

    private constructor() {
        const n8nUrl = process.env.N8N_API_URL;
        const n8nKey = process.env.N8N_API_KEY;
        this.client = new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
    }

    public static getInstance(): NodeDefinitionsService {
        if (!NodeDefinitionsService.instance) {
            NodeDefinitionsService.instance = new NodeDefinitionsService();
        }
        return NodeDefinitionsService.instance;
    }

    /**
     * Load definitions from n8n instance.
     * In a real app, we might cache this to a file.
     */
    async loadDefinitions(): Promise<void> {
        if (this.definitions.length > 0) return;
        
        console.log('Loading node definitions...');
        try {
            // Re-initialize client if env vars changed (e.g. after config load)
            const config = await ConfigManager.load();
            if (config.n8nUrl && config.n8nKey) {
                this.client = new N8nClient({ apiUrl: config.n8nUrl, apiKey: config.n8nKey });
            }
            
            this.definitions = await this.client.getNodeTypes();
            console.log(`Loaded ${this.definitions.length} node definitions.`);
        } catch (error) {
            console.error("Failed to load node definitions:", error);
            // Fallback to empty to allow process to continue without RAG
            this.definitions = [];
        }
    }

    /**
     * Search for nodes relevant to the query.
     * Simple keyword matching for now.
     */
    search(query: string, limit: number = 5): ReducedNodeDefinition[] {
        const lowerQuery = query.toLowerCase();
        const terms = lowerQuery.split(/\s+/).filter(t => t.length > 2);
        
        if (terms.length === 0) return [];

        const matches = this.definitions.filter(def => {
            const text = `${def.displayName} ${def.name} ${def.description || ''}`.toLowerCase();
            return terms.some(term => text.includes(term));
        });

        // Sort by relevance (number of matched terms) - simplified
        return matches.slice(0, limit).map(this.reduceDefinition);
    }

    /**
     * Get exact definitions for specific node types
     */
    getDefinitions(nodeNames: string[]): ReducedNodeDefinition[] {
        return this.definitions
            .filter(def => nodeNames.includes(def.name))
            .map(this.reduceDefinition);
    }

    /**
     * Compress the definition to save tokens.
     * We keep properties (parameters) but strip UI metadata.
     */
    private reduceDefinition(def: any): ReducedNodeDefinition {
        return {
            name: def.name,
            displayName: def.displayName,
            description: def.description,
            // We need to carefully select properties. 
            // n8n properties are complex. We want 'name', 'type', 'default', 'description', 'options'.
            properties: (def.properties || []).map((p: any) => ({
                name: p.name,
                displayName: p.displayName,
                type: p.type,
                default: p.default,
                description: p.description,
                // For 'options' type (dropdowns), include options
                options: p.options ? p.options.map((o: any) => ({ name: o.name, value: o.value })) : undefined,
                // For 'collection' or 'fixedCollection', we need substructure. 
                // This is a simplification. A full schema dump might be too large.
                // Let's include 'typeOptions' as it often contains routing/validation info
                typeOptions: p.typeOptions
            }))
        };
    }

    /**
     * Format definitions for LLM System Prompt
     */
    formatForLLM(definitions: ReducedNodeDefinition[]): string {
        return definitions.map(def => `
Node: ${def.displayName} (${def.name})
Description: ${def.description}
Parameters:
${JSON.stringify(def.properties, null, 2)}
`).join('\n---\n');
    }
}
