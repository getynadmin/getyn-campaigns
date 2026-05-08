/**
 * Meta Graph API client for WhatsApp Business (Phase 4 M3+).
 *
 * Thin, typed wrapper over `fetch`. Each method maps to a single
 * documented endpoint; we keep the surface minimal and grow it
 * milestone by milestone (M3 connect, M4 phone refresh, M5 template
 * sync, M8 send, M9 webhook handler reads media, M11 embedded signup).
 *
 * # Why a custom client (not @whatsapp/business-cloud-api or similar)
 * Meta's official SDKs are mostly stubs around fetch with poor types
 * and slow update cycles. The surface we touch is tiny — six endpoints
 * across the whole phase — so the maintenance cost of writing it
 * ourselves is lower than depending on a wrapper that lags Meta's
 * Graph version.
 *
 * # Errors
 * Every Meta error is preserved verbatim and surfaced through
 * MetaApiError so M3's UI can show the actual reason (e.g. "Invalid
 * OAuth access token") instead of a generic "something went wrong".
 *
 * # Versioning
 * Meta versions the API in the URL path (v18.0, v19.0, ...). We pin a
 * specific version per call so a Meta-side bump can't silently change
 * response shape on us. Update GRAPH_VERSION when we explicitly migrate.
 */

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaApiError extends Error {
  readonly status: number;
  readonly metaCode: number | undefined;
  readonly metaSubcode: number | undefined;
  readonly metaType: string | undefined;
  readonly metaTraceId: string | undefined;

  constructor(
    message: string,
    init: {
      status: number;
      metaCode?: number;
      metaSubcode?: number;
      metaType?: string;
      metaTraceId?: string;
    },
  ) {
    super(message);
    this.name = 'MetaApiError';
    this.status = init.status;
    this.metaCode = init.metaCode;
    this.metaSubcode = init.metaSubcode;
    this.metaType = init.metaType;
    this.metaTraceId = init.metaTraceId;
  }
}

interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * Internal fetch wrapper. Adds Bearer auth, parses JSON, raises a
 * MetaApiError with the structured fields Meta returns on failure.
 *
 * Exported for testability — production callers should use the
 * higher-level methods below.
 */
