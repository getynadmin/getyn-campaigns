import { redirect } from 'next/navigation';

export default function LegacyEmailAgentsRedirect({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/automation/autonomous?tab=email`);
}
