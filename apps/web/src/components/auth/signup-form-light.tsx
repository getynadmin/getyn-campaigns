'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
 * Phase 5.7 — light-themed signup form for the new /signup design.
 *
 * Logic is unchanged from the original SignupForm: validate, call
 * trpc.signup.create, route to the new workspace dashboard. Only
 * the visual layer is new.
 */
export function SignupFormLight(): JSX.Element {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', workspaceName: '', email: '', password: '' },
  });

  const signUp = api.signup.create.useMutation({
    onSuccess: ({ tenantSlug }) => {
      toast.success('Workspace created.');
      router.refresh();
      router.push(`/t/${tenantSlug}/dashboard`);
    },
    onError: (err) => toast.error(err.message),
  });

  const onSubmit = (values: FormValues): void => {
    signUp.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field
        label="Full Name"
        error={errors.name?.message}
        input={
          <input
            placeholder="Jane Cooper"
            autoComplete="name"
            className={INPUT_CLS}
            {...register('name')}
          />
        }
      />
      <Field
        label="Organization Name"
        error={errors.workspaceName?.message}
        input={
          <input
            placeholder="Acme Inc"
            className={INPUT_CLS}
            {...register('workspaceName')}
          />
        }
      />
      <Field
        label="Email"
        error={errors.email?.message}
        input={
          <input
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            className={INPUT_CLS}
            {...register('email')}
          />
        }
      />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Password</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            className={INPUT_CLS + ' pr-10'}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
        </div>
        {errors.password?.message && (
          <p className="text-xs text-rose-600">{errors.password.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={signUp.isPending}
        className="flex h-11 w-full items-center justify-center rounded-lg bg-emerald-500 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-60"
      >
        {signUp.isPending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Creating account…
          </>
        ) : (
          'Create Account'
        )}
      </button>
    </form>
  );
}

const INPUT_CLS =
  'flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/15';

function Field({
  label,
  input,
  error,
}: {
  label: string;
  input: React.ReactNode;
  error?: string;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {input}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
