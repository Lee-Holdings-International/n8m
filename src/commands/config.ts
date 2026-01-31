import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../utils/config.js';

export default class Config extends Command {
  static description = 'Manage n8m configuration';

  static flags = {
    'api-key': Flags.string({ description: 'Set SaaS API Key' }),
    'n8n-url': Flags.string({ description: 'Set n8n Instance URL' }),
    'n8n-key': Flags.string({ description: 'Set n8n API Key' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Config);
    const config = await ConfigManager.load();

    if (Object.keys(flags).length === 0) {
      // Show config
      this.log(chalk.bold('Current Configuration:'));
      this.log(`  SaaS API Key: ${config.apiKey ? '********' : chalk.dim('Not set')}`);
      this.log(`  n8n URL:      ${config.n8nUrl || chalk.dim('Not set')}`);
      this.log(`  n8n Key:      ${config.n8nKey ? '********' : chalk.dim('Not set')}`);
      return;
    }

    // Update config
    if (flags['api-key']) config.apiKey = flags['api-key'];
    if (flags['n8n-url']) config.n8nUrl = flags['n8n-url'];
    if (flags['n8n-key']) config.n8nKey = flags['n8n-key'];

    await ConfigManager.save(config);
    this.log(chalk.green('Configuration updated successfully!'));
  }
}
