import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runAgenticWorkflow } from "../agentic/graph.js";
import { theme } from "../utils/theme.js";
import { N8nClient } from "../utils/n8nClient.js";
import { ConfigManager } from "../utils/config.js";
import { DocService } from "../services/doc.service.js";

/**
 * MCP Service for exposing n8m agentic capabilities as tools.
 */
export class MCPService {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "n8m-agent",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
  }

  private setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "create_workflow",
            description: "Generate an n8n workflow from a natural language description.",
            inputSchema: {
              type: "object",
              properties: {
                goal: {
                  type: "string",
                  description: "Natural language description of the workflow goals",
                },
              },
              required: ["goal"],
            },
          },
          {
            name: "test_workflow",
            description: "Validate and repair a workflow JSON by deploying it ephemerally to n8n.",
            inputSchema: {
              type: "object",
              properties: {
                workflowJson: {
                  type: "object",
                  description: "The workflow JSON to test",
                },
                goal: {
                  type: "string",
                  description: "The original goal or context for testing",
                },
              },
              required: ["workflowJson", "goal"],
            },
          },
          {
            name: "modify_workflow",
            description: "Modify an existing n8n workflow JSON based on natural language instructions using the AI agent.",
            inputSchema: {
              type: "object",
              properties: {
                workflowJson: {
                  type: "object",
                  description: "The existing workflow JSON to modify",
                },
                instruction: {
                  type: "string",
                  description: "Natural language description of the modifications to apply",
                },
              },
              required: ["workflowJson", "instruction"],
            },
          },
          {
            name: "deploy_workflow",
            description: "Deploy a workflow JSON to the configured n8n instance. Creates a new workflow or updates an existing one if the workflow has an ID.",
            inputSchema: {
              type: "object",
              properties: {
                workflowJson: {
                  type: "object",
                  description: "The workflow JSON to deploy",
                },
                forceCreate: {
                  type: "boolean",
                  description: "Always create as a new workflow, ignoring any existing ID (default: false)",
                },
              },
              required: ["workflowJson"],
            },
          },
          {
            name: "get_workflow",
            description: "Fetch a workflow from the configured n8n instance by its ID.",
            inputSchema: {
              type: "object",
              properties: {
                workflowId: {
                  type: "string",
                  description: "The n8n workflow ID to fetch",
                },
              },
              required: ["workflowId"],
            },
          },
          {
            name: "list_workflows",
            description: "List all workflows on the configured n8n instance.",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
            },
          },
          {
            name: "delete_workflow",
            description: "Delete a workflow from the configured n8n instance by its ID.",
            inputSchema: {
              type: "object",
              properties: {
                workflowId: {
                  type: "string",
                  description: "The n8n workflow ID to delete",
                },
              },
              required: ["workflowId"],
            },
          },
          {
            name: "generate_docs",
            description: "Generate a Mermaid diagram and README documentation for a workflow JSON.",
            inputSchema: {
              type: "object",
              properties: {
                workflowJson: {
                  type: "object",
                  description: "The workflow JSON to document",
                },
              },
              required: ["workflowJson"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "create_workflow") {
          const goal = String((args as any).goal);
          // Run agentic workflow without interactive approval for MCP
          const result = await runAgenticWorkflow(goal);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.workflowJson || result, null, 2),
              },
            ],
          };
        } else if (name === "test_workflow") {
          const workflowJson = (args as any).workflowJson;
          const goal = String((args as any).goal);
          const result = await runAgenticWorkflow(goal, { workflowJson });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } else if (name === "modify_workflow") {
          const workflowJson = (args as any).workflowJson;
          const instruction = String((args as any).instruction);
          const goal = `Modify the provided workflow based on these instructions: ${instruction}`;
          const result = await runAgenticWorkflow(goal, { workflowJson });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.workflowJson || result, null, 2),
              },
            ],
          };
        } else if (name === "deploy_workflow") {
          const workflowJson = (args as any).workflowJson as any;
          const forceCreate = Boolean((args as any).forceCreate ?? false);
          const client = await this.getN8nClient();
          let deployedId: string;

          if (workflowJson.id && !forceCreate) {
            let exists = false;
            try {
              await client.getWorkflow(workflowJson.id);
              exists = true;
            } catch { /* not found */ }

            if (exists) {
              await client.updateWorkflow(workflowJson.id, workflowJson);
              deployedId = workflowJson.id;
            } else {
              const r = await client.createWorkflow(workflowJson.name || "n8m-workflow", workflowJson);
              deployedId = r.id;
            }
          } else {
            const r = await client.createWorkflow(workflowJson.name || "n8m-workflow", workflowJson);
            deployedId = r.id;
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ id: deployedId, link: client.getWorkflowLink(deployedId) }),
              },
            ],
          };
        } else if (name === "get_workflow") {
          const workflowId = String((args as any).workflowId);
          const client = await this.getN8nClient();
          const workflow = await client.getWorkflow(workflowId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(workflow, null, 2),
              },
            ],
          };
        } else if (name === "list_workflows") {
          const client = await this.getN8nClient();
          const workflows = await client.getWorkflows();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(workflows, null, 2),
              },
            ],
          };
        } else if (name === "delete_workflow") {
          const workflowId = String((args as any).workflowId);
          const client = await this.getN8nClient();
          await client.deleteWorkflow(workflowId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ deleted: true, workflowId }),
              },
            ],
          };
        } else if (name === "generate_docs") {
          const workflowJson = (args as any).workflowJson;
          const docService = DocService.getInstance();
          const mermaid = docService.generateMermaid(workflowJson);
          const readme = await docService.generateReadme(workflowJson);
          const workflowName = workflowJson.name || "Workflow";
          const fullDoc = `# ${workflowName}\n\n## Visual Flow\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n${readme}`;
          return {
            content: [
              {
                type: "text",
                text: fullDoc,
              },
            ],
          };
        }

        throw new Error(`Tool not found: ${name}`);
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async getN8nClient(): Promise<N8nClient> {
    const config = await ConfigManager.load();
    const n8nUrl = config.n8nUrl || process.env.N8N_API_URL;
    const n8nKey = config.n8nKey || process.env.N8N_API_KEY;
    if (!n8nUrl || !n8nKey) {
      throw new Error("Missing n8n credentials. Run 'n8m config' to set them.");
    }
    return new N8nClient({ apiUrl: n8nUrl, apiKey: n8nKey });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(theme.done("n8m MCP Server started (stdio transport)"));
  }
}
