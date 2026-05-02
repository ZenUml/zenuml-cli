import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BasicResolvedConfig, OAuthResolvedConfig, ResolvedConfig, StoredConfig } from './types.js';

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
      authMethod: parsed.authMethod,
      site: parsed.site,
      email: parsed.email,
      apiToken: parsed.apiToken,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      oauthClientId: parsed.oauthClientId,
      oauthClientSecret: parsed.oauthClientSecret,
      cloudId: parsed.cloudId,
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
    const expiresAtFromEnv = parseNumber(process.env.ZENUML_CLI_EXPIRES_AT);
    const merged: StoredConfig = {
      authMethod: overrides.authMethod ?? asAuthMethod(process.env.ZENUML_CLI_AUTH_METHOD) ?? stored.authMethod,
      site: overrides.site ?? process.env.ZENUML_CLI_SITE ?? stored.site,
      email: overrides.email ?? process.env.ZENUML_CLI_EMAIL ?? stored.email,
      apiToken: overrides.apiToken ?? process.env.ZENUML_CLI_API_TOKEN ?? stored.apiToken,
      accessToken: overrides.accessToken ?? process.env.ZENUML_CLI_ACCESS_TOKEN ?? stored.accessToken,
      refreshToken: overrides.refreshToken ?? process.env.ZENUML_CLI_REFRESH_TOKEN ?? stored.refreshToken,
      expiresAt: overrides.expiresAt ?? expiresAtFromEnv ?? stored.expiresAt,
      oauthClientId: overrides.oauthClientId ?? process.env.ZENUML_CLI_OAUTH_CLIENT_ID ?? stored.oauthClientId,
      oauthClientSecret:
        overrides.oauthClientSecret ?? process.env.ZENUML_CLI_OAUTH_CLIENT_SECRET ?? stored.oauthClientSecret,
      cloudId: overrides.cloudId ?? process.env.ZENUML_CLI_CLOUD_ID ?? stored.cloudId,
      addonKey: overrides.addonKey ?? process.env.ZENUML_CLI_ADDON_KEY ?? stored.addonKey,
    };

    const selectedMethod = pickAuthMethod(merged);

    if (selectedMethod === 'oauth') {
      return resolveOAuthConfig(merged);
    }

    return resolveBasicConfig(merged);
  });
}

function resolveBasicConfig(merged: StoredConfig): BasicResolvedConfig {
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
    authMethod: 'basic',
    site: normalizeSiteUrl(merged.site),
    email: merged.email,
    apiToken: merged.apiToken,
    addonKey: merged.addonKey,
  };
}

function resolveOAuthConfig(merged: StoredConfig): OAuthResolvedConfig {
  if (!merged.site) {
    throw new Error('Missing site URL. Provide --site, set ZENUML_CLI_SITE, or run `zenuml auth login-oauth`.');
  }

  if (!merged.oauthClientId) {
    throw new Error(
      'Missing OAuth client ID. Provide --client-id, set ZENUML_CLI_OAUTH_CLIENT_ID, or run `zenuml auth login-oauth`.',
    );
  }

  if (!merged.accessToken) {
    throw new Error(
      'Missing OAuth access token. Run `zenuml auth login-oauth` or set ZENUML_CLI_ACCESS_TOKEN for one-off calls.',
    );
  }

  if (!merged.refreshToken) {
    throw new Error(
      'Missing OAuth refresh token. Run `zenuml auth login-oauth` or set ZENUML_CLI_REFRESH_TOKEN for one-off calls.',
    );
  }

  if (!merged.expiresAt || !Number.isFinite(merged.expiresAt)) {
    throw new Error(
      'Missing OAuth token expiry timestamp. Run `zenuml auth login-oauth` or set ZENUML_CLI_EXPIRES_AT.',
    );
  }

  if (!merged.cloudId) {
    throw new Error(
      'Missing Confluence cloud ID for OAuth. Run `zenuml auth login-oauth` to discover it automatically.',
    );
  }

  return {
    authMethod: 'oauth',
    site: normalizeSiteUrl(merged.site),
    accessToken: merged.accessToken,
    refreshToken: merged.refreshToken,
    expiresAt: merged.expiresAt,
    oauthClientId: merged.oauthClientId,
    oauthClientSecret: merged.oauthClientSecret,
    cloudId: merged.cloudId,
    addonKey: merged.addonKey,
  };
}

function pickAuthMethod(config: StoredConfig): 'basic' | 'oauth' {
  if (config.authMethod === 'oauth') {
    return 'oauth';
  }

  if (config.authMethod === 'basic') {
    return 'basic';
  }

  if (config.accessToken || config.refreshToken || config.oauthClientId || config.cloudId) {
    return 'oauth';
  }

  return 'basic';
}

function asAuthMethod(value: string | undefined): 'basic' | 'oauth' | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'basic' || value === 'oauth') {
    return value;
  }

  throw new Error(`Invalid auth method "${value}". Expected "basic" or "oauth".`);
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value "${value}".`);
  }

  return parsed;
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
