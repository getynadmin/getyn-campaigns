import { redirect } from 'next/navigation';

export default function LegacySmsRedirect({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/campaigns?kind=SMS`);
}
