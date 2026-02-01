import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface ColorToken {
  value: string;
}

interface DesignTokens {
  colors: {
    primary: ColorToken;
    secondary: ColorToken;
    background: ColorToken;
    foreground: ColorToken;
    mutedForeground: ColorToken;
    card: ColorToken;
    semantic: {
      success: ColorToken;
      warning: ColorToken;
      error: ColorToken;
      aiProcessing: ColorToken;
    };
  };
}

let tokens: DesignTokens;
const rootPath = join(__dirname, '../../');
const tokensPath = join(rootPath, 'design-tokens.json');

try {
  if (existsSync(tokensPath)) {
    tokens = JSON.parse(readFileSync(tokensPath, 'utf-8'));
  } else {
    throw new Error('Tokens file not found');
  }
} catch (error) {
  // Fallback tokens matching the user's file
  tokens = {
    colors: {
      primary: { value: '#10B981' },
      secondary: { value: '#6366F1' },
      background: { value: '#0F172A' },
      foreground: { value: '#F1F5F9' },
      mutedForeground: { value: '#94A3B8' },
      card: { value: '#1E293B' },
      semantic: {
        success: { value: '#10B981' },
        warning: { value: '#F59E0B' },
        error: { value: '#EF4444' },
        aiProcessing: { value: '#A855F7' },
      },
    },
  };
}

const c = {
  primary: chalk.hex(tokens.colors.primary.value),
  secondary: chalk.hex(tokens.colors.secondary.value),
  muted: chalk.hex(tokens.colors.mutedForeground.value),
  foreground: chalk.hex(tokens.colors.foreground.value),
  success: chalk.hex(tokens.colors.semantic.success.value),
  warning: chalk.hex(tokens.colors.semantic.warning.value),
  error: chalk.hex(tokens.colors.semantic.error.value),
  ai: chalk.hex(tokens.colors.semantic.aiProcessing.value),
  card: chalk.hex(tokens.colors.card.value),
};

export const theme = {
  ...c,
  
  // Layout helpers
  divider: (len = 60) => c.muted('━'.repeat(len)),
  
  header: (text: string) => {
    return `\n${c.primary.bold('◆ ' + text)}\n${c.muted('━'.repeat(text.length + 4))}`;
  },

  subHeader: (text: string) => {
    return `\n${c.secondary.bold(text)}`;
  },

  // Field styling
  label: (text: string) => c.secondary(text.padEnd(15)),
  value: (text: string | number | boolean) => c.foreground(text.toString()),
  
  // Semantic status
  info: (text: string) => c.primary('ℹ ') + c.foreground(text),
  done: (text: string) => c.success('✔ ') + c.foreground(text),
  warn: (text: string) => c.warning('⚠ ') + c.foreground(text),
  fail: (text: string) => c.error('✘ ') + c.foreground(text),
  
  // AI/Agentic
  agent: (text: string) => c.ai('✧ ') + c.ai.italic(text),

  // Brand/Banner
  brand: () => {
    const bannerPath = join(rootPath, 'banner.txt');
    if (existsSync(bannerPath)) {
      const banner = readFileSync(bannerPath, 'utf-8');
      const lines = banner.split('\n');
      
      // Calculate a smoother line-by-line gradient between secondary and primary
      // Secondary: Indigo, Primary: Emerald
      return lines.map((line, i) => {
          if (!line.trim()) return '';
          const ratio = i / Math.max(lines.length - 1, 1);
          
          // Simple interpolation between #6366F1 and #10B981
          // We'll use 3 steps for simplicity given it's line based
          if (ratio < 0.33) return c.secondary(line);
          if (ratio < 0.66) return chalk.hex('#3A90B9')(line); // Midpoint between Indigo and Emerald
          return c.primary(line);
      }).join('\n');
    }
    return c.primary.bold('N8M CLI');
  },

  // Badge/Tag
  tag: (text: string) => chalk.bgHex(tokens.colors.primary.value).hex(tokens.colors.background.value).bold(` ${text} `)
};
