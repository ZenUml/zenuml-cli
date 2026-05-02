import { URL } from 'node:url';

import {
  CreateDiagramOptions,
  CustomContentRecord,
  ListDiagramOptions,
  OAuthResolvedConfig,
  ParsedDiagramRecord,
  ResolvedConfig,
  UpdateDiagramOptions,
} from './types.js';
import { DiagramType } from './types.js';
import { getAddonKey, getCustomContentType, getStorageTypeForDiagram } from './diagram.js';
import { saveStoredConfig } from './config.js';
import { refreshOAuthToken } from './oauth.js';

interface PaginatedResponse<T> {
  results: T[];
  _links?: {
    next?: string;
  };
}

export class ConfluenceClient {
  private detectedVariant: 'full' | 'lite' | undefined;
  private readonly oauthRefreshWindowMs = 60000;

  constructor(private config: ResolvedConfig) {}

  async whoAmI(): Promise<Record<string, unknown>> {
    if (this.isOAuthConfig(this.config)) {
      return decodeJwtPayload(this.config.accessToken);
    }
    return this.requestJson('/wiki/rest/api/user/current');
  }

  async detectVariant(): Promise<'full' | 'lite'> {
    if (this.detectedVariant) {
      return this.detectedVariant;
    }

    process.stderr.write('Auto-detecting addon variant...\n');
    const storageTypes = ['zenuml-content-sequence', 'zenuml-content-graph'];
    const candidates: Array<'full' | 'lite'> = ['full', 'lite'];

    for (const variant of candidates) {
      const addonKey = getAddonKey(variant);
      for (const storageType of storageTypes) {
        const type = `ac:${addonKey}:${storageType}`;
        const probePath = `/wiki/api/v2/custom-content?type=${encodeURIComponent(type)}&limit=1`;

        const page = await this.requestJson<PaginatedResponse<CustomContentRecord>>(probePath);
        if (page.results.length > 0) {
          this.detectedVariant = variant;
          process.stderr.write(`Detected variant: ${variant}\n`);
          return variant;
        }
      }
    }

    // Default to full if neither has content yet
    this.detectedVariant = 'full';
    return 'full';
  }

  async resolveAddonKey(explicitAddonKey?: string): Promise<string> {
    if (explicitAddonKey ?? this.config.addonKey) {
      return (explicitAddonKey ?? this.config.addonKey)!;
    }

    const variant = await this.detectVariant();
    return getAddonKey(variant);
  }

  async getDiagram(id: string): Promise<ParsedDiagramRecord> {
    const result = await this.requestJson<CustomContentRecord>(`/wiki/api/v2/custom-content/${id}?body-format=raw`);
    return this.parseRecord(result);
  }

  async listDiagrams(options: ListDiagramOptions): Promise<ParsedDiagramRecord[]> {
    const storageTypes = options.type
      ? [getStorageTypeForDiagram(options.type)]
      : ['zenuml-content-sequence', 'zenuml-content-graph'];

    const addonKey = await this.resolveAddonKey(options.addonKey);
    const records = new Map<string, ParsedDiagramRecord>();

    for (const storageType of storageTypes) {
      const type = `ac:${addonKey}:${storageType}`;
      const requestPath = await this.buildListPath(options, type);
      const page = await this.collectPaginated<CustomContentRecord>(requestPath, options.limit);

      for (const item of page) {
        const parsed = await this.parseListRecord(item);
        if (!parsed) {
          continue;
        }
        if (options.type && parsed.value.diagramType !== options.type) {
          continue;
        }
        records.set(String(parsed.id), parsed);
      }
    }

    return Array.from(records.values())
      .sort((left, right) => (right.version?.number ?? 0) - (left.version?.number ?? 0))
      .slice(0, options.limit);
  }

