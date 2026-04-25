'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

import { contactCreateSchema, type ContactCreateInput } from '@getyn/types';

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
import { api } from '@/lib/trpc';

import { TagChip } from './tag-chip';

/**
 * Minimal create-contact form. Collects identity + subscription defaults
 * + tags. Custom fields are edited on the detail page to keep this dialog
 * short — new contacts most often come in via CSV import anyway.
 *
 * EDITORs and above see the trigger; server enforces the role too.
 */
export function NewContactDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const utils = api.useUtils();
  const tagList = api.tags.list.useQuery(undefined, { enabled: open });

  const form = useForm<ContactCreateInput>({
    resolver: zodResolver(contactCreateSchema),
    defaultValues: {
      email: undefined,
      phone: undefined,
      firstName: undefined,
      lastName: undefined,
      emailStatus: 'SUBSCRIBED',
      source: 'MANUAL',
      tagIds: [],
    },
  });

  const create = api.contacts.create.useMutation({
    onSuccess: () => {
      toast.success('Contact created.');
      form.reset();
      setSelectedTagIds([]);
      setOpen(false);
      void utils.contacts.list.invalidate();
      void utils.tags.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleTag = (id: string): void => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          New contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            At least one of email or phone is required.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="new-contact-form"
            onSubmit={form.handleSubmit((v) =>
              create.mutate({
                ...v,
                tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
              }),
            )}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input placeholder="Amelia" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input placeholder="Singh" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="amelia@company.com"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="+15551234567"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="emailStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="SUBSCRIBED">Subscribed</SelectItem>
                      <SelectItem value="PENDING">Pending (double opt-in)</SelectItem>
                      <SelectItem value="UNSUBSCRIBED">Unsubscribed</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {tagList.data && tagList.data.length > 0 ? (
              <div>
                <p className="mb-1 text-sm font-medium">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {tagList.data.map((t) => {
                    const active = selectedTagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.id)}
                        className={
                          active
                            ? 'inline-flex items-center rounded-full border-2 border-ring'
                            : 'inline-flex items-center rounded-full border-2 border-transparent opacity-60 hover:opacity-100'
                        }
                      >
                        <TagChip tag={t} size="sm" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-contact-form" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
