/**
 * Cloudflare Worker entrypoint.
 *
 * Exports the default handler with:
 *   - scheduled()  — triggered by the Cron Trigger (0 3 * * *)
 *   - fetch()      — health-check / liveness probe
 *
 * The actual indexing logic lives in src/worker-indexer.ts.
 * Database access uses Cloudflare D1 via src/db-d1.ts.
 * Configuration is read from Workers env bindings via src/worker-config.ts.
 */

import type {
  ExportedHandler,
  ScheduledController,
  ExecutionContext,
  Request as CfRequest,
  Response as CfResponse,
} from "@cloudflare/workers-types";
import { WorkerEnv } from "./worker-config";
import { runIndexer } from "./worker-indexer";

const handler: ExportedHandler<WorkerEnv> = {
  /**
   * Cron Trigger handler — runs the full indexing pipeline.
   * ctx.waitUntil() keeps the Worker alive until runIndexer() resolves,
   * even after the cron event itself has been acknowledged.
   */
  async scheduled(
    _controller: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runIndexer(env));
  },

  /**
   * HTTP handler — returns a simple health-check response.
   * Useful for confirming the Worker is deployed and reachable.
   */
  async fetch(
    _request: CfRequest,
    _env: WorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<CfResponse> {
    return new Response("CouponsRiver indexing worker OK") as unknown as CfResponse;
  },
};

export default handler;
