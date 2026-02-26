import { Command, Flags } from '@oclif/core';
import { theme } from '../utils/theme.js';
import { ConfigManager } from '../utils/config.js';

export default class Config extends Command {
  static description = 'Manage n8m configuration';

  static flags = {
    'n8n-url': Flags.string({ description: 'Set n8n Instance URL' }),
    'n8n-key': Flags.string({ description: 'Set n8n API Key' }),
    'ai-key': Flags.string({ description: 'Set AI API Key (used for all AI features)' }),
    'ai-provider': Flags.string({ description: 'Set AI provider (openai, anthropic, gemini)' }),
    'ai-model': Flags.string({ description: 'Set AI model name (e.g. gpt-4o, claude-sonnet-4-6)' }),
    'ai-base-url': Flags.string({ description: 'Set custom AI base URL (for OpenAI-compatible endpoints)' }),
  };

  async run(): Promise<void> {
    this.log(theme.brand());
    const { flags } = await this.parse(Config);
    const config = await ConfigManager.load();

    if (Object.keys(flags).length === 0) {
      this.log(theme.header('CURRENT CONFIGURATION'));

      this.log(theme.label('— n8n —'));
      this.log(`${theme.label('n8n URL')}      ${config.n8nUrl ? theme.value(config.n8nUrl) : theme.muted('Not set')}`);
      this.log(`${theme.label('n8n Key')}      ${config.n8nKey ? theme.value('********') : theme.muted('Not set')}`);

      this.log(theme.label('— AI —'));
      this.log(`${theme.label('AI Provider')}  ${config.aiProvider ? theme.value(config.aiProvider) : theme.muted('Not set (defaults to openai)')}`);
      this.log(`${theme.label('AI Key')}       ${config.aiKey ? theme.value('********') : theme.muted('Not set')}`);
      this.log(`${theme.label('AI Model')}     ${config.aiModel ? theme.value(config.aiModel) : theme.muted('Not set (uses provider default)')}`);
      this.log(`${theme.label('AI Base URL')}  ${config.aiBaseUrl ? theme.value(config.aiBaseUrl) : theme.muted('Not set')}`);

      this.log(theme.divider(40));
      return;
    }

    // Update config
    if (flags['n8n-url']) config.n8nUrl = flags['n8n-url'];
    if (flags['n8n-key']) config.n8nKey = flags['n8n-key'];
    if (flags['ai-key']) config.aiKey = flags['ai-key'];
    if (flags['ai-provider']) config.aiProvider = flags['ai-provider'];
    if (flags['ai-model']) config.aiModel = flags['ai-model'];
    if (flags['ai-base-url']) config.aiBaseUrl = flags['ai-base-url'];

    await ConfigManager.save(config);
    this.log(theme.done('Configuration updated successfully'));
  }
}
