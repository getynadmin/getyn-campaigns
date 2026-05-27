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

/**
 * Public env (safe for client bundle).
 *
 * CRITICAL: every `NEXT_PUBLIC_*` access below MUST use the literal
 * form `process.env.NEXT_PUBLIC_X`. Webpack's DefinePlugin only
 * statically substitutes literal property accesses at build time —
 * the dynamic form `process.env[name]` (which `requireEnv` uses)
 * silently becomes `undefined` in the browser bundle even when the
 * env var IS configured on Vercel. Phase 1's original `requireEnv`
 * worked server-side because Node reads process.env at runtime; in
 * the browser there's no process.env to read at runtime, so the
 * dynamic path always fails.
 *
 * If you change a key, change BOTH the function name AND the
 * literal access on the same line.
 */
function literalRequire(value: string | undefined, name: string): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: (): string =>
    literalRequire(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      'NEXT_PUBLIC_SUPABASE_URL',
    ),
  supabaseAnonKey: (): string =>
    literalRequire(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ),
  appUrl: (): string =>
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  posthogKey: (): string | undefined =>
    process.env.NEXT_PUBLIC_POSTHOG_KEY &&
    process.env.NEXT_PUBLIC_POSTHOG_KEY.length > 0
      ? process.env.NEXT_PUBLIC_POSTHOG_KEY
      : undefined,
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