  async createDiagram(options: CreateDiagramOptions): Promise<ParsedDiagramRecord> {
    const variant = await this.detectVariant();
    const payload = {
      type: getCustomContentType(options.type, variant, options.addonKey ?? this.config.addonKey),
      pageId: options.pageId,
      title: options.title || options.diagram.title || `Untitled ${new Date().toISOString()}`,
      body: {
        value: JSON.stringify(options.diagram),
        representation: 'raw',
      },
    };

    const created = await this.requestJson<CustomContentRecord>('/wiki/api/v2/custom-content', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return this.parseRecord(created);
  }

  async updateDiagram(options: UpdateDiagramOptions): Promise<ParsedDiagramRecord> {
    const existing = await this.getDiagram(options.id);
    const nextVersion = (existing.version?.number ?? 0) + 1;
    const variant = await this.detectVariant();
    const nextType = getCustomContentType(
      options.diagram.diagramType,
      variant,
      options.addonKey ?? this.config.addonKey,
    );

    const payload = {
      id: existing.id,
      type: nextType,
      status: existing.status,
      pageId: existing.pageId,
      title: options.title || options.diagram.title || existing.title,
      body: {
        value: JSON.stringify(options.diagram),
        representation: 'raw',
      },
      version: {
        number: nextVersion,
      },
    };

    const updated = await this.requestJson<CustomContentRecord>(`/wiki/api/v2/custom-content/${options.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    return this.parseRecord(updated);
  }

  async deleteDiagram(id: string): Promise<void> {
    await this.request(`/wiki/api/v2/custom-content/${id}`, {
      method: 'DELETE',
    });
  }

  async resolveSpaceId(space: string): Promise<string> {
    if (/^\d+$/.test(space)) {
      return space;
    }

    const response = await this.requestJson<{ id?: string | number }>(`/wiki/rest/api/space/${encodeURIComponent(space)}`);
    if (!response.id) {
      throw new Error(`Unable to resolve space "${space}" to a Confluence space ID.`);
    }

    return String(response.id);
  }

  private async buildListPath(options: ListDiagramOptions, type: string): Promise<string> {
    const params = new URLSearchParams();
    params.set('type', type);
    params.set('body-format', 'raw');
    params.set('limit', String(Math.max(1, options.limit)));

    if (options.page) {
      return `/wiki/api/v2/pages/${options.page}/custom-content?${params.toString()}`;
    }

    if (options.space) {
      const spaceId = await this.resolveSpaceId(options.space);
      return `/wiki/api/v2/spaces/${spaceId}/custom-content?${params.toString()}`;
    }

    return `/wiki/api/v2/custom-content?${params.toString()}`;
  }

  private async collectPaginated<T>(path: string, maxItems: number): Promise<T[]> {
    const items: T[] = [];
    let nextPath: string | undefined = path;

    while (nextPath && items.length < maxItems) {
      const page: PaginatedResponse<T> = await this.requestJson<PaginatedResponse<T>>(nextPath);
      items.push(...page.results);
      nextPath = page._links?.next ? this.normalizeNextPath(page._links.next) : undefined;
    }

    return items.slice(0, maxItems);
  }

  private normalizeNextPath(nextPath: string): string {
    if (nextPath.startsWith('http://') || nextPath.startsWith('https://')) {
      const next = new URL(nextPath);
      return `${next.pathname}${next.search}`;
    }

    return nextPath.startsWith('/wiki') ? nextPath : `/wiki/${nextPath.replace(/^\/+/, '')}`;
  }

  private parseRecord(record: CustomContentRecord): ParsedDiagramRecord {
    const raw = record.body?.raw?.value;
    if (!raw) {
      throw new Error(`Custom content ${record.id} has no raw body.`);
    }

    const parsed = JSON.parse(raw) as ParsedDiagramRecord['value'];
    if (!parsed.diagramType) {
      throw new Error(`Custom content ${record.id} is missing diagramType.`);
    }

    return {
      ...record,
      value: parsed,
    };
  }

  private async parseListRecord(record: CustomContentRecord): Promise<ParsedDiagramRecord | null> {
    try {
      return this.parseRecord(record);
    } catch (error) {
      const message = (error as Error).message;
      if (this.isUnparseableRecordError(message)) {
        return null;
      }
      if (
        !message.includes('has no raw body') &&
        !message.includes('is missing diagramType')
      ) {
        throw error;
      }

      const hydrated = await this.requestJson<CustomContentRecord>(
        `/wiki/api/v2/custom-content/${record.id}?body-format=raw`,
      );

      try {
        return this.parseRecord(hydrated);
      } catch (hydrateError) {
        const hydrateMessage = (hydrateError as Error).message;
        if (
          hydrateMessage.includes('has no raw body') ||
          hydrateMessage.includes('is missing diagramType') ||
          this.isUnparseableRecordError(hydrateMessage)
        ) {
          return null;
        }
        throw hydrateError;
      }
    }
  }

  private isUnparseableRecordError(message: string): boolean {
    return /bad control character|unexpected (token|end of json|non-whitespace)/i.test(message);
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return response.json() as Promise<T>;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.performRequest(path, init);

    if (response.status === 401 && this.isOAuthConfig(this.config)) {
      await this.refreshOAuthCredentials();
      const retry = await this.performRequest(path, init);
      if (!retry.ok) {
        const retryBody = await retry.text();
        throw new Error(
          `Confluence request failed (${retry.status} ${retry.statusText}) for ${path}: ${retryBody}`,
        );
      }
      return retry;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Confluence request failed (${response.status} ${response.statusText}) for ${path}: ${body}`);
    }

    return response;
  }

  private async performRequest(path: string, init?: RequestInit): Promise<Response> {
    const headers = await this.buildAuthHeaders(init);

    return fetch(this.buildRequestUrl(path), {
      ...init,
      headers,
    });
  }

  private buildRequestUrl(path: string): string {
    if (this.isOAuthConfig(this.config)) {
      return `https://api.atlassian.com/ex/confluence/${this.config.cloudId}${path}`;
    }

    return `${this.config.site}${path}`;
  }

  private async buildAuthHeaders(init?: RequestInit): Promise<HeadersInit> {
    if (this.isOAuthConfig(this.config)) {
      await this.ensureFreshOAuthAccessToken();

      return {
        Accept: 'application/json',
        Authorization: `Bearer ${this.config.accessToken}`,
        ...(init?.method && init.method !== 'GET' && init.method !== 'DELETE'
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init?.headers,
      };
    }

    return {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
      ...(init?.method && init.method !== 'GET' && init.method !== 'DELETE'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    };
  }

  private async ensureFreshOAuthAccessToken(): Promise<void> {
    if (!this.isOAuthConfig(this.config)) {
      return;
    }

    if (this.config.expiresAt - Date.now() > this.oauthRefreshWindowMs) {
      return;
    }

    await this.refreshOAuthCredentials();
  }

  private async refreshOAuthCredentials(): Promise<void> {
    if (!this.isOAuthConfig(this.config)) {
      return;
    }

    const refreshed = await refreshOAuthToken({
      clientId: this.config.oauthClientId,
      clientSecret: this.config.oauthClientSecret,
      refreshToken: this.config.refreshToken,
    });

    this.config = {
      ...this.config,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    };

    await saveStoredConfig(this.config);
  }

  private isOAuthConfig(config: ResolvedConfig): config is OAuthResolvedConfig {
    return config.authMethod === 'oauth';
  }

}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format in access token.');
  }
  const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}
