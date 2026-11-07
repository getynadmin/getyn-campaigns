import { redirect } from 'next/navigation';

/**
 * Settings landing — now defaults to the user's My Profile tab (the
 * first tab in the strip).
 */
export default function SettingsLanding({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/settings/profile`);
}
