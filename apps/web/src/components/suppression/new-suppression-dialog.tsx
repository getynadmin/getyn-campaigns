'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

import {
  suppressionCreateSchema,
  type SuppressionCreateInput,
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

/**
 * Manual suppression dialog. OWNER/ADMIN only — the trigger button is
 * hidden for everyone else, and the server's `enforceRole` rejects
 * stragglers.
 *
 * Auto-suppressions (UNSUBSCRIBED / BOUNCED / COMPLAINED) flow through the
 * contact-update path, so this form is exclusively for "block this address"
 * requests outside that flow.
 */
export function NewSuppressionDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const utils = api.useUtils();

  const form = useForm<SuppressionCreateInput>({
    resolver: zodResolver(suppressionCreateSchema),
    defaultValues: {
      channel: 'EMAIL',
      value: '',
      reason: 'MANUAL',
      note: '',
    },
  });

  const create = api.suppression.create.useMutation({
    onSuccess: () => {
      toast.success('Address suppressed.');
      void utils.suppression.list.invalidate();
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err.message ?? 'Could not add entry.'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          Add address
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suppress an address</DialogTitle>
          <DialogDescription>
            Phase 3's send pipeline will skip any address on this list.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="channel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Channel</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="EMAIL">Email</SelectItem>
                      <SelectItem value="SMS">SMS</SelectItem>
                      <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={
                        form.watch('channel') === 'EMAIL'
                          ? 'someone@example.com'
                          : '+15555550100'
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Reason for suppressing — internal only"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add to list'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
