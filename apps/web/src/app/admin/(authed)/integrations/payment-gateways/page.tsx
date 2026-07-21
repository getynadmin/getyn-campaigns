import { PaymentGatewaysClient } from '@/components/admin/integrations/payment-gateways-client';

export const metadata = { title: 'Payment Gateways · Integrations' };

export default function AdminPaymentGatewaysPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Payment Gateways</h1>
        <p className="text-sm text-muted-foreground">
          Providers for tenant subscriptions and one-time charges. XPay
          Checkout powers the public /pricing checkout flow.
        </p>
      </header>
      <PaymentGatewaysClient />
    </div>
  );
}
