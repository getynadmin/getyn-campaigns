import { redirect } from 'next/navigation';

export default function LegacyWhatsappAgentsRedirect({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/automation/autonomous?tab=whatsapp`);
}
