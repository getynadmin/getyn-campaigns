/* eslint-disable no-console */
import { notFound } from 'next/navigation';

import { prisma, verifyEmailToken } from '@getyn/db';

export const metadata = {
  title: 'View email',
  robots: { index: false, follow: false },
};

/**
 * `/v/{token}` — web view of the rendered email for a specific recipient.
 *
 * Lets recipients see the email in a browser when their mail client
 * mangles the rendering. We serve the renderedHtml verbatim — no
 * re-rendering, no merge-tag substitution, no link rewriting (the
 * stored renderedHtml is already finalized at send time).
 *
 * The page itself is just an iframe wrapper around the saved HTML so
 * we get a clean visual that doesn't inherit the app's own styles.
 *
 * Token verification + tenant scoping protect against URL guessing.
 */
export default async function WebViewPage({
  params,
}: {
  params: { token: string };
}): Promise<JSX.Element> {
  let verified;
  try {
    verified = verifyEmailToken(params.token);
  } catch {
    notFound();
  }
  if (verified.kind !== 'webview') notFound();

  const send = await prisma.campaignSend.findUnique({
    where: { id: verified.campaignSendId },
    select: {
      id: true,
      tenantId: true,
      campaign: {
        select: {
          name: true,
          emailCampaign: {
            select: { subject: true, renderedHtml: true },
          },
        },
      },
    },
  });
  if (!send || send.tenantId !== verified.tenantId) notFound();
  const ec = send.campaign.emailCampaign;
  if (!ec || !ec.renderedHtml) notFound();

  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="border-b bg-card px-6 py-3">
        <div className="mx-auto max-w-4xl">
          <p className="text-xs text-muted-foreground">
            Web view · {send.campaign.name}
          </p>
          <h1 className="mt-0.5 truncate font-medium">{ec.subject}</h1>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <iframe
            title={ec.subject}
            sandbox="allow-popups"
            srcDoc={ec.renderedHtml}
            className="h-[80vh] w-full"
          />
        </div>
      </div>
    </div>
  );
}
