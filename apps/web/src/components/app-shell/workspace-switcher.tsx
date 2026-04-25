'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

type Tenant = { id: string; name: string; slug: string };

const schema = z.object({
  name: z.string().min(2, 'Workspace name is too short').max(60),
});

type FormValues = z.infer<typeof schema>;

/**
 * Workspace switcher shown in the topbar. Lists every tenant the user
 * belongs to and lets them create a new one without leaving the shell.
 */
export function WorkspaceSwitcher({
  currentSlug,
  tenants,
}: {
  currentSlug: string;
  tenants: Tenant[];
}): JSX.Element {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const utils = api.useUtils();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const create = api.tenant.create.useMutation({
    onSuccess: (tenant) => {
      toast.success('Workspace created.');
      setDialogOpen(false);
      form.reset();
      void utils.tenant.listMine.invalidate();
      void utils.auth.session.invalidate();
      router.refresh();
      router.push(`/t/${tenant.slug}/dashboard`);
    },
    onError: (err) => toast.error(err.message),
  });

  const current = tenants.find((t) => t.slug === currentSlug);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-[200px] justify-between gap-2"
          >
            <span className="truncate">
              {current?.name ?? 'Select workspace'}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[220px]" align="start">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {tenants.map((t) => (
            <DropdownMenuItem key={t.id} asChild>
              <Link
                href={`/t/${t.slug}/dashboard`}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{t.name}</span>
                {t.slug === currentSlug ? (
                  <Check className="size-4 text-primary" />
                ) : null}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new workspace</DialogTitle>
            <DialogDescription>
              You&apos;ll become its owner. The slug is generated automatically
              from the name.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              id="new-workspace-form"
              onSubmit={form.handleSubmit((v) => create.mutate(v))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
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
            </form>
          </Form>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-workspace-form"
              disabled={create.isPending}
            >
              {create.isPending ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
