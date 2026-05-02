#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  clearStoredConfig,
  getConfigPathForDisplay,
  loadStoredConfig,
  maskToken,
  normalizeSiteUrl,
  resolveConfig,
  saveStoredConfig,
} from './config.js';
import { ConfluenceClient } from './confluenceClient.js';
import { extractDiagramContent, normalizeDiagramType, parseDiagramInput, readDiagramInput } from './diagram.js';
import { printRecord, printRecords } from './format.js';
import { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET, runOAuthLogin } from './oauth.js';
import { DiagramType, ExportFormat, OutputFormat, StoredConfig } from './types.js';

function printHelp(): void {
  console.log(`zenuml CLI

Usage:
  zenuml auth login --site <url> --email <email> --api-token <token> [--addon-key <key>]
  zenuml auth login-oauth --site <url> --client-id <id> [--client-secret <secret>] [--timeout-ms <ms>] [--callback-port <port>] [--addon-key <key>]
  zenuml auth whoami
  zenuml auth logout
  zenuml diagram list [--space <spaceKey|spaceId>] [--page <pageId>] [--type <type>] [--limit <n>] [--format json|text]
  zenuml diagram get <id> [--format json|text]
  zenuml diagram create --page <pageId> --type <type> [--title <title>] (--file <path> | --stdin)
  zenuml diagram update <id> [--type <type>] [--title <title>] (--file <path> | --stdin)
  zenuml diagram delete <id> [--force]
  zenuml diagram export <id> [--format raw|json] [--output <path>]
`);
}

