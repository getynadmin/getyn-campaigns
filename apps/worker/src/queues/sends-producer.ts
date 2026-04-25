import { Queue } from 'bullmq';

import { QUEUE_NAMES } from '@getyn/types';

import { loadEnv } from '../env';
import { createRedisConnection } from '../redis';

/**
 * Worker-side producer for the `sends` queue. The `prepare-campaign`
 * handler chains into `dispatch-batch` jobs; that chaining happens
 * inside the worker process so we keep one BullMQ Queue instance per
 * worker boot.
 *
 * The web app has its own producer (apps/web/src/server/queues/sends.ts)
 * that fires the initial `prepare-campaign` job from sendNow / schedule.
 *
 * Two producers are intentional: each side keeps its own connection so
 * the worker doesn't depend on the web's process being alive, and vice
 * versa.
 */

const env = loadEnv();
if (!env.REDIS_URL) {
  throw new Error(
    'sendsQueueProducer was imported but REDIS_URL is unset. The worker should not start without it in production.',
  );
}

export const sendsQueueProducer = new Queue(QUEUE_NAMES.sends, {
  connection: createRedisConnection(env.REDIS_URL),
});
