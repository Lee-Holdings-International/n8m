import { Command } from '@oclif/core';
import { theme } from '../utils/theme.js';
import { ConfigManager } from '../utils/config.js';
import open from 'open';

export default class Logout extends Command {
  static description = 'Terminate session and scrub local credentials';

  async run(): Promise<void> {
    this.log(theme.brand());
    this.log(theme.header('SESSION TERMINATION'));

    // 0. Check if logged in
    const config = await ConfigManager.load();
    if (!config.accessToken) {
      this.log(theme.info('No active session found. You are already logged out.'));
      return;
    }


    this.log(theme.info('Scrubbing local credentials...'));

    try {
      const config = await ConfigManager.load();
      if (config.accessToken) {
         this.log(theme.info('Notifying server to invalidate session...'));
         const apiUrl = process.env.N8M_API_URL || 'http://localhost:3000/api/v1';
         
         try {
           const { default: fetch } = await import('node-fetch');
           const response = await fetch(`${apiUrl}/auth/logout`, {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${config.accessToken}`
             },
             body: JSON.stringify({})
           });
           
           if (!response.ok) {
             this.log(theme.warn(`Server logout failed: ${response.statusText}. Proceeding with local cleanup.`));
           } else {
             this.log(theme.done('Server session invalidated.'));
           }
         } catch (netError) {
            this.log(theme.warn(`Network error during logout: ${(netError as Error).message}. Proceeding with local cleanup.`));
         }
      }

      // Clear local config
      await ConfigManager.clear();
      
      this.log(theme.done('Keychain credentials scrubbed.'));
      this.log(theme.done('Local configuration file cleaned.'));
      this.log(theme.done('Session terminated successfully.'));
      
    } catch (error) {
      this.log(theme.fail('Failed to clear session: ' + (error instanceof Error ? error.message : String(error))));
      this.exit(1);
    }
  }
}
