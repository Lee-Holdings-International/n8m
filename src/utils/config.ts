import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import keytar from 'keytar';

export interface N8mConfig {
  apiKey?: string;
  n8nUrl?: string;
  n8nKey?: string;
}

const SERVICE_NAME = 'n8m-cli';
const ACCOUNT_API_KEY = 'saas-api-key';
const ACCOUNT_N8N_KEY = 'n8n-api-key';

export class ConfigManager {
  private static configDir = path.join(os.homedir(), '.n8m');
  private static configFile = path.join(os.homedir(), '.n8m', 'config.json');

  private static async getFileConfig(): Promise<Partial<N8mConfig>> {
    try {
      const data = await fs.readFile(this.configFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  static async load(): Promise<N8mConfig> {
    const fileConfig = await this.getFileConfig();
    
    // Load secrets from keychain
    const apiKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_API_KEY);
    const n8nKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_N8N_KEY);

    // Prioritize keychain, fallback to file (for backward compatibility/migration source)
    // Actually, we merge them, but keychain takes precedence if we want to enforce it.
    // But logically, if we migrated, file won't have it.
    
    return {
      ...fileConfig,
      ...(apiKey ? { apiKey } : {}),
      ...(n8nKey ? { n8nKey } : {}),
    };
  }

  static async save(config: N8mConfig): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    
    const existingFile = await this.getFileConfig();

    // 1. Handle Secrets (Migration & Saving)
    // Check if we need to save/migrate apiKey
    let apiKeyToSave = config.apiKey;
    if (!apiKeyToSave && (existingFile as any).apiKey) {
        apiKeyToSave = (existingFile as any).apiKey;
    }
    if (apiKeyToSave) {
        await keytar.setPassword(SERVICE_NAME, ACCOUNT_API_KEY, apiKeyToSave);
    }

    // Check if we need to save/migrate n8nKey
    let n8nKeyToSave = config.n8nKey;
    if (!n8nKeyToSave && (existingFile as any).n8nKey) {
        n8nKeyToSave = (existingFile as any).n8nKey;
    }
    if (n8nKeyToSave) {
        await keytar.setPassword(SERVICE_NAME, ACCOUNT_N8N_KEY, n8nKeyToSave);
    }

    // 2. Handle URL
    const newUrl = config.n8nUrl ?? existingFile.n8nUrl;

    // 3. Write File (Cleaned of secrets)
    const newFileConfig = {
        n8nUrl: newUrl
    };

    await fs.writeFile(this.configFile, JSON.stringify(newFileConfig, null, 2));
  }
}
