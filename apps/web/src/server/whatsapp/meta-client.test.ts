/**
 * Phase 4 M3 — Meta Graph API client coverage.
 *
 * We mock `fetch` directly rather than using msw — the surface is small
 * and the mock fits in-line. Tests:
 *
 *   - Successful GET parses + returns JSON
 *   - 401 surfaces as MetaApiError with status + metaCode + message
 *   - Non-JSON error body still throws (no ReferenceError)
 *   - Bearer auth is set on every request
 *   - Query params are URL-encoded
 *   - Per-method shape: getMe / getWaba / listWabaPhoneNumbers / listWabaTemplates
 *
 * Behaviour > implementation: the test never inspects the URL path
 * shape of the Graph API directly, only what we construct + send.
 */
import {
  MetaApiError,
  getMe,
  getWaba,
  listWabaPhoneNumbers,
  listWabaTemplates,
  metaFetch,
} from './meta-client';
import { describe, expect, it, vi } from 'vitest';

type FetchCall = { url: string; init: RequestInit };

function makeFetch(responses: Array<{ status: number; body: unknown; bodyText?: string }>): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const r = responses[i] ?? { status: 200, body: {} };
    i += 1;
    calls.push({ url: typeof url === 'string' ? url : url.toString(), init: init ?? {} });
    const text = r.bodyText ?? JSON.stringify(r.body);
    return new Response(text, {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    }) as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('metaFetch', () => {
  it('passes Bearer token + Accept header on every request', async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200, body: { id: '1' } }]);
    await metaFetch<{ id: string }>('/me', {
      accessToken: 'EAAtest',
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer EAAtest');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('URL-encodes query params', async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200, body: { ok: true } }]);
    await metaFetch('/me', {
      accessToken: 'tok',
      query: { fields: 'id,name', q: 'hello world' },
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    expect(calls[0]?.url).toContain('fields=id%2Cname');
    expect(calls[0]?.url).toContain('q=hello+world');
  });

  it('throws MetaApiError with status + code on 4xx with structured body', async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 401,
        body: {
          error: {
            message: 'Invalid OAuth access token',
            type: 'OAuthException',
            code: 190,
            error_subcode: 460,
            fbtrace_id: 'AbCdEf',
          },
        },
      },
    ]);
    await expect(
      metaFetch('/me', { accessToken: 'bad', fetchImpl, baseUrl: 'https://graph.fake' }),
    ).rejects.toMatchObject({
      name: 'MetaApiError',
      status: 401,
      metaCode: 190,
      metaSubcode: 460,
      metaType: 'OAuthException',
      metaTraceId: 'AbCdEf',
      message: 'Invalid OAuth access token',
    });
  });

  it('throws MetaApiError when body is non-JSON garbage', async () => {
    const { fetchImpl } = makeFetch([{ status: 502, body: null, bodyText: '<html>bad gateway</html>' }]);
    await expect(
      metaFetch('/me', { accessToken: 'tok', fetchImpl, baseUrl: 'https://graph.fake' }),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it('handles empty success body (e.g. DELETE 204-style 200 with no payload)', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, body: null, bodyText: '' }]);
    const result = await metaFetch('/me', {
      accessToken: 'tok',
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    expect(result).toBeNull();
  });

  it('serializes JSON body for POST', async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200, body: { ok: true } }]);
    await metaFetch('/x', {
      accessToken: 'tok',
      method: 'POST',
      body: { foo: 'bar' },
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    expect(calls[0]?.init.body).toBe(JSON.stringify({ foo: 'bar' }));
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });
});

describe('getMe', () => {
  it('returns id + name', async () => {
    const { fetchImpl } = makeFetch([
      { status: 200, body: { id: '17841401234', name: 'Acme System User' } },
    ]);
    const me = await getMe('tok', { fetchImpl, baseUrl: 'https://graph.fake' });
    expect(me).toEqual({ id: '17841401234', name: 'Acme System User' });
  });
});

describe('getWaba', () => {
  it('returns the WABA business metadata', async () => {
    const { fetchImpl, calls } = makeFetch([
      {
        status: 200,
        body: {
          id: '107655329012345',
          name: 'Acme Demo Brands',
          currency: 'USD',
          timezone_id: 'America/Los_Angeles',
          message_template_namespace: 'b21f...',
        },
      },
    ]);
    const waba = await getWaba('107655329012345', 'tok', {
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    expect(waba.name).toBe('Acme Demo Brands');
    expect(waba.currency).toBe('USD');
    expect(calls[0]?.url).toContain('/107655329012345');
  });
});

describe('listWabaPhoneNumbers', () => {
  it('returns the data array', async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: {
          data: [
            {
              id: '110055443322110',
              display_phone_number: '+14155551001',
              verified_name: 'Acme Demo',
              quality_rating: 'GREEN',
              messaging_limit: 'TIER_1K',
              status: 'CONNECTED',
            },
          ],
        },
      },
    ]);
    const phones = await listWabaPhoneNumbers('107655329012345', 'tok', {
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    expect(phones).toHaveLength(1);
    expect(phones[0]?.display_phone_number).toBe('+14155551001');
  });

  it('returns [] when WABA has no numbers yet', async () => {
    const { fetchImpl } = makeFetch([{ status: 200, body: { data: [] } }]);
    const phones = await listWabaPhoneNumbers('107655329012345', 'tok', {
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    expect(phones).toEqual([]);
  });
});

describe('listWabaTemplates', () => {
  it('returns templates with components verbatim', async () => {
    const { fetchImpl } = makeFetch([
      {
        status: 200,
        body: {
          data: [
            {
              id: '4099887766554433',
              name: 'order_shipped',
              language: 'en_US',
              category: 'UTILITY',
              status: 'APPROVED',
              components: [
                { type: 'BODY', text: 'Hi {{1}}, your order shipped.' },
              ],
            },
          ],
        },
      },
    ]);
    const tpls = await listWabaTemplates('107655329012345', 'tok', {
      fetchImpl,
      baseUrl: 'https://graph.fake',
    });
    expect(tpls).toHaveLength(1);
    expect(tpls[0]?.components[0]?.type).toBe('BODY');
  });
});

describe('MetaApiError', () => {
  it('preserves all structured fields for downstream UI', () => {
    const err = new MetaApiError('Boom', {
      status: 400,
      metaCode: 100,
      metaSubcode: 33,
      metaType: 'GraphMethodException',
      metaTraceId: 'xyz',
    });
    expect(err.name).toBe('MetaApiError');
    expect(err.metaCode).toBe(100);
    expect(err.metaSubcode).toBe(33);
    expect(err.metaType).toBe('GraphMethodException');
    expect(err.metaTraceId).toBe('xyz');
  });
});

// Sanity: ensure the test file at least references vi (some lint configs flag unused imports)
void vi;
