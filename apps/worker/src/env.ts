import { z } from 'zod';

/**
 * Worker env schema. Validated at startup so a missing var fails loudly
 * instead of crashing mid-job with a confusing error.
 *
 * REDIS_URL is optional in dev so `pnpm dev` at the monorepo root doesn't
 * crash-loop when a dev hasn't set up Upstash yet — the worker's main
 * module handles the absent value with a clear log message. In production
 * it is required.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  // Supabase Storage access — the worker pulls import CSVs from the `imports`
  // bucket using the service-role key. Required once imports are wired up.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Optional: concurrency per worker. Tune based on Railway instance size.
  WORKER_IMPORTS_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(): WorkerEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[worker] invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.REDIS_URL) {
    console.error('[worker] REDIS_URL is required in production');
    process.exit(1);
  }
  return parsed.data;
}
