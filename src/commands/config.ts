import { Command, Flags } from '@oclif/core';
import { theme } from '../utils/theme.js';
import { ConfigManager } from '../utils/config.js';

export default class Config extends Command {
  static description = 'Manage n8m configuration';

  static flags = {
    'n8n-url': Flags.string({ description: 'Set n8n Instance URL' }),
    'n8n-key': Flags.string({ description: 'Set n8n API Key' }),
  };

  async run(): Promise<void> {
    this.log(theme.brand());
    const { flags } = await this.parse(Config);
    const config = await ConfigManager.load();

    if (Object.keys(flags).length === 0) {
      this.log(theme.header('CURRENT CONFIGURATION'));
      
      this.log(`${theme.label('Session')} ${config.accessToken ? theme.success('Active') : theme.muted('Inactive')}`);
      this.log(`${theme.label('n8n URL')} ${config.n8nUrl ? theme.value(config.n8nUrl) : theme.muted('Not set')}`);
      this.log(`${theme.label('n8n Key')} ${config.n8nKey ? theme.value('********') : theme.muted('Not set')}`);
      
      this.log(theme.divider(40));
      return;
    }

    // Update config
    if (flags['n8n-url']) config.n8nUrl = flags['n8n-url'];
    if (flags['n8n-key']) config.n8nKey = flags['n8n-key'];

    await ConfigManager.save(config);
    this.log(theme.done('Configuration updated successfully'));
  }
}
