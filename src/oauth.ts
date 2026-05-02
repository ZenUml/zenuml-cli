import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';

import { normalizeSiteUrl } from './config.js';

const ATLASSIAN_AUTH_BASE = 'https://auth.atlassian.com';
const ATLASSIAN_API_BASE = 'https://api.atlassian.com';
const DEFAULT_CALLBACK_PORT = 53682;
export const DEFAULT_OAUTH_CLIENT_ID = 'J6mcQVkGjqWivdxim0bSzXROMT8QCR48';
// Atlassian requires a client_secret even for PKCE flows with native/CLI apps.
// Embedding it here is intentional and safe: for public clients the secret provides no
// meaningful security boundary (it cannot be kept confidential in a distributed binary).
// Its only role is to identify this app to Atlassian — the same purpose served by the
// client_id. Users who register their own Atlassian OAuth app can override both via
// --client-id / --client-secret flags or the corresponding environment variables.
export const DEFAULT_OAUTH_CLIENT_SECRET = 'ATOAc_HURFOuEFhLsolEaJxlg2h3fo-1JG_ETgbBqLna8a0B7a7jm_-8z2dNfNTwvUFc507C712F';
// Granular OAuth 2.0 scopes required by Confluence API v2.
// These replace the classic scopes (read:confluence-content.all etc.)
// which are not accepted by API v2 endpoints.
const DEFAULT_OAUTH_SCOPES = [
  'read:custom-content:confluence',
  'write:custom-content:confluence',
  'read:space:confluence',
  'read:user:confluence',
  'offline_access',
];

export interface OAuthLoginOptions {
  site: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  timeoutMs?: number;
  callbackPort?: number;
}

export interface OAuthLoginResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  cloudId: string;
  scope?: string;
  tokenType?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface AccessibleResource {
  id: string;
  url: string;
  name?: string;
}

export async function runOAuthLogin(options: OAuthLoginOptions): Promise<OAuthLoginResult> {
  const site = normalizeSiteUrl(options.site);
  const scopes = options.scopes && options.scopes.length > 0 ? options.scopes : DEFAULT_OAUTH_SCOPES;

  const verifier = toBase64Url(randomBytes(64));
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest());
  const state = toBase64Url(randomBytes(24));

  const callbackPort = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
  const callback = await createCallbackServer(state, callbackPort, options.timeoutMs ?? 180000);
  const redirectUri = `http://127.0.0.1:${callback.port}/oauth/callback`;

  const authUrl = new URL(`${ATLASSIAN_AUTH_BASE}/authorize`);
  authUrl.searchParams.set('audience', 'api.atlassian.com');
  authUrl.searchParams.set('client_id', options.clientId);
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  process.stderr.write('Opening browser for Atlassian OAuth login...\n');
  process.stderr.write(`If it does not open automatically, visit:\n${authUrl.toString()}\n`);
  openBrowser(authUrl.toString());

  let authCode: string;
  try {
    authCode = await callback.waitForCode;
  } finally {
    callback.server.close();
  }

  const token = await exchangeAuthorizationCode({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    code: authCode,
    redirectUri,
    codeVerifier: verifier,
  });

  const cloudId = await resolveCloudIdForSite(token.accessToken, site);

  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
    cloudId,
    scope: token.scope,
    tokenType: token.tokenType,
  };
}

export async function refreshOAuthToken(options: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}): Promise<OAuthLoginResult> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    client_id: options.clientId,
    refresh_token: options.refreshToken,
  };

  if (options.clientSecret) {
    body.client_secret = options.clientSecret;
  }

  const response = await fetch(`${ATLASSIAN_AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json() as OAuthTokenResponse;
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    const message = payload.error_description ?? payload.error ?? response.statusText;
    throw new Error(`OAuth refresh failed: ${message}`);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? options.refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1000,
    cloudId: '',
    scope: payload.scope,
    tokenType: payload.token_type,
  };
}

async function resolveCloudIdForSite(accessToken: string, site: string): Promise<string> {
  const response = await fetch(`${ATLASSIAN_API_BASE}/oauth/token/accessible-resources`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to resolve accessible resources (${response.status} ${response.statusText}): ${body}`);
  }

  const resources = await response.json() as AccessibleResource[];
  const normalizedSite = normalizeSiteUrl(site);
  const match = resources.find((resource) => normalizeSiteUrl(resource.url) === normalizedSite);

  if (!match) {
    const knownSites = resources.map((item) => item.url).join(', ') || '<none>';
    throw new Error(`OAuth app has no access to ${site}. Accessible sites: ${knownSites}`);
  }

  return match.id;
}

async function exchangeAuthorizationCode(options: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope?: string; tokenType?: string }> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: options.clientId,
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  };

  if (options.clientSecret) {
    body.client_secret = options.clientSecret;
  }

  process.stderr.write(`Exchanging authorization code at ${ATLASSIAN_AUTH_BASE}/oauth/token...\n`);
  process.stderr.write(`  grant_type=authorization_code client_id=${options.clientId} redirect_uri=${options.redirectUri}\n`);

  const response = await fetch(`${ATLASSIAN_AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const rawBody = await response.text();
  process.stderr.write(`  Token endpoint response: ${response.status} ${response.statusText}\n`);
  process.stderr.write(`  Body: ${rawBody}\n`);

  let payload: OAuthTokenResponse = {};
  try {
    payload = JSON.parse(rawBody) as OAuthTokenResponse;
  } catch {
    // non-JSON body — rawBody already logged above
  }

  if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.expires_in) {
    const message = payload.error_description ?? payload.error ?? rawBody ?? response.statusText;
    throw new Error(`OAuth token exchange failed: ${message}`);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    scope: payload.scope,
    tokenType: payload.token_type,
  };
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function openBrowser(url: string): void {
  const platform = process.platform;

  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return;
  }

  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }

  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

async function createCallbackServer(state: string, port: number, timeoutMs: number): Promise<{
  port: number;
  server: Server;
  waitForCode: Promise<string>;
}> {
  let resolved = false;
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;

  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

    if (requestUrl.pathname !== '/oauth/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found.');
      return;
    }

    const incomingState = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');
    const error = requestUrl.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('OAuth authorization failed. You can close this tab and return to the terminal.');
      if (!resolved) {
        resolved = true;
        rejectCode(new Error(`OAuth authorization failed: ${error}`));
      }
      return;
    }

    if (!code || !incomingState || incomingState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid OAuth callback. You can close this tab and return to the terminal.');
      if (!resolved) {
        resolved = true;
        rejectCode(new Error('OAuth callback validation failed. State mismatch or missing authorization code.'));
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OAuth login completed. You can close this tab and return to the terminal.');

    if (!resolved) {
      resolved = true;
      resolveCode(code);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      rejectCode(new Error(`Timed out waiting for OAuth callback after ${Math.floor(timeoutMs / 1000)} seconds.`));
      server.close();
    }
  }, timeoutMs);

  waitForCode.finally(() => clearTimeout(timeout)).catch(() => undefined);

  return {
    port: address.port,
    server,
    waitForCode,
  };
}
