import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfluenceClient } from './confluenceClient.js';

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
      variant: 'full',
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
      variant: 'full',
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
      variant: 'full',
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
      variant: 'full',
    });

    const records = await client.listDiagrams({ limit: 10 });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('2');
  });
});
