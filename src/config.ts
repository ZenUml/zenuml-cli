import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ResolvedConfig, StoredConfig } from './types.js';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.zenuml-cli.json');

function getConfigPath(): string {
  return process.env.ZENUML_CLI_CONFIG || DEFAULT_CONFIG_PATH;
}

export async function loadStoredConfig(): Promise<StoredConfig> {
  const configPath = getConfigPath();

  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as StoredConfig;

    return {
      site: parsed.site,
      email: parsed.email,
      apiToken: parsed.apiToken,
      addonKey: parsed.addonKey,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    throw new Error(`Failed to read CLI config at ${configPath}: ${(error as Error).message}`);
  }
}

export async function saveStoredConfig(config: StoredConfig): Promise<string> {
  const configPath = getConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

export async function clearStoredConfig(): Promise<void> {
  const configPath = getConfigPath();
  await rm(configPath, { force: true });
}

export function resolveConfig(overrides: StoredConfig): Promise<ResolvedConfig> {
  return loadStoredConfig().then((stored) => {
    const merged: StoredConfig = {
      site: overrides.site ?? process.env.ZENUML_CLI_SITE ?? stored.site,
      email: overrides.email ?? process.env.ZENUML_CLI_EMAIL ?? stored.email,
      apiToken: overrides.apiToken ?? process.env.ZENUML_CLI_API_TOKEN ?? stored.apiToken,
      addonKey: overrides.addonKey ?? process.env.ZENUML_CLI_ADDON_KEY ?? stored.addonKey,
    };

    if (!merged.site) {
      throw new Error('Missing site URL. Provide --site, set ZENUML_CLI_SITE, or run `zenuml auth login`.');
    }

    if (!merged.email) {
      throw new Error('Missing email. Provide --email, set ZENUML_CLI_EMAIL, or run `zenuml auth login`.');
    }

    if (!merged.apiToken) {
      throw new Error('Missing API token. Provide --api-token, set ZENUML_CLI_API_TOKEN, or run `zenuml auth login`.');
    }

    return {
      site: normalizeSiteUrl(merged.site),
      email: merged.email,
      apiToken: merged.apiToken,
      addonKey: merged.addonKey,
    };
  });
}

export function normalizeSiteUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    throw new Error(`Invalid site URL "${value}". Include https://.`);
  }
  return normalized.endsWith('/wiki') ? normalized.slice(0, -5) : normalized;
}

export function maskToken(token: string): string {
  if (token.length <= 8) {
    return '*'.repeat(token.length);
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function getConfigPathForDisplay(): string {
  return getConfigPath();
}