export async function metaFetch<T>(
  path: string,
  init: {
    accessToken: string;
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | undefined>;
    /** Override base URL for tests. */
    baseUrl?: string;
    /** Override fetch for tests. */
    fetchImpl?: typeof fetch;
  },
): Promise<T> {
  const base = init.baseUrl ?? GRAPH_BASE;
  const url = new URL(`${base}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.accessToken}`,
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const fetchFn = init.fetchImpl ?? fetch;
  const res = await fetchFn(url.toString(), {
    method: init.method ?? 'GET',
    headers,
    body,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new MetaApiError(`Meta API returned non-JSON (status ${res.status})`, {
        status: res.status,
      });
    }
  }
  if (!res.ok) {
    const err = (json as MetaErrorBody)?.error;
    throw new MetaApiError(err?.message ?? `Meta API ${res.status}`, {
      status: res.status,
      metaCode: err?.code,
      metaSubcode: err?.error_subcode,
      metaType: err?.type,
      metaTraceId: err?.fbtrace_id,
    });
  }
  return json as T;
}

// ------------------------------------------------------------------
// /me — verifies a token is alive.
// ------------------------------------------------------------------

export interface MetaMeResponse {
  id: string;
  name?: string;
}

export async function getMe(
  accessToken: string,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<MetaMeResponse> {
  return metaFetch<MetaMeResponse>('/me', {
    accessToken,
    query: { fields: 'id,name' },
    fetchImpl: opts?.fetchImpl,
    baseUrl: opts?.baseUrl,
  });
}

// ------------------------------------------------------------------
// /{wabaId} — fetches WABA metadata used to populate WhatsAppAccount.
// ------------------------------------------------------------------

export interface MetaWabaResponse {
  id: string;
  name: string;
  currency?: string;
  timezone_id?: string;
  message_template_namespace?: string;
}

export async function getWaba(
  wabaId: string,
  accessToken: string,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<MetaWabaResponse> {
  return metaFetch<MetaWabaResponse>(`/${encodeURIComponent(wabaId)}`, {
    accessToken,
    query: { fields: 'id,name,currency,timezone_id,message_template_namespace' },
    fetchImpl: opts?.fetchImpl,
    baseUrl: opts?.baseUrl,
  });
}

// ------------------------------------------------------------------
// /{wabaId}/phone_numbers — paginated list of registered phone numbers.
// We don't paginate yet (M3): in practice tenants have <25, comfortably
// under Meta's default page size. Add cursor handling in M4 if needed.
// ------------------------------------------------------------------

export interface MetaPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  /**
   * Unique recipients allowed in 24h.
   * "TIER_50" | "TIER_250" | "TIER_1K" | "TIER_10K" | "TIER_100K" | "TIER_UNLIMITED"
   * — Meta has shipped both string and numeric variants over time;
   * we accept both and normalise downstream.
   */
  messaging_limit?: string;
  /** Display status — "CONNECTED" | "PENDING_REVIEW" | "DISCONNECTED" | "FLAGGED". */
  status?: string;
  /** Set if 2FA PIN configured. */
  pin?: string;
  certificate?: string;
}

export interface MetaPhoneNumbersResponse {
  data: MetaPhoneNumber[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

export async function listWabaPhoneNumbers(
  wabaId: string,
  accessToken: string,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<MetaPhoneNumber[]> {
  const res = await metaFetch<MetaPhoneNumbersResponse>(
    `/${encodeURIComponent(wabaId)}/phone_numbers`,
    {
      accessToken,
      query: {
        fields: 'id,display_phone_number,verified_name,quality_rating,messaging_limit,status,pin,certificate',
      },
      fetchImpl: opts?.fetchImpl,
      baseUrl: opts?.baseUrl,
    },
  );
  return res.data;
}

// ------------------------------------------------------------------
// /{wabaId}/message_templates — list templates Meta has on file. Used
// by M5 (initial sync on connect, then hourly cron).
// ------------------------------------------------------------------

export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  text?: string;
  buttons?: unknown[];
  example?: unknown;
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL' | 'PENDING_DELETION';
  rejected_reason?: string;
  quality_score?: { score?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' };
  components: MetaTemplateComponent[];
}

export interface MetaTemplatesResponse {
  data: MetaTemplate[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

// ------------------------------------------------------------------
// /{phoneNumberId} — single-number metadata (tier, quality, status).
// Used by M4's wa-phone-refresh cron + manual refresh button. Returns
// the same fields as the WABA listing for a single phone, but includes
// the latest 24h-window usage which only the per-number endpoint
// surfaces.
// ------------------------------------------------------------------

export interface MetaPhoneNumberDetail extends MetaPhoneNumber {
  /** Recipients allowed in current 24h window. May be string or numeric. */
  throughput?: { level?: string };
  /** Some Graph versions expose this as a sibling instead of nested. */
  current_limit?: number;
  /** Some Graph versions expose tier-window usage as direct fields. */
  current_24h_usage?: number;
  next_24h_window_starts_at?: number; // unix seconds
}

export async function getPhoneNumber(
  phoneNumberId: string,
  accessToken: string,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<MetaPhoneNumberDetail> {
  return metaFetch<MetaPhoneNumberDetail>(`/${encodeURIComponent(phoneNumberId)}`, {
    accessToken,
    query: {
      fields:
        'id,display_phone_number,verified_name,quality_rating,messaging_limit,status,pin,certificate,throughput,current_limit,current_24h_usage,next_24h_window_starts_at',
    },
    fetchImpl: opts?.fetchImpl,
    baseUrl: opts?.baseUrl,
  });
}

// ------------------------------------------------------------------
// /{phoneNumberId}/whatsapp_business_profile — read-only business
// profile (about / description / address / websites / vertical).
// Tenants edit this in Meta Business Manager; we surface it for
// reference in the phone detail panel.
// ------------------------------------------------------------------

export interface MetaBusinessProfile {
  about?: string;
  description?: string;
  email?: string;
  address?: string;
  vertical?: string;
  websites?: string[];
  profile_picture_url?: string;
  messaging_product?: string;
}

interface MetaBusinessProfileResponse {
  // Meta wraps single-record reads in a `data` array of length 1.
  data: MetaBusinessProfile[];
}

export async function getPhoneNumberBusinessProfile(
  phoneNumberId: string,
  accessToken: string,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<MetaBusinessProfile | null> {
  const res = await metaFetch<MetaBusinessProfileResponse>(
    `/${encodeURIComponent(phoneNumberId)}/whatsapp_business_profile`,
    {
      accessToken,
      query: {
        fields:
          'about,description,email,address,vertical,websites,profile_picture_url,messaging_product',
      },
      fetchImpl: opts?.fetchImpl,
      baseUrl: opts?.baseUrl,
    },
  );
  return res.data?.[0] ?? null;
}

/**
 * POST /{wabaId}/message_templates — submit a new template to Meta.
 * Body shape matches Meta's API exactly (we serialize the same
 * components Json the M2 schema produces). Returns the new id +
 * initial status (typically PENDING).
 */
export interface CreateMessageTemplateBody {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: unknown[];
  /** Avoid post-submit reclassification surprises. Default true. */
  allow_category_change?: boolean;
}

export interface CreateMessageTemplateResponse {
  id: string;
  status: MetaTemplate['status'];
  category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
}

export async function createMessageTemplate(
  wabaId: string,
  accessToken: string,
  body: CreateMessageTemplateBody,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<CreateMessageTemplateResponse> {
  return metaFetch<CreateMessageTemplateResponse>(
    `/${encodeURIComponent(wabaId)}/message_templates`,
    {
      accessToken,
      method: 'POST',
      body: { allow_category_change: true, ...body } as unknown as Record<
        string,
        unknown
      >,
      fetchImpl: opts?.fetchImpl,
      baseUrl: opts?.baseUrl,
    },
  );
}

/**
 * DELETE /{wabaId}/message_templates?name={name}&hsm_id={id}.
 * Meta deletes by name; passing hsm_id targets a single language
 * variant. Without hsm_id Meta deletes every language for the name.
 */
export async function deleteMessageTemplate(
  wabaId: string,
  accessToken: string,
  args: { name: string; hsmId?: string },
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<{ success?: boolean }> {
  return metaFetch<{ success?: boolean }>(
    `/${encodeURIComponent(wabaId)}/message_templates`,
    {
      accessToken,
      method: 'DELETE',
      query: {
        name: args.name,
        ...(args.hsmId ? { hsm_id: args.hsmId } : {}),
      },
      fetchImpl: opts?.fetchImpl,
      baseUrl: opts?.baseUrl,
    },
  );
}

// ------------------------------------------------------------------
// POST /{phoneNumberId}/messages — send a template message (M8).
// ------------------------------------------------------------------

export interface SendTemplateBody {
  to: string; // E.164, no leading + per Meta's spec
  templateName: string;
  templateLanguage: string;
  /**
   * Body parameter values — aligned with {{1}}, {{2}}, ... in the
   * approved template. Header parameters and button URL parameters
   * land in M9; M8 supports BODY-only variable templates.
   */
  bodyParams: string[];
}

export interface SendTemplateResponse {
  messaging_product: 'whatsapp';
  contacts?: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  body: SendTemplateBody,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<SendTemplateResponse> {
  // Meta wants `to` without the leading `+`.
  const toBare = body.to.replace(/^\+/, '');
  const components =
    body.bodyParams.length > 0
      ? [
          {
            type: 'body',
            parameters: body.bodyParams.map((text) => ({
              type: 'text',
              text,
            })),
          },
        ]
      : [];
  return metaFetch<SendTemplateResponse>(
    `/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      accessToken,
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        to: toBare,
        type: 'template',
        template: {
          name: body.templateName,
          language: { code: body.templateLanguage },
          ...(components.length > 0 ? { components } : {}),
        },
      },
      fetchImpl: opts?.fetchImpl,
      baseUrl: opts?.baseUrl,
    },
  );
}

// ------------------------------------------------------------------
// GET /{messageId} — pull current status of a sent message (M8 poll).
// ------------------------------------------------------------------

export interface MetaMessageStatus {
  id: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

export async function getMessageStatus(
  messageId: string,
  accessToken: string,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<MetaMessageStatus> {
  return metaFetch<MetaMessageStatus>(`/${encodeURIComponent(messageId)}`, {
    accessToken,
    query: { fields: 'id,status,timestamp,recipient_id,errors' },
    fetchImpl: opts?.fetchImpl,
    baseUrl: opts?.baseUrl,
  });
}

export async function listWabaTemplates(
  wabaId: string,
  accessToken: string,
  opts?: { fetchImpl?: typeof fetch; baseUrl?: string },
): Promise<MetaTemplate[]> {
  // M3 uses this only as a connectivity smoke (we don't render the
  // returned templates yet — M5's sync handler will). Limit=200 to
  // pull everything in one shot for a typical WABA.
  const res = await metaFetch<MetaTemplatesResponse>(
    `/${encodeURIComponent(wabaId)}/message_templates`,
    {
      accessToken,
      query: {
        fields: 'id,name,language,category,status,rejected_reason,quality_score,components',
        limit: 200,
      },
      fetchImpl: opts?.fetchImpl,
      baseUrl: opts?.baseUrl,
    },
  );
  return res.data;
}
