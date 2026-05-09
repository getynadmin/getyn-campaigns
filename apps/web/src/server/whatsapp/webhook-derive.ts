/**
 * Phase 4 M9 / M12 — webhook event-derivation helper.
 *
 * Pure logic extracted from the receiver so unit tests can verify
 * dedupeKey + eventType derivation without faking Next.js Request.
 *
 * Meta sends batches; we explode the batch into individual events
 * each with a deterministic dedupeKey for upsert idempotency.
 */

export interface DerivedEvent {
  dedupeKey: string;
  eventType: string;
  wabaId: string | null;
  phoneNumberMetaId: string | null;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{ id: string; type?: string }>;
        statuses?: Array<{ id: string; status?: string }>;
        message_template_id?: string;
        event?: string;
        [k: string]: unknown;
      };
    }>;
  }>;
}

export function deriveWebhookEvents(
  payload: MetaWebhookPayload,
): DerivedEvent[] {
  const out: DerivedEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const wabaId = entry.id ?? null;
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const phoneNumberMetaId = v.metadata?.phone_number_id ?? null;

      for (const m of v.messages ?? []) {
        out.push({
          dedupeKey: `inbound:${m.id}`,
          eventType: `inbound:${m.type ?? 'unknown'}`,
          wabaId,
          phoneNumberMetaId,
        });
      }
      for (const s of v.statuses ?? []) {
        out.push({
          dedupeKey: `status:${s.id}:${s.status ?? 'unknown'}`,
          eventType: `status:${s.status ?? 'unknown'}`,
          wabaId,
          phoneNumberMetaId,
        });
      }
      if (
        change.field === 'message_template_status_update' &&
        v.message_template_id
      ) {
        out.push({
          dedupeKey: `template_status:${v.message_template_id}:${v.event ?? 'unknown'}`,
          eventType: `template_status:${v.event ?? 'unknown'}`,
          wabaId,
          phoneNumberMetaId,
        });
      }
    }
  }
  return out;
}
