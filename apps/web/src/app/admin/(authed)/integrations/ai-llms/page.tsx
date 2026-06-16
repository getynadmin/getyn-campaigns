import { AnthropicIntegrationClient } from '@/components/admin/integrations/anthropic-integration-client';
import { DalleIntegrationClient } from '@/components/admin/integrations/dalle-integration-client';

export const metadata = { title: 'AI LLMs · Integrations' };

export default function AdminAiLlmsPage(): JSX.Element {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-xl font-semibold">AI LLMs</h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide AI credentials. Powers the Campaign Agent (chat),
          template drafting, attachment summarization, and OpenAI image
          generation across every tenant — one key per provider, one bill.
          Tenants don&rsquo;t see or manage this.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold">
          Anthropic (Claude)
        </h2>
        <AnthropicIntegrationClient />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold">
          Image Generation (gpt-image-2)
        </h2>
        <DalleIntegrationClient />
      </section>
    </div>
  );
}
