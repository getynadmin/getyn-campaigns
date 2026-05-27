'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

export function AdminStaffClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.staff.list.useQuery();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'SUPPORT' | 'SUPPORT_ADMIN'>('SUPPORT');

  const invite = adminApi.staff.invite.useMutation({
    onSuccess: () => {
      toast.success('Staff invited.');
      void utils.staff.list.invalidate();
      setEmail('');
      setOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = adminApi.staff.remove.useMutation({
    onSuccess: () => {
      toast.success('Removed.');
      void utils.staff.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-2 size-3.5" /> Add staff
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {(data ?? []).map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{s.email}</p>
                <p className="text-xs text-muted-foreground">
                  {s.role} · added {new Date(s.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove.mutate({ id: s.id })}
                disabled={remove.isPending}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add staff</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="email"
              placeholder="staff@getyn.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPPORT">SUPPORT</SelectItem>
                <SelectItem value="SUPPORT_ADMIN">SUPPORT_ADMIN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => invite.mutate({ email, role })}
              disabled={invite.isPending || email.length < 5}
            >
              {invite.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
