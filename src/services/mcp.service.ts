import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runAgenticWorkflow } from "../agentic/graph.js";
import { theme } from "../utils/theme.js";

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

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(theme.done("n8m MCP Server started (stdio transport)"));
  }
}
