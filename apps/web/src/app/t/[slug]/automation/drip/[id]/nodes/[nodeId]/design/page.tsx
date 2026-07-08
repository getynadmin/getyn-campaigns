import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';
import { automationDefinitionSchema } from '@getyn/types';

import { AutomationNodeDesignClient } from '@/components/automation/node-design-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Design email node' };

/**
 * /t/[slug]/automation/drip/[id]/nodes/[nodeId]/design — full-screen
 * Unlayer designer for a single Email node inside a drip automation.
 *
 * Same EmailBuilder used by the campaign designer. Save writes back
 * to the node's data via automation.saveNodeDesign; the back button
 * routes to the builder.
 */
export default async function AutomationNodeDesignPage({
  params,
}: {
  params: { slug: string; id: string; nodeId: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
    select: { id: true },
  });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();

  const automation = await prisma.automation.findFirst({
    where: { id: params.id, tenantId: tenant.id },
    select: { id: true, name: true, definition: true },
  });
  if (!automation) notFound();

  const parsed = automationDefinitionSchema.safeParse(automation.definition);
  if (!parsed.success) notFound();

  const node = parsed.data.nodes.find((n) => n.id === params.nodeId);
  if (!node || node.type !== 'email') notFound();

  return (
    <AutomationNodeDesignClient
      automationId={automation.id}
      automationName={automation.name}
      slug={params.slug}
      nodeId={params.nodeId}
      initialDesign={
        (node.data.designJson ?? { body: { rows: [] } }) as Record<string, unknown>
      }
      initialSubject={node.data.subject}
      nodeLabel={node.data.label}
    />
  );
}
