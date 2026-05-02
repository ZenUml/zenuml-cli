import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfluenceClient } from './confluenceClient.js';
import { saveStoredConfig } from './config.js';
import { refreshOAuthToken } from './oauth.js';

vi.mock('./config.js', () => ({
  saveStoredConfig: vi.fn().mockResolvedValue('/tmp/config.json'),
}));

vi.mock('./oauth.js', () => ({
  refreshOAuthToken: vi.fn(),
}));

describe('ConfluenceClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends basic auth and parses a custom content record', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '123',
        type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
        title: 'Example',
        status: 'current',
        pageId: '999',
        body: {
          raw: {
            value: JSON.stringify({
              diagramType: 'sequence',
              code: 'Alice->Bob: hi',
            }),
          },
        },
        version: { number: 2 },
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      site: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-1234',
    });

    const record = await client.getDiagram('123');

    expect(record.value.diagramType).toBe('sequence');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/api/v2/custom-content/123?body-format=raw',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('user@example.com:token-1234').toString('base64')}`,
        }),
      }),
    );
  });

  it('lists diagrams across paginated responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: '1',
              type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
              title: 'One',
              status: 'current',
              pageId: '99',
              body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'A->B' }) } },
              version: { number: 1 },
            },
          ],
          _links: {
            next: '/wiki/api/v2/custom-content?cursor=next',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: '2',
              type: 'ac:com.zenuml.confluence-addon:zenuml-content-graph',
              title: 'Two',
              status: 'current',
              pageId: '99',
              body: { raw: { value: JSON.stringify({ diagramType: 'graph', graphXml: '<mxGraph />' }) } },
              version: { number: 3 },
            },
          ],
          _links: {},
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          _links: {},
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      site: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-1234',
      addonKey: 'com.zenuml.confluence-addon',
    });

    const records = await client.listDiagrams({ limit: 10 });

    expect(records).toHaveLength(2);
    expect(records.map((item) => item.id)).toEqual(['2', '1']);
  });

  it('hydrates list items that are missing body.raw', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: '310935576',
              type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
              title: 'Hydrate me',
              status: 'current',
              pageId: '99',
              body: {},
              version: { number: 1 },
            },
          ],
          _links: {},
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '310935576',
          type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
          title: 'Hydrate me',
          status: 'current',
          pageId: '99',
          body: {
            raw: {
              value: JSON.stringify({ diagramType: 'sequence', code: 'A->B: hydrated' }),
            },
          },
          version: { number: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          _links: {},
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      site: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-1234',
      addonKey: 'com.zenuml.confluence-addon',
    });

    const records = await client.listDiagrams({ limit: 10 });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('310935576');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/api/v2/custom-content/310935576?body-format=raw',
      expect.any(Object),
    );
  });

  it('skips malformed list items missing diagramType after hydration', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: '347504695',
              type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
              title: 'Broken',
              status: 'current',
              pageId: '99',
              body: { raw: { value: JSON.stringify({ code: 'missing type' }) } },
              version: { number: 1 },
            },
            {
              id: '2',
              type: 'ac:com.zenuml.confluence-addon:zenuml-content-graph',
              title: 'Valid',
              status: 'current',
              pageId: '99',
              body: { raw: { value: JSON.stringify({ diagramType: 'graph', graphXml: '<mxGraph />' }) } },
              version: { number: 3 },
            },
          ],
          _links: {},
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '347504695',
          type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
          title: 'Broken',
          status: 'current',
          pageId: '99',
          body: { raw: { value: JSON.stringify({ code: 'still missing type' }) } },
          version: { number: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          _links: {},
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      site: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-1234',
      addonKey: 'com.zenuml.confluence-addon',
    });

    const records = await client.listDiagrams({ limit: 10 });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('2');
  });

  it('detects lite variant when full has no content', async () => {
    const fetchMock = vi
      .fn()
      // detectVariant: full/sequence → empty
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
      // detectVariant: full/graph → empty
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
      // detectVariant: lite/sequence → found
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: '1' }] }) })
      // listDiagrams: lite sequence page
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: '1',
              type: 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
              title: 'Lite diagram',
              status: 'current',
              pageId: '99',
              body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'A->B' }) } },
              version: { number: 1 },
            },
          ],
          _links: {},
        }),
      })
      // listDiagrams: lite graph page
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], _links: {} }) });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      site: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-1234',
    });

    const records = await client.listDiagrams({ limit: 10 });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('1');
    // Verify detection probed full first, then lite
    const urls = fetchMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(urls[0]).toContain('com.zenuml.confluence-addon%3Azenuml-content-sequence');
    expect(urls[1]).toContain('com.zenuml.confluence-addon%3Azenuml-content-graph');
    expect(urls[2]).toContain('com.zenuml.confluence-addon-lite%3Azenuml-content-sequence');
  });

  it('skips detection when addonKey is explicitly set', async () => {
    const fetchMock = vi
      .fn()
      // listDiagrams: full sequence page (no detection probes)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: '1',
              type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
              title: 'Full diagram',
              status: 'current',
              pageId: '99',
              body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'A->B' }) } },
              version: { number: 1 },
            },
          ],
          _links: {},
        }),
      })
      // listDiagrams: full graph page
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], _links: {} }) });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      site: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-1234',
      addonKey: 'com.zenuml.confluence-addon',
    });

    const records = await client.listDiagrams({ limit: 10 });

    expect(records).toHaveLength(1);
    // Only 2 calls (list sequence + list graph), no detection probes
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches detected variant across calls', async () => {
    const fetchMock = vi
      .fn()
      // detectVariant: full/sequence → found
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: '1' }] }) })
      // first listDiagrams calls
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], _links: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], _links: {} }) })
      // second listDiagrams calls (no new detection)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], _links: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], _links: {} }) });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      site: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token-1234',
    });

    await client.listDiagrams({ limit: 10 });
    await client.listDiagrams({ limit: 10 });

    // 1 detection probe + 2 list calls + 2 list calls = 5 total (no second detection)
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('uses bearer auth for oauth config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '123',
        type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
        title: 'Example',
        status: 'current',
        pageId: '999',
        body: {
          raw: {
            value: JSON.stringify({ diagramType: 'sequence', code: 'A->B' }),
          },
        },
        version: { number: 1 },
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new ConfluenceClient({
      authMethod: 'oauth',
      site: 'https://example.atlassian.net',
      accessToken: 'oauth-access-token',
      refreshToken: 'oauth-refresh-token',
      expiresAt: Date.now() + 3600000,
      oauthClientId: 'client-id',
      cloudId: 'cloud-1',
    });

    await client.getDiagram('123');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/api/v2/custom-content/123?body-format=raw',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-access-token',
        }),
      }),
    );
  });

  it('refreshes oauth token before request when token is expiring', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '123',
        type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
        title: 'Example',
        status: 'current',
        pageId: '999',
        body: {
          raw: {
            value: JSON.stringify({ diagramType: 'sequence', code: 'A->B' }),
          },
        },
        version: { number: 1 },
      }),
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(refreshOAuthToken).mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: Date.now() + 3600000,
      cloudId: '',
    });

    const client = new ConfluenceClient({
      authMethod: 'oauth',
      site: 'https://example.atlassian.net',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() + 1000,
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      cloudId: 'cloud-1',
    });

    await client.getDiagram('123');

    expect(refreshOAuthToken).toHaveBeenCalledWith({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'old-refresh',
    });
    expect(saveStoredConfig).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/api/v2/custom-content/123?body-format=raw',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer new-access',
        }),
      }),
    );
  });

  it('retries once on oauth 401 after refreshing token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'expired',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '123',
          type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
          title: 'Example',
          status: 'current',
          pageId: '999',
          body: {
            raw: {
              value: JSON.stringify({ diagramType: 'sequence', code: 'A->B' }),
            },
          },
          version: { number: 1 },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(refreshOAuthToken).mockResolvedValue({
      accessToken: 'retry-access',
      refreshToken: 'retry-refresh',
      expiresAt: Date.now() + 3600000,
      cloudId: '',
    });

    const client = new ConfluenceClient({
      authMethod: 'oauth',
      site: 'https://example.atlassian.net',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() + 3600000,
      oauthClientId: 'client-id',
      cloudId: 'cloud-1',
    });

    await client.getDiagram('123');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshOAuthToken).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer retry-access',
        }),
      }),
    );
  });
});
