import { prisma, type NotificationKind } from '@getyn/db';

/**
 * Fire-and-forget notification publisher. Call from publishers at
 * event sites (campaign worker, agent runtime, webhooks). Swallows
 * errors — a dropped notification must never fail the source event.
 *
 * Pass `userId: undefined` or omit to publish a tenant-wide notice
 * every member sees.
 */
export async function publishNotification(input: {
  tenantId: string;
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
      },
    });
  } catch (err) {
    console.warn('[notifications] publish failed', {
      kind: input.kind,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
