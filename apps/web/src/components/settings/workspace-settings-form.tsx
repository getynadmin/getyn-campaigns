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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/trpc';

const schema = z.object({
  name: z.string().min(2).max(60),
  slug: z
    .string()
    .min(3, 'At least 3 characters')
    .max(40)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Lowercase letters, numbers, and single dashes only',
    ),
});

type FormValues = z.infer<typeof schema>;

/**
 * Edit workspace name + slug. Only OWNER/ADMIN can submit; the server
 * enforces the role. Slug changes redirect the router to the new URL.
 */
export function WorkspaceSettingsForm({
  defaults,
  canEdit,
}: {
  defaults: { name: string; slug: string };
  canEdit: boolean;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  const update = api.tenant.update.useMutation({
    onSuccess: (tenant) => {
      toast.success('Workspace updated.');
      void utils.tenant.listMine.invalidate();
      if (tenant.slug !== defaults.slug) {
        router.replace(`/t/${tenant.slug}/settings`);
      } else {
        router.refresh();
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => update.mutate(v))}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workspace name</FormLabel>
              <FormControl>
                <Input {...field} disabled={!canEdit} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug</FormLabel>
              <FormControl>
                <Input {...field} disabled={!canEdit} />
              </FormControl>
              <FormDescription>
                Used in the URL: app.getyn.com/t/<strong>{field.value || 'your-slug'}</strong>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {canEdit ? (
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only owners and admins can edit these fields.
          </p>
        )}
      </form>
    </Form>
  );
}
