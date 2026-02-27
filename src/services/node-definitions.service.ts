import { N8nClient } from '../utils/n8nClient.js';
import { ConfigManager } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        // Will be overridden in loadDefinitions() once config is available
        this.client = new N8nClient();
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
            // Env vars take priority over stored config
            const apiUrl = process.env.N8N_API_URL || config.n8nUrl;
            const apiKey = process.env.N8N_API_KEY || config.n8nKey;
            if (apiUrl && apiKey) {
                this.client = new N8nClient({ apiUrl, apiKey });
            }
            
            this.definitions = await this.client.getNodeTypes();
            
            if (this.definitions.length === 0) {
                console.warn("No node definitions returned from n8n instance. Attempting fallback...");
                this.loadFallback();
            } else {
                console.log(`Loaded ${this.definitions.length} node definitions.`);
            }
        } catch {
            console.error("Failed to load node definitions from n8n instance (fetch failed).");
            this.loadFallback();
        }
    }

    private loadFallback(): void {
        try {
            // Check multiple potential locations (dist vs src)
            const paths = [
                path.join(__dirname, '..', 'resources', 'node-definitions-fallback.json'), // dist
                path.join(__dirname, '..', '..', 'src', 'resources', 'node-definitions-fallback.json') // src (dev)
            ];

            let fallbackPath = '';
            for (const p of paths) {
                if (fs.existsSync(p)) {
                    fallbackPath = p;
                    break;
                }
            }

            if (fallbackPath) {
                const fallbackData = fs.readFileSync(fallbackPath, 'utf8');
                this.definitions = JSON.parse(fallbackData);
                console.log(`Loaded ${this.definitions.length} node definitions (from fallback at ${path.basename(path.dirname(fallbackPath))}).`);
            } else {
                console.warn("Fallback node definitions file not found in searched locations.");
                this.definitions = [];
            }
        } catch (fallbackError) {
            console.error("Failed to load fallback node definitions:", fallbackError);
            this.definitions = [];
        }
    }

    /**
     * Get the human-readable static reference document
     */
    public getStaticReference(): string {
        try {
            const docPath = path.join(__dirname, '..', '..', 'docs', 'N8N_NODE_REFERENCE.md');
            if (fs.existsSync(docPath)) {
                return fs.readFileSync(docPath, 'utf8');
            }
        } catch (e) {
            console.error("Failed to read N8N_NODE_REFERENCE.md", e);
        }
        return "";
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
