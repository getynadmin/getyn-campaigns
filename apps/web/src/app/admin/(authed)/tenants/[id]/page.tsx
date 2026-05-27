import { AdminTenantDetailClient } from '@/components/admin/tenant-detail-client';

export const metadata = { title: 'Tenant detail · Staff' };

export default function AdminTenantDetailPage({
  params,
}: {
  params: { id: string };
}): JSX.Element {
  return <AdminTenantDetailClient tenantId={params.id} />;
}
