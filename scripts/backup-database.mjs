#!/usr/bin/env node
/**
 * Database backup via pg_dump (custom format, compressed).
 *
 * Usage:   node scripts/backup-database.mjs [outputDir]
 *          outputDir defaults to ./backups
 *
 * Env:     DATABASE_URL   (or SUPABASE_DATABASE_URL / SUPABASE_DB_URL;
 *                          read from .env at repo root if not set)
 *          BACKUP_KEEP    how many backups to retain (default 14)
 *
 * Requires pg_dump on PATH (PostgreSQL client tools). Restore with:
 *          pg_restore --clean --if-exists -d "$DATABASE_URL" <file>.dump
 *
 * Note: Supabase paid tiers also take daily automated backups + PITR —
 * this script is the independent, off-platform copy. Schedule it daily
 * (cron / Task Scheduler / GitHub Actions with a DATABASE_URL secret).
 * See docs/ops/backup-and-recovery.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function loadEnvFile() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return {};
  const vars = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !line.trim().startsWith("#")) vars[match[1]] = match[2];
  }
  return vars;
}

const fileEnv = loadEnvFile();
const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DATABASE_URL ??
  process.env.SUPABASE_DB_URL ??
  fileEnv.DATABASE_URL ??
  fileEnv.SUPABASE_DATABASE_URL ??
  fileEnv.SUPABASE_DB_URL;

if (!databaseUrl || databaseUrl.includes("[project-ref]")) {
  console.error("✗ DATABASE_URL is not set (env or .env). Aborting.");
  process.exit(1);
}

const outDir = process.argv[2] ?? join(process.cwd(), "backups");
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = join(outDir, `aios-${stamp}.dump`);

console.log(`Backing up to ${outFile} …`);
const result = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", `--file=${outFile}`, databaseUrl],
  { stdio: ["ignore", "inherit", "inherit"] },
);

if (result.error?.code === "ENOENT") {
  console.error("✗ pg_dump not found. Install PostgreSQL client tools and retry.");
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`✗ pg_dump exited with ${result.status}`);
  process.exit(result.status ?? 1);
}

const sizeMb = statSync(outFile).size / (1024 * 1024);
if (sizeMb < 0.01) {
  console.error("✗ Backup file is suspiciously small — treat as failed.");
  process.exit(1);
}
console.log(`✓ Backup complete (${sizeMb.toFixed(2)} MB)`);

// Retention: keep the newest N backups.
const keep = Number(process.env.BACKUP_KEEP ?? 14);
const backups = readdirSync(outDir)
  .filter((f) => f.startsWith("aios-") && f.endsWith(".dump"))
  .sort()
  .reverse();
for (const old of backups.slice(keep)) {
  unlinkSync(join(outDir, old));
  console.log(`  pruned ${old}`);
}
console.log(`Retention: keeping ${Math.min(backups.length, keep)} backup(s) in ${outDir}`);
