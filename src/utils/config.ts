import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import keytar from 'keytar';

export interface N8mConfig {
  accessToken?: string;
  refreshToken?: string;
  n8nUrl?: string;
  n8nKey?: string;
}

const SERVICE_NAME = 'n8m-cli';
const ACCOUNT_ACCESS_TOKEN = 'saas-access-token';
const ACCOUNT_REFRESH_TOKEN = 'saas-refresh-token';
const ACCOUNT_N8N_KEY = 'n8n-api-key';

// Deprecated
const LEGACY_API_KEY = 'saas-api-key';

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
    const accessToken = await keytar.getPassword(SERVICE_NAME, ACCOUNT_ACCESS_TOKEN);
    const refreshToken = await keytar.getPassword(SERVICE_NAME, ACCOUNT_REFRESH_TOKEN);
    const n8nKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_N8N_KEY);

    return {
      ...fileConfig,
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      ...(n8nKey ? { n8nKey } : {}),
    };
  }

  static async save(config: Partial<N8mConfig>): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    
    const existingFile = await this.getFileConfig();

    // 1. Handle Secrets (Keychain only)
    if (config.accessToken !== undefined) {
        if (config.accessToken) {
            await keytar.setPassword(SERVICE_NAME, ACCOUNT_ACCESS_TOKEN, config.accessToken);
        } else {
            await keytar.deletePassword(SERVICE_NAME, ACCOUNT_ACCESS_TOKEN);
        }
    }

    if (config.refreshToken !== undefined) {
        if (config.refreshToken) {
            await keytar.setPassword(SERVICE_NAME, ACCOUNT_REFRESH_TOKEN, config.refreshToken);
        } else {
            await keytar.deletePassword(SERVICE_NAME, ACCOUNT_REFRESH_TOKEN);
        }
    }

    if (config.n8nKey !== undefined) {
        if (config.n8nKey) {
            await keytar.setPassword(SERVICE_NAME, ACCOUNT_N8N_KEY, config.n8nKey);
        } else {
            await keytar.deletePassword(SERVICE_NAME, ACCOUNT_N8N_KEY);
        }
    }

    // 2. Handle Non-Secrets (File only)
    const newFileConfig = {
        ...existingFile,
        ...(config.n8nUrl !== undefined ? { n8nUrl: config.n8nUrl } : {})
    };

    // Remove secrets from file memory just in case they were migrated/stuck
    delete (newFileConfig as any).accessToken;
    delete (newFileConfig as any).refreshToken;
    delete (newFileConfig as any).n8nKey;
    delete (newFileConfig as any).apiKey;

    await fs.writeFile(this.configFile, JSON.stringify(newFileConfig, null, 2));
    
    // Cleanup legacy key if exists
    await keytar.deletePassword(SERVICE_NAME, LEGACY_API_KEY);
  }

  static async clear(): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_ACCESS_TOKEN);
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_REFRESH_TOKEN);
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_N8N_KEY);
    await keytar.deletePassword(SERVICE_NAME, LEGACY_API_KEY);
    
    const existingFile = await this.getFileConfig();
    const newFileConfig = {
        n8nUrl: existingFile.n8nUrl
    };
    
    await fs.writeFile(this.configFile, JSON.stringify(newFileConfig, null, 2));
  }
}


