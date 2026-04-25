'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MoreHorizontal, Plus } from 'lucide-react';

import {
  customFieldCreateSchema,
  type CustomFieldCreateInput,
} from '@getyn/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/trpc';

const TYPE_LABELS: Record<CustomFieldCreateInput['type'], string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  BOOLEAN: 'Yes / No',
  SELECT: 'Single choice',
};

/**
 * Editor for the tenant's CustomField registry. OWNER/ADMIN only (the
 * server enforces this too — we just don't render the buttons for others).
 */
export function CustomFieldsTable({
  canManage,
}: {
  canManage: boolean;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.customFields.list.useQuery();

  const remove = api.customFields.delete.useMutation({
    onSuccess: () => {
      toast.success('Custom field deleted.');
      void utils.customFields.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define the schema for the contact custom-field bag. Keys are
          slug-style (lowercase, underscores) and unique per workspace.
        </p>
        {canManage ? <NewFieldDialog /> : null}
      </div>

      {(data ?? []).length === 0 ? (
        <div className="rounded-lg border bg-muted/30 px-6 py-10 text-center text-sm text-muted-foreground">
          No custom fields yet. Use them to store things like plan tier,
          lifetime value, or preferred language.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.label}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{f.key}</code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {TYPE_LABELS[f.type]}
                    {f.type === 'SELECT' && f.options
                      ? ` · ${((f.options as { choices?: string[] }).choices ?? []).length} choices`
                      : ''}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => remove.mutate({ id: f.id })}
                          >
                            Delete field
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function NewFieldDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [choicesRaw, setChoicesRaw] = useState('');
  const utils = api.useUtils();

  const form = useForm<CustomFieldCreateInput>({
    resolver: zodResolver(customFieldCreateSchema),
    defaultValues: {
      key: '',
      label: '',
      type: 'TEXT',
      options: null,
    },
  });

  const create = api.customFields.create.useMutation({
    onSuccess: () => {
      toast.success('Field added.');
      form.reset();
      setChoicesRaw('');
      setOpen(false);
      void utils.customFields.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const type = form.watch('type');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          New field
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom field</DialogTitle>
          <DialogDescription>
            Fields live per workspace. Type is immutable — pick carefully.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="new-field-form"
            onSubmit={form.handleSubmit((v) => {
              const body: CustomFieldCreateInput = {
                ...v,
                options:
                  v.type === 'SELECT'
                    ? {
                        choices: choicesRaw
                          .split(/[\n,]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }
                    : null,
              };
              create.mutate(body);
            })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label</FormLabel>
                  <FormControl>
                    <Input placeholder="Plan tier" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Key</FormLabel>
                  <FormControl>
                    <Input placeholder="plan_tier" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="TEXT">Text</SelectItem>
                      <SelectItem value="NUMBER">Number</SelectItem>
                      <SelectItem value="DATE">Date</SelectItem>
                      <SelectItem value="BOOLEAN">Yes / No</SelectItem>
                      <SelectItem value="SELECT">Single choice</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {type === 'SELECT' ? (
              <div>
                <label className="text-sm font-medium" htmlFor="choices">
                  Choices
                </label>
                <textarea
                  id="choices"
                  value={choicesRaw}
                  onChange={(e) => setChoicesRaw(e.target.value)}
                  rows={4}
                  placeholder={'free\nstarter\ngrowth\npro'}
                  className="mt-1.5 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  One per line. Commas also work.
                </p>
              </div>
            ) : null}
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-field-form" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Create field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
