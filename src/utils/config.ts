import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

export interface N8mConfig {
  n8nUrl?: string;
  n8nKey?: string;
  aiKey?: string;
  aiProvider?: string;
  aiModel?: string;
  aiBaseUrl?: string;
}

export class ConfigManager {
  private static configDir = path.join(os.homedir(), '.n8m');
  private static configFile = path.join(os.homedir(), '.n8m', 'config.json');

  static async load(): Promise<N8mConfig> {
    dotenv.config({ quiet: true }); // Load .env from cwd if present (no-op if already loaded or file missing)
    try {
      const data = await fs.readFile(this.configFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  static async save(config: Partial<N8mConfig>): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    const existing = await this.load();
    const merged = { ...existing, ...config };
    await fs.writeFile(this.configFile, JSON.stringify(merged, null, 2));
  }

  static async clear(): Promise<void> {
    await fs.writeFile(this.configFile, JSON.stringify({}, null, 2));
  }
}
