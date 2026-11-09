import { redirect } from 'next/navigation';

export default function LegacyWhatsappInboxRedirect({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/unified-inbox?tab=whatsapp`);
}
