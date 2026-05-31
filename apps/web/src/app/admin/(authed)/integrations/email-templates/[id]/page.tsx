import { EmailTemplateEditorClient } from '@/components/admin/integrations/email-template-editor-client';

export const metadata = { title: 'Edit template · Integrations' };

export default function AdminEmailTemplateEditPage({
  params,
}: {
  params: { id: string };
}): JSX.Element {
  return <EmailTemplateEditorClient templateId={params.id} />;
}
