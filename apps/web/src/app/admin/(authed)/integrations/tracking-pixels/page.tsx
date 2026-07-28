import { TrackingPixelsClient } from '@/components/admin/integrations/tracking-pixels-client';

export const metadata = { title: 'Tracking Pixels · Integrations' };

export default function AdminTrackingPixelsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Tracking Pixels</h1>
        <p className="text-sm text-muted-foreground">
          Marketing analytics pixels. Enabled pixels fire on the public
          /pricing and /checkout pages, with a Purchase event on the
          confirmation page.
        </p>
      </header>
      <TrackingPixelsClient />
    </div>
  );
}
