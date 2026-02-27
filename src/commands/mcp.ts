import { Command } from '@oclif/core'
import { theme } from '../utils/theme.js';
import { MCPService } from '../services/mcp.service.js';

export default class MCP extends Command {
  static description = 'Launch the n8m MCP (Model Context Protocol) server'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  async run(): Promise<void> {
    this.log(theme.brand());
    this.log(theme.info('Starting n8m MCP Server...'));
    
    try {
        const mcpService = new MCPService();
        await mcpService.start();
        
        // Wait for interrupt (Process will stay alive due to stdio transport)
        process.on('SIGINT', () => {
             this.log(theme.info('\nStopping MCP Server...'));
             process.exit(0);
        });
    } catch (error) {
        this.error(`Failed to start MCP Server: ${(error as Error).message}`);
    }
  }
}
