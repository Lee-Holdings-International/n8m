import { Command } from '@oclif/core';
import { theme } from '../utils/theme.js';
import { ConfigManager } from '../utils/config.js';

export default class Balance extends Command {
  static description = 'Check your remaining credits';

  async run(): Promise<void> {
    this.log(theme.brand());
    const config = await ConfigManager.load();
    const apiUrl = process.env.N8M_API_URL || 'http://localhost:3000/api/v1';

    if (!config.accessToken) {
      this.error('Not logged in. Run \'n8m login\' first.');
    }

    try {
      this.log(theme.agent('Fetching account details from System...'));
      
      const response = await fetch(`${apiUrl}/balance`, {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 401) {
        this.error('Invalid API Key. Please log in again.');
      }

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json() as { credits: number };
      
      this.log('\n' + theme.primary.bold('◆ CREDITS BALANCE'));
      this.log(theme.divider(30));
      
      this.log(`${theme.label('Total Available')} ${theme.value(data.credits)}`);
      
      let status = '';
      if (data.credits > 5) {
         status = theme.success('Healthy');
      } else if (data.credits > 0) {
         status = theme.warning('Low Balance');
      } else {
         status = theme.error('Empty');
      }
      
      this.log(`${theme.label('Status')} ${status}`);
      this.log(theme.divider(30));

    } catch (error) {
      this.error(`Failed to fetch balance: ${(error as Error).message}`);
    }
  }
}
