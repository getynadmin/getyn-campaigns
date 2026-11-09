import { redirect } from 'next/navigation';

export default function LegacyEmailInboxRedirect({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/unified-inbox?tab=email`);
}
