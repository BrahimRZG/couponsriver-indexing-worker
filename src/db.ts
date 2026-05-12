import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { UrlRecord } from "./types";

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

export class IndexingDb {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    const dir = path.dirname(databasePath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS urls (
        url TEXT PRIMARY KEY,
        last_seen_at TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_submitted_at TEXT,
        last_status INTEGER,
        last_hash TEXT,
        lastmod_from_sitemap TEXT,
        change_count INTEGER NOT NULL DEFAULT 0,
        submit_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        target_site TEXT NOT NULL,
        discovered_count INTEGER DEFAULT 0,
        fetched_count INTEGER DEFAULT 0,
        new_count INTEGER DEFAULT 0,
        changed_count INTEGER DEFAULT 0,
        unchanged_count INTEGER DEFAULT 0,
        submitted_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        dry_run INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  getByUrl(url: string): UrlRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT url, last_seen_at, first_seen_at, last_submitted_at, last_status,
                last_hash, lastmod_from_sitemap, change_count, submit_count, last_error
           FROM urls
          WHERE url = ?`,
      )
      .get(url) as UrlRecord | undefined;
    return row;
  }

  upsertNew(args: UpsertNewArgs): void {
    this.db
      .prepare(
        `INSERT INTO urls (
            url, last_seen_at, first_seen_at, last_status, last_hash,
            lastmod_from_sitemap, change_count, submit_count, last_error
         ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL)`,
      )
      .run(args.url, args.nowIso, args.nowIso, args.status, args.hash, args.lastmod);
  }

  upsertChanged(args: UpsertChangedArgs): void {
    this.db
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
      .run(args.nowIso, args.status, args.hash, args.lastmod, args.url);
  }

  upsertUnchanged(args: UpsertUnchangedArgs): void {
    this.db
      .prepare(
        `UPDATE urls
            SET last_seen_at = ?,
                last_status = ?,
                lastmod_from_sitemap = ?,
                last_error = NULL
          WHERE url = ?`,
      )
      .run(args.nowIso, args.status, args.lastmod, args.url);
  }

  recordFailure(args: RecordFailureArgs): void {
    const existing = this.getByUrl(args.url);
    if (existing) {
      this.db
        .prepare(
          `UPDATE urls
              SET last_seen_at = ?,
                  last_status = ?,
                  last_error = ?,
                  lastmod_from_sitemap = COALESCE(?, lastmod_from_sitemap)
            WHERE url = ?`,
        )
        .run(args.nowIso, args.status, args.error, args.lastmod, args.url);
    } else {
      this.db
        .prepare(
          `INSERT INTO urls (
              url, last_seen_at, first_seen_at, last_status, last_hash,
              lastmod_from_sitemap, change_count, submit_count, last_error
           ) VALUES (?, ?, ?, ?, NULL, ?, 0, 0, ?)`,
        )
        .run(args.url, args.nowIso, args.nowIso, args.status, args.lastmod, args.error);
    }
  }

  markSubmitted(args: MarkSubmittedArgs): void {
    const stmt = this.db.prepare(
      `UPDATE urls
          SET last_submitted_at = ?,
              submit_count = submit_count + 1
        WHERE url = ?`,
    );
    const tx = this.db.transaction((urls: string[]) => {
      for (const u of urls) stmt.run(args.nowIso, u);
    });
    tx(args.urls);
  }

  insertRun(args: RunRowInsert): number {
    const result = this.db
      .prepare(
        `INSERT INTO runs (started_at, target_site, dry_run)
         VALUES (?, ?, ?)`,
      )
      .run(args.startedAt, args.targetSite, args.dryRun ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  finalizeRun(id: number, args: RunRowUpdate): void {
    this.db
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
      .run(
        args.finishedAt,
        args.discoveredCount,
        args.fetchedCount,
        args.newCount,
        args.changedCount,
        args.unchangedCount,
        args.submittedCount,
        args.failedCount,
        id,
      );
  }

  close(): void {
    this.db.close();
  }
}
