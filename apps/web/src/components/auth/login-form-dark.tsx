'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

/**
 * Phase 5.7 — dark-themed login form for the new /login design.
 *
 * Logic is unchanged from the original LoginForm: validate, sign in
 * via Supabase Browser, hard-navigate so cookies are picked up. Only
 * the visual layer is new.
 */
export function LoginFormDark(): JSX.Element {
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues): Promise<void> => {
    setSubmitting(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    window.location.href = next && next.startsWith('/') ? next : '/';
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field
        label="Email"
        error={errors.email?.message}
        input={
          <input
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className={INPUT_CLS}
            {...register('email')}
          />
        }
      />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-white/80">Password</label>
          <Link
            href="/forgot-password"
            className="text-xs text-white/70 underline-offset-4 hover:text-white hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            className={INPUT_CLS + ' pr-10'}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-white/60 hover:text-white"
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
          <p className="text-xs text-rose-400">{errors.password.message}</p>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-white/70">
        <input
          type="checkbox"
          className="size-3.5 rounded border-white/20 bg-white/5 accent-fuchsia-500"
        />
        Remember me on this device
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="flex h-11 w-full items-center justify-center rounded-lg bg-white text-sm font-semibold text-[#0A0A0F] shadow-sm transition-colors hover:bg-white/90 disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          'Log In'
        )}
      </button>
    </form>
  );
}

const INPUT_CLS =
  'flex h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 transition-colors focus:border-fuchsia-400/60 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20';

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
      <label className="text-xs font-medium text-white/80">{label}</label>
      {input}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
