/**
 * Phase 4 M9 / M12 — webhook event-derivation coverage.
 *
 * dedupeKey is the unique constraint that makes our receiver
 * idempotent. If derivation drifts, duplicate webhook deliveries
 * stop collapsing and the worker double-processes.
 */
import { deriveWebhookEvents } from './webhook-derive';
import { describe, expect, it } from 'vitest';

describe('deriveWebhookEvents', () => {
  it('emits one inbound event per message', () => {
    const out = deriveWebhookEvents({
      entry: [
        {
          id: '107655329012345',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '110055443322110' },
                messages: [
                  { id: 'wamid.AAA', type: 'text' },
                  { id: 'wamid.BBB', type: 'image' },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(out).toEqual([
      {
        dedupeKey: 'inbound:wamid.AAA',
        eventType: 'inbound:text',
        wabaId: '107655329012345',
        phoneNumberMetaId: '110055443322110',
      },
      {
        dedupeKey: 'inbound:wamid.BBB',
        eventType: 'inbound:image',
        wabaId: '107655329012345',
        phoneNumberMetaId: '110055443322110',
      },
    ]);
  });

  it('emits separate events per (messageId, status) tuple', () => {
    const out = deriveWebhookEvents({
      entry: [
        {
          id: '107655329012345',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '110055443322110' },
                statuses: [
                  { id: 'wamid.AAA', status: 'sent' },
                  { id: 'wamid.AAA', status: 'delivered' },
                  { id: 'wamid.AAA', status: 'read' },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(out.map((e) => e.dedupeKey)).toEqual([
      'status:wamid.AAA:sent',
      'status:wamid.AAA:delivered',
      'status:wamid.AAA:read',
    ]);
    expect(out.every((e) => e.eventType.startsWith('status:'))).toBe(true);
  });

  it('emits a template-status event with the right dedupeKey', () => {
    const out = deriveWebhookEvents({
      entry: [
        {
          id: '107655329012345',
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                message_template_id: '4099887766554433',
                event: 'APPROVED',
              },
            },
          ],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      dedupeKey: 'template_status:4099887766554433:APPROVED',
      eventType: 'template_status:APPROVED',
    });
  });

  it('skips template-status events without a template id', () => {
    const out = deriveWebhookEvents({
      entry: [
        {
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED' }, // no message_template_id
            },
          ],
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it('returns [] for empty / heartbeat payloads', () => {
    expect(deriveWebhookEvents({})).toEqual([]);
    expect(deriveWebhookEvents({ entry: [] })).toEqual([]);
    expect(
      deriveWebhookEvents({ entry: [{ id: 'x', changes: [] }] }),
    ).toEqual([]);
  });

  it('falls back to "unknown" when message type is missing', () => {
    const out = deriveWebhookEvents({
      entry: [
        {
          id: 'w',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'p' },
                messages: [{ id: 'wamid.X' }], // no type
              },
            },
          ],
        },
      ],
    });
    expect(out[0]?.eventType).toBe('inbound:unknown');
  });

  it('preserves wabaId + phoneNumberMetaId for each derived event', () => {
    const out = deriveWebhookEvents({
      entry: [
        {
          id: 'WABA_1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PHN_1' },
                messages: [{ id: 'm1', type: 'text' }],
                statuses: [{ id: 'm0', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    });
    for (const e of out) {
      expect(e.wabaId).toBe('WABA_1');
      expect(e.phoneNumberMetaId).toBe('PHN_1');
    }
  });

  it('handles multi-entry batches', () => {
    const out = deriveWebhookEvents({
      entry: [
        {
          id: 'A',
          changes: [
            {
              field: 'messages',
              value: { messages: [{ id: 'a1', type: 'text' }] },
            },
          ],
        },
        {
          id: 'B',
          changes: [
            {
              field: 'messages',
              value: { messages: [{ id: 'b1', type: 'text' }] },
            },
          ],
        },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.wabaId)).toEqual(['A', 'B']);
  });
});
