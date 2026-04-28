import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPlugin } from '@prisma/nextjs-monorepo-workaround-plugin';
import { withSentryConfig } from '@sentry/nextjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo packages consumed as raw TS sources — Next compiles them.
  transpilePackages: ['@getyn/crypto', '@getyn/db', '@getyn/types', '@getyn/ui'],
  // Trace files from the MONOREPO root, not apps/web. Without this, Vercel's
  // serverless bundler walks up only as far as apps/web/ and misses files
  // hoisted to the root node_modules — notably Prisma's platform-specific
  // query engine `.so.node` binary. With this pointed at the monorepo root,
  // Vercel copies the full `.prisma/client/` directory (engine + schema)
  // into /var/task/ and Prisma finds the binary at runtime.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    // Don't bundle the Prisma client; let Node resolve it at runtime.
    serverComponentsExternalPackages: ['@prisma/client'],
  },
  images: {
    remotePatterns: [
      // Supabase Storage (avatars, tenant logos) — tighten once the project ref is known.
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  // Prisma's Query Engine is a native .so.node that the Prisma client loads
  // via a dynamic `require()` Webpack can't follow statically. In a pnpm
  // monorepo the engine binary lives under `.pnpm/@prisma+client.../.prisma/
  // client/`, and `outputFileTracingRoot` alone doesn't guarantee it ends up
  // next to the serverless function. This plugin (maintained by Prisma)
  // explicitly copies the engine and schema into the webpack output for each
  // server bundle that uses `@prisma/client`.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins = [...(config.plugins ?? []), new PrismaPlugin()];
    }
    return config;
  },
};

// Sentry wrapping (Phase 4 M0). Source-map upload only fires when
// SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are all set in CI;
// otherwise this is a near-no-op that still wires up the SDK runtime.
// `silent: !process.env.CI` keeps local builds quiet.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_WEB,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Tunnel client → /monitoring to dodge ad blockers that drop sentry.io.
  tunnelRoute: '/monitoring',
  hideSourceMaps: true,
  disableLogger: true,
});
