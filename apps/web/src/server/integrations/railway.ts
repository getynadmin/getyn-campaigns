/**
 * Phase 5.6 M4a — Railway Worker API resolver.
 *
 * Lets the admin point the worker-control plane at a different
 * Railway project token + worker URL without redeploying. Health
 * check hits the worker's /health endpoint.
 */
import { cache } from 'react';

import { loadIntegration } from './credential-store';

const PROVIDER = 'railway_worker';

export interface RailwayConfig {
  workerUrl: string;
}

export interface RailwaySecrets {
  projectToken: string;
}

export interface ResolvedRailway {
  workerUrl: string | null;
  projectToken: string | null;
  source: 'db' | 'env';
}

async function load(): Promise<ResolvedRailway> {
  const row = await loadIntegration<RailwayConfig, RailwaySecrets>(PROVIDER);
  if (row && row.secrets?.projectToken) {
    return {
      workerUrl: row.config.workerUrl ?? null,
      projectToken: row.secrets.projectToken,
      source: 'db',
    };
  }
  return {
    workerUrl: process.env.WORKER_HEALTH_URL ?? null,
    projectToken: process.env.RAILWAY_PROJECT_TOKEN ?? null,
    source: 'env',
  };
}

export const getRailwayWorker = cache(load);

export async function checkWorkerHealth(args: {
  workerUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = args.workerUrl.replace(/\/$/, '') + '/health';
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Worker returned ${res.status} ${res.statusText}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}
