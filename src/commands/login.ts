import { Command } from '@oclif/core';
import { theme } from '../utils/theme.js';
import open from 'open';
import http from 'http';
import { ConfigManager } from '../utils/config.js';
import { getSuccessPageHtml } from '../ui/success-page.js';


export default class Login extends Command {
  static description = 'Authenticate with the n8m platform';

  async run(): Promise<void> {
    const serverPort = 8910;
    const apiUrl = process.env.N8M_API_URL || 'http://localhost:3000/api/v1'; 
    const loginUrl = `${apiUrl}/auth/login?redirect_port=${serverPort}`;

    this.log(theme.brand());
    this.log(theme.header('PLATFORM AUTHENTICATION'));

    // 0. Check for existing session
    const config = await ConfigManager.load();
    if (config.accessToken) {
      this.log(theme.warn('Active session detected. You are already logged in.'));
      this.log(theme.info('To switch accounts, run: ' + theme.secondary('n8m logout')));
      return;
    }


    this.log(theme.info('Opening login page...'));


    // 1. Start Local Server
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      
      if (url.pathname === '/callback') {
        const accessToken = url.searchParams.get('access_token');
        const refreshToken = url.searchParams.get('refresh_token');
        
        if (accessToken) {
          await ConfigManager.save({ accessToken, refreshToken: refreshToken || undefined });
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getSuccessPageHtml(accessToken));

          
          this.log(theme.done('Login successful.'));
          server.close();
          process.exit(0);
        } else {
          res.writeHead(400);
          res.end('Missing tokens in callback');
          this.log(theme.fail('Authentication failed: Missing tokens'));
          server.close();
          process.exit(1);
        }
      }
    });

    server.listen(serverPort, async () => {
      this.log(theme.agent(`Opening browser to endpoint: ${theme.secondary(apiUrl)}`));
      await open(loginUrl);
    });
  }
}
