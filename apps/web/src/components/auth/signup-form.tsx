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
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be 72 characters or fewer'),
});

type FormValues = z.infer<typeof schema>;

/**
 * Email/password signup form. Calls `trpc.signup.create`, which:
 *   1. Creates the Supabase auth user (and sets cookies on the response).
 *   2. Creates User + Tenant + OWNER Membership in one transaction.
 *   3. Returns the tenant slug so we can push to the dashboard.
 *
 * On success we do a `router.refresh()` first so the server-side auth
 * state is picked up, then navigate into the new workspace.
 */
export function SignupForm(): JSX.Element {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', workspaceName: '', email: '', password: '' },
  });

  const signUp = api.signup.create.useMutation({
    onSuccess: ({ tenantSlug }) => {
      toast.success('Workspace created.');
      // Refresh so middleware sees the new Supabase session cookie,
      // then navigate to the workspace dashboard.
      router.refresh();
      router.push(`/t/${tenantSlug}/dashboard`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const onSubmit = (values: FormValues): void => {
    signUp.mutate(values);
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
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Work email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={signUp.isPending}>
          {signUp.isPending ? 'Creating workspace…' : 'Create workspace'}
        </Button>
      </form>
    </Form>
  );
}
