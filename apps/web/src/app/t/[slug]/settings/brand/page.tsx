import { BrandSettingsClient } from '@/components/settings/brand/brand-settings-client';

export const metadata = { title: 'Brand profile' };

/**
 * Phase 7 M1 — TenantBrandProfile setup.
 *
 * Filled once per tenant, read by every AI Campaign Agent
 * conversation. Required before the agent can run. The thin shell
 * here renders the form client component which owns all state and
 * tRPC calls.
 */
export default function BrandSettingsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Brand profile
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up once, used by every AI Campaign Agent conversation. The agent
          reads this so the campaigns it drafts sound like your brand.
        </p>
      </div>
      <BrandSettingsClient />
    </div>
  );
}
