import { Command } from '@oclif/core';
import open from 'open';
import http from 'http';
import { ConfigManager } from '../utils/config.js';

export default class Login extends Command {
  static description = 'Authenticate with the n8m platform';

  async run(): Promise<void> {
    const serverPort = 8910;
    const apiUrl = process.env.N8M_API_URL || 'http://localhost:3000/api/v1'; // Default to local dev
    const loginUrl = `${apiUrl}/auth/login?redirect_port=${serverPort}`;

    this.log('Waiting for authentication...');

    // 1. Start Local Server
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      
      if (url.pathname === '/callback') {
        const apiKey = url.searchParams.get('key');
        
        if (apiKey) {
          // 2. Save Key
          await ConfigManager.save({ apiKey });
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Login Successful!</h1><p>You can close this tab and return to the CLI.</p><script>setTimeout(() => window.close(), 2000)</script>');
          
          this.log('✅ Successfully logged in!');
          server.close();
          process.exit(0);
        } else {
          res.writeHead(400);
          res.end('Missing API Key in callback');
          this.log('❌ Login failed: Missing key');
          server.close();
          process.exit(1);
        }
      }
    });

    server.listen(serverPort, async () => {
      // 3. Open Browser
      this.log(`Opening browser to: ${loginUrl}`);
      await open(loginUrl);
    });
  }
}