function parseCommonFlags(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      site: { type: 'string' },
      email: { type: 'string' },
      'api-token': { type: 'string' },
      'auth-method': { type: 'string' },
      'access-token': { type: 'string' },
      'refresh-token': { type: 'string' },
      'expires-at': { type: 'string' },
      'client-id': { type: 'string' },
      'client-secret': { type: 'string' },
      'cloud-id': { type: 'string' },
      scopes: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'callback-port': { type: 'string' },
      'addon-key': { type: 'string' },
      format: { type: 'string' },
      output: { type: 'string' },
      title: { type: 'string' },
      type: { type: 'string' },
      page: { type: 'string' },
      space: { type: 'string' },
      file: { type: 'string' },
      stdin: { type: 'boolean', default: false },
      limit: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

function buildOverrides(values: Record<string, string | boolean | undefined>): StoredConfig {
  const expiresAtRaw = values['expires-at'] as string | undefined;
  const expiresAt = expiresAtRaw ? Number.parseInt(expiresAtRaw, 10) : undefined;

  return {
    authMethod: values['auth-method'] as 'basic' | 'oauth' | undefined,
    site: values.site as string | undefined,
    email: values.email as string | undefined,
    apiToken: values['api-token'] as string | undefined,
    accessToken: values['access-token'] as string | undefined,
    refreshToken: values['refresh-token'] as string | undefined,
    expiresAt,
    oauthClientId: values['client-id'] as string | undefined,
    oauthClientSecret: values['client-secret'] as string | undefined,
    cloudId: values['cloud-id'] as string | undefined,
    addonKey: values['addon-key'] as string | undefined,
  };
}

function parseScopes(input: string | undefined): string[] | undefined {
  if (!input) {
    return undefined;
  }

  const values = input
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function asOutputFormat(value: string | undefined): OutputFormat {
  if (!value || value === 'text' || value === 'json') {
    return (value ?? 'text') as OutputFormat;
  }
  throw new Error(`Unsupported output format "${value}". Expected "text" or "json".`);
}

function asExportFormat(value: string | undefined): ExportFormat {
  if (!value || value === 'raw' || value === 'json') {
    return (value ?? 'raw') as ExportFormat;
  }
  throw new Error(`Unsupported export format "${value}". Expected "raw" or "json".`);
}

async function maybeWriteOutput(outputPath: string | undefined, content: string): Promise<void> {
  if (outputPath) {
    await writeFile(outputPath, content, 'utf8');
    console.log(`Wrote ${outputPath}`);
    return;
  }

  process.stdout.write(content);
  if (!content.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

async function confirmDelete(id: string): Promise<void> {
  process.stdout.write(`Delete diagram ${id}? Type "yes" to confirm: `);

  const answer = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.resume();
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    process.stdin.on('error', reject);
  });

  if (answer !== 'yes') {
    throw new Error('Delete aborted.');
  }
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'auth') {
    const parsed = parseCommonFlags(rest);
    if (parsed.values.help) {
      printHelp();
      return;
    }

    if (subcommand === 'login') {
      const overrides = buildOverrides(parsed.values);
      const stored = await loadStoredConfig();
      const site = overrides.site ?? process.env.ZENUML_CLI_SITE ?? stored.site;
      const email = overrides.email ?? process.env.ZENUML_CLI_EMAIL ?? stored.email;
      const apiToken = overrides.apiToken ?? process.env.ZENUML_CLI_API_TOKEN ?? stored.apiToken;

      if (!site) {
        throw new Error('Missing site URL. Provide --site, set ZENUML_CLI_SITE, or run `zenuml auth login`.');
      }

      if (!email) {
        throw new Error('Missing email. Provide --email, set ZENUML_CLI_EMAIL, or run `zenuml auth login`.');
      }

      if (!apiToken) {
        throw new Error('Missing API token. Provide --api-token, set ZENUML_CLI_API_TOKEN, or run `zenuml auth login`.');
      }

      const resolved = {
        authMethod: 'basic' as const,
        site: normalizeSiteUrl(site),
        email,
        apiToken,
        addonKey: overrides.addonKey ?? stored.addonKey,
      };

      const configPath = await saveStoredConfig(resolved);
      console.log(`Saved credentials to ${configPath}`);
      console.log(`Site: ${resolved.site}`);
      console.log(`Email: ${resolved.email}`);
      console.log(`API token: ${maskToken(resolved.apiToken)}`);
      if (resolved.addonKey) {
        console.log(`Addon key: ${resolved.addonKey}`);
      }
      return;
    }

    if (subcommand === 'login-oauth') {
      const overrides = buildOverrides(parsed.values);
      const stored = await loadStoredConfig();
      const site = overrides.site ?? process.env.ZENUML_CLI_SITE ?? stored.site;
      const clientId =
        overrides.oauthClientId ?? process.env.ZENUML_CLI_OAUTH_CLIENT_ID ?? stored.oauthClientId ?? DEFAULT_OAUTH_CLIENT_ID;
      const clientSecret =
        overrides.oauthClientSecret ?? process.env.ZENUML_CLI_OAUTH_CLIENT_SECRET ?? stored.oauthClientSecret ??
        (clientId === DEFAULT_OAUTH_CLIENT_ID ? DEFAULT_OAUTH_CLIENT_SECRET : undefined);
      const scopes =
        parseScopes(parsed.values.scopes as string | undefined) ?? parseScopes(process.env.ZENUML_CLI_OAUTH_SCOPES);
      const timeoutMsRaw = parsed.values['timeout-ms'] as string | undefined;
      const timeoutMs = timeoutMsRaw ? Number.parseInt(timeoutMsRaw, 10) : undefined;
      const callbackPortRaw =
        (parsed.values['callback-port'] as string | undefined) ?? process.env.ZENUML_CLI_OAUTH_CALLBACK_PORT;
      const callbackPort = callbackPortRaw ? Number.parseInt(callbackPortRaw, 10) : undefined;

      if (!site) {
        throw new Error('Missing site URL. Provide --site or set ZENUML_CLI_SITE.');
      }


      if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        throw new Error(`Invalid --timeout-ms value "${timeoutMsRaw}".`);
      }

      if (callbackPort !== undefined && (!Number.isFinite(callbackPort) || callbackPort <= 0 || callbackPort > 65535)) {
        throw new Error(`Invalid --callback-port value "${callbackPortRaw}".`);
      }

      const oauth = await runOAuthLogin({
        site,
        clientId,
        clientSecret,
        scopes,
        timeoutMs,
        callbackPort,
      });

      const configPath = await saveStoredConfig({
        authMethod: 'oauth',
        site: normalizeSiteUrl(site),
        oauthClientId: clientId,
        oauthClientSecret: clientSecret,
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt,
        cloudId: oauth.cloudId,
        addonKey: overrides.addonKey ?? stored.addonKey,
      });

      console.log(`Saved OAuth credentials to ${configPath}`);
      console.log(`Site: ${normalizeSiteUrl(site)}`);
      console.log(`Cloud ID: ${oauth.cloudId}`);
      console.log(`Access token: ${maskToken(oauth.accessToken)}`);
      console.log(`Refresh token: ${maskToken(oauth.refreshToken)}`);
      console.log(`Expires at: ${new Date(oauth.expiresAt).toISOString()}`);
      return;
    }

    if (subcommand === 'whoami') {
      const config = await resolveConfig(buildOverrides(parsed.values));
      const client = new ConfluenceClient(config);
      const profile = await client.whoAmI();
      console.log(JSON.stringify(profile, null, 2));
      return;
    }

    if (subcommand === 'logout') {
      await clearStoredConfig();
      console.log(`Removed ${getConfigPathForDisplay()}`);
      return;
    }

    throw new Error(`Unknown auth subcommand "${subcommand ?? ''}".`);
  }

  if (command === 'diagram') {
    const parsed = parseCommonFlags(rest);
    if (parsed.values.help) {
      printHelp();
      return;
    }

    const config = await resolveConfig(buildOverrides(parsed.values));
    const client = new ConfluenceClient(config);

    if (subcommand === 'list') {
      const type = normalizeDiagramType(parsed.values.type as string | undefined);
      const limitRaw = parsed.values.limit as string | undefined;
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 25;
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`Invalid --limit value "${limitRaw}".`);
      }

      const records = await client.listDiagrams({
        space: parsed.values.space as string | undefined,
        page: parsed.values.page as string | undefined,
        type,
        limit,
        addonKey: config.addonKey,
      });
      printRecords(records, asOutputFormat(parsed.values.format as string | undefined));
      return;
    }

    if (subcommand === 'get') {
      const id = parsed.positionals[0];
      if (!id) {
        throw new Error('Missing diagram id.');
      }

      const record = await client.getDiagram(id);
      printRecord(record, asOutputFormat(parsed.values.format as string | undefined));
      return;
    }

    if (subcommand === 'export') {
      const id = parsed.positionals[0];
      if (!id) {
        throw new Error('Missing diagram id.');
      }

      const record = await client.getDiagram(id);
      const format = asExportFormat(parsed.values.format as string | undefined);
      const output = format === 'json'
        ? `${JSON.stringify(record.value, null, 2)}\n`
        : extractDiagramContent(record.value);

      await maybeWriteOutput(parsed.values.output as string | undefined, output);
      return;
    }

    if (subcommand === 'create') {
      const type = normalizeDiagramType(parsed.values.type as string | undefined);
      if (!type) {
        throw new Error('Missing --type for diagram create.');
      }

      const pageId = parsed.values.page as string | undefined;
      if (!pageId) {
        throw new Error('Missing --page for diagram create.');
      }

      const input = await readDiagramInput(parsed.values.file as string | undefined, parsed.values.stdin as boolean);
      const diagram = parseDiagramInput(input, type, { title: parsed.values.title as string | undefined });
      const created = await client.createDiagram({
        pageId,
        type,
        title: parsed.values.title as string | undefined,
        diagram,
        addonKey: config.addonKey,
      });
      printRecord(created, 'json');
      return;
    }

    if (subcommand === 'update') {
      const id = parsed.positionals[0];
      if (!id) {
        throw new Error('Missing diagram id.');
      }

      const existing = await client.getDiagram(id);
      const requestedType = normalizeDiagramType(parsed.values.type as string | undefined) ?? existing.value.diagramType;
      const input = await readDiagramInput(parsed.values.file as string | undefined, parsed.values.stdin as boolean);
      const diagram = parseDiagramInput(input, requestedType, {
        ...existing.value,
        title: parsed.values.title as string | undefined ?? existing.title,
      });

      const updated = await client.updateDiagram({
        id,
        title: parsed.values.title as string | undefined,
        diagram,
        addonKey: config.addonKey,
      });
      printRecord(updated, 'json');
      return;
    }

    if (subcommand === 'delete') {
      const id = parsed.positionals[0];
      if (!id) {
        throw new Error('Missing diagram id.');
      }

      if (!(parsed.values.force as boolean)) {
        await confirmDelete(id);
      }

      await client.deleteDiagram(id);
      console.log(`Deleted diagram ${id}`);
      return;
    }

    throw new Error(`Unknown diagram subcommand "${subcommand ?? ''}".`);
  }

  throw new Error(`Unknown command "${command}".`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
