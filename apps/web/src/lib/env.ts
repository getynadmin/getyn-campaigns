/**
 * Centralised env-var access.
 * Throws loudly at first read if a required variable is missing, so the
 * failure lands in `pnpm dev` output instead of surfacing as a late 500.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Public env (safe for client bundle). */
export const publicEnv = {
  supabaseUrl: (): string => requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: (): string => requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  appUrl: (): string =>
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  posthogKey: (): string | undefined => optionalEnv('NEXT_PUBLIC_POSTHOG_KEY'),
  posthogHost: (): string =>
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
};

/** Server-only env. Importing this from a client component will fail the build. */
export const serverEnv = {
  supabaseServiceRoleKey: (): string => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  resendApiKey: (): string | undefined => optionalEnv('RESEND_API_KEY'),
  resendFromEmail: (): string =>
    process.env.RESEND_FROM_EMAIL ??
    'Getyn Campaigns <noreply@getynmail.com>',
  sentryDsn: (): string | undefined => optionalEnv('SENTRY_DSN'),
};
