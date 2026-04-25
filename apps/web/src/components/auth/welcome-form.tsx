'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/trpc';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  workspaceName: z.string().min(2, 'Workspace name is too short').max(60),
});

type FormValues = z.infer<typeof schema>;

/**
 * Provisioning step for users who signed in via Google OAuth but don't
 * have a DB User/Tenant/Membership yet. Calls
 * `trpc.onboarding.completeOAuthSignup` and navigates into the new
 * workspace.
 */
export function WelcomeForm({
  defaultName = '',
}: {
  defaultName?: string;
}): JSX.Element {
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: defaultName, workspaceName: '' },
  });

  const complete = api.onboarding.completeOAuthSignup.useMutation({
    onSuccess: ({ tenantSlug }) => {
      toast.success('Workspace created.');
      router.refresh();
      router.push(`/t/${tenantSlug}/dashboard`);
    },
    onError: (err) => toast.error(err.message),
  });

  const onSubmit = (values: FormValues): void => {
    complete.mutate(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Your name</FormLabel>
              <FormControl>
                <Input placeholder="Jane Cooper" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="workspaceName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workspace name</FormLabel>
              <FormControl>
                <Input placeholder="Acme Inc" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={complete.isPending}>
          {complete.isPending ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </Form>
  );
}
