import { Command } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../utils/config.js';

export default class Balance extends Command {
  static description = 'Check your remaining credits';

  async run(): Promise<void> {
    const config = await ConfigManager.load();
    const apiUrl = process.env.N8N_API_URL || 'http://localhost:3000/api/v1';

    if (!config.apiKey) {
      this.error('Not logged in. Run \'n8m login\' first.');
    }

    try {
      const response = await fetch(`${apiUrl}/balance`, {
        headers: {
          'X-API-KEY': config.apiKey,
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
      
      this.log(chalk.bold('💰 Your Balance:'));
      
      if (data.credits > 5) {
         this.log(chalk.green(`   ${data.credits} credits available`));
      } else if (data.credits > 0) {
         this.log(chalk.yellow(`   ${data.credits} credits remaining (low)`));
      } else {
         this.log(chalk.red(`   ${data.credits} credits. Top up required.`));
      }

    } catch (error) {
      this.error(`Failed to fetch balance: ${(error as Error).message}`);
    }
  }
}
