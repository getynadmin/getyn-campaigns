import { AnthropicIntegrationClient } from '@/components/admin/integrations/anthropic-integration-client';

export const metadata = { title: 'AI LLMs · Integrations' };

export default function AdminAiLlmsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">AI LLMs</h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide LLM credentials. Powers the Campaign Agent (chat)
          and template drafting across every tenant — one key, one bill.
          Tenants don&rsquo;t see or manage this.
        </p>
      </header>
      <AnthropicIntegrationClient />
    </div>
  );
}
