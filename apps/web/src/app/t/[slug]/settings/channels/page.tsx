import { redirect } from 'next/navigation';

// Moved out of settings — Workspace → Channels is now its own top-level
// sidebar item with its own email/whatsapp/sms subnav.
export default function LegacyChannelsSettingsRedirect({
  params,
}: {
  params: { slug: string };
}): never {
  redirect(`/t/${params.slug}/channels`);
}
