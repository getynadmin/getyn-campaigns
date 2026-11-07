import { redirect } from 'next/navigation';

export default function ChannelsIndexPage({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/channels/email`);
}
