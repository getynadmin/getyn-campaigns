'use client';

import { useEffect, useState } from 'react';
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
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const schema = z
  .object({
    password: z.string().min(8, 'At least 8 characters').max(72),
    confirm: z.string().min(1, 'Confirm your password'),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

type FormValues = z.infer<typeof schema>;

/**
 * Landing page for Supabase's recovery email link. When the user clicks
 * through, Supabase sets a short-lived recovery session on this origin;
 * we just need to call `updateUser` with the new password, then send
 * them back to `/login`.
 */
export function ResetPasswordForm(): JSX.Element {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  // Make sure we actually have a recovery session before letting the
  // user type a new password. Without this, a bookmarked /reset-password
  // URL silently fails on submit.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setError(
          'This reset link is invalid or has expired. Request a new one.',
        );
      }
      setReady(true);
    });
  }, []);

  const onSubmit = async (values: FormValues): Promise<void> => {
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.updateUser({
      password: values.password,
    });
    if (err) {
      toast.error(err.message);
      return;
    }
    // Clear the recovery session so the user has to log in fresh.
    await supabase.auth.signOut();
    toast.success('Password updated. Please sign in.');
    router.replace('/login');
  };

  if (!ready) {
    return (
      <p className="text-center text-sm text-muted-foreground">Loading…</p>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
        {error}
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </Form>
  );
}
