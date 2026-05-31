'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export function SmsServersPlaceholderClient(): JSX.Element {
  return (
    <Tabs defaultValue="twilio" className="space-y-4">
      <TabsList>
        <TabsTrigger value="twilio">Twilio</TabsTrigger>
        <TabsTrigger value="msg91">MSG91</TabsTrigger>
      </TabsList>
      <TabsContent value="twilio">
        <PlaceholderForm
          fields={[
            ['Account SID', 'AC…'],
            ['Auth Token', '••••••••'],
            ['From Number', '+15551234567'],
          ]}
        />
      </TabsContent>
      <TabsContent value="msg91">
        <PlaceholderForm
          fields={[
            ['Auth Key', '••••••••'],
            ['Sender ID', 'GETYN'],
            ['Route', 'transactional'],
          ]}
        />
      </TabsContent>
    </Tabs>
  );
}

function PlaceholderForm({
  fields,
}: {
  fields: [string, string][];
}): JSX.Element {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Coming soon
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map(([label, placeholder]) => (
          <div key={label} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input disabled placeholder={placeholder} />
          </div>
        ))}
      </div>
    </section>
  );
}
