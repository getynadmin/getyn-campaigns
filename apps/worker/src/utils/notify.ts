import { prisma, type NotificationKind } from '@getyn/db';

/**
 * Fire-and-forget worker-side notification publisher. Same shape as
 * the apps/web version — a dropped notification must never fail the
 * source event (send dispatch, webhook handler, etc.).
 */
export async function notify(input: {
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
    console.warn('[worker:notify] publish failed', {
      kind: input.kind,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
