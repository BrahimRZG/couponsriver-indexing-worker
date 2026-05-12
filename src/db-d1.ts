/**
 * Cloudflare D1 database adapter.
 *
 * Mirrors the interface of IndexingDb (src/db.ts) but uses the D1Database
 * binding instead of better-sqlite3. All methods are async because D1
 * operations are async in the Workers runtime.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { UrlRecord } from "./types";

export interface UpsertNewArgs {
  url: string;
  nowIso: string;
  status: number;
  hash: string;
  lastmod: string | null;
}

export interface UpsertChangedArgs {
  url: string;
  nowIso: string;
  status: number;
  hash: string;
  lastmod: string | null;
}

export interface UpsertUnchangedArgs {
  url: string;
  nowIso: string;
  status: number;
  lastmod: string | null;
}

export interface RecordFailureArgs {
  url: string;
  nowIso: string;
  status: number | null;
  error: string;
  lastmod: string | null;
}

export interface MarkSubmittedArgs {
  urls: string[];
  nowIso: string;
}

export interface RunRowInsert {
  startedAt: string;
  targetSite: string;
  dryRun: boolean;
}

export interface RunRowUpdate {
  finishedAt: string;
  discoveredCount: number;
  fetchedCount: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  submittedCount: number;
  failedCount: number;
}

export class D1IndexingDb {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getByUrl(url: string): Promise<UrlRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT url, last_seen_at, first_seen_at, last_submitted_at, last_status,
                last_hash, lastmod_from_sitemap, change_count, submit_count, last_error
           FROM urls
          WHERE url = ?`,
      )
      .bind(url)
      .first<UrlRecord>();
    return row ?? undefined;
  }

  async upsertNew(args: UpsertNewArgs): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO urls (
            url, last_seen_at, first_seen_at, last_status, last_hash,
            lastmod_from_sitemap, change_count, submit_count, last_error
         ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL)`,
      )
      .bind(args.url, args.nowIso, args.nowIso, args.status, args.hash, args.lastmod)
      .run();
  }

  async upsertChanged(args: UpsertChangedArgs): Promise<void> {
    await this.db
      .prepare(
        `UPDATE urls
            SET last_seen_at = ?,
                last_status = ?,
                last_hash = ?,
                lastmod_from_sitemap = ?,
                change_count = change_count + 1,
                last_error = NULL
          WHERE url = ?`,
      )
      .bind(args.nowIso, args.status, args.hash, args.lastmod, args.url)
      .run();
  }

  async upsertUnchanged(args: UpsertUnchangedArgs): Promise<void> {
    await this.db
      .prepare(
        `UPDATE urls
            SET last_seen_at = ?,
                last_status = ?,
                lastmod_from_sitemap = ?,
                last_error = NULL
          WHERE url = ?`,
      )
      .bind(args.nowIso, args.status, args.lastmod, args.url)
      .run();
  }

  async recordFailure(args: RecordFailureArgs): Promise<void> {
    const existing = await this.getByUrl(args.url);
    if (existing) {
      await this.db
        .prepare(
          `UPDATE urls
              SET last_seen_at = ?,
                  last_status = ?,
                  last_error = ?,
                  lastmod_from_sitemap = COALESCE(?, lastmod_from_sitemap)
            WHERE url = ?`,
        )
        .bind(args.nowIso, args.status, args.error, args.lastmod, args.url)
        .run();
    } else {
      await this.db
        .prepare(
          `INSERT INTO urls (
              url, last_seen_at, first_seen_at, last_status, last_hash,
              lastmod_from_sitemap, change_count, submit_count, last_error
           ) VALUES (?, ?, ?, ?, NULL, ?, 0, 0, ?)`,
        )
        .bind(args.url, args.nowIso, args.nowIso, args.status, args.lastmod, args.error)
        .run();
    }
  }

  async markSubmitted(args: MarkSubmittedArgs): Promise<void> {
    // D1 batch() runs multiple statements atomically.
    const stmts = args.urls.map((url) =>
      this.db
        .prepare(
          `UPDATE urls
              SET last_submitted_at = ?,
                  submit_count = submit_count + 1
            WHERE url = ?`,
        )
        .bind(args.nowIso, url),
    );
    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }
  }

  async insertRun(args: RunRowInsert): Promise<number> {
    const result = await this.db
      .prepare(
        `INSERT INTO runs (started_at, target_site, dry_run)
         VALUES (?, ?, ?)`,
      )
      .bind(args.startedAt, args.targetSite, args.dryRun ? 1 : 0)
      .run();
    return result.meta.last_row_id as number;
  }

  async finalizeRun(id: number, args: RunRowUpdate): Promise<void> {
    await this.db
      .prepare(
        `UPDATE runs
            SET finished_at = ?,
                discovered_count = ?,
                fetched_count = ?,
                new_count = ?,
                changed_count = ?,
                unchanged_count = ?,
                submitted_count = ?,
                failed_count = ?
          WHERE id = ?`,
      )
      .bind(
        args.finishedAt,
        args.discoveredCount,
        args.fetchedCount,
        args.newCount,
        args.changedCount,
        args.unchangedCount,
        args.submittedCount,
        args.failedCount,
        id,
      )
      .run();
  }
}
