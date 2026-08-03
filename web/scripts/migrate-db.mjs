/**
 * Schema migration runner — applies web/supabase/migrations/*.sql in order and
 * records each in a schema_migrations table so it only ever runs once. Replaces
 * the previous manual "paste each file into the Supabase SQL editor" process.
 *
 * Usage:
 *   DATABASE_URL=postgresql://...:6543/postgres node scripts/migrate-db.mjs
 *
 * Flags:
 *   --baseline   Record every existing migration as applied WITHOUT running it.
 *                Use once on a database that was already migrated by hand, so
 *                the runner starts tracking from the current state.
 *   --dry-run    Print what would be applied; make no changes.
 *
 * Each migration runs inside a transaction, except files containing
 * CREATE INDEX CONCURRENTLY (which Postgres forbids in a transaction) — those
 * run directly and are recorded immediately afterwards.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../supabase/migrations",
);

const args = new Set(process.argv.slice(2));
const baseline = args.has("--baseline");
const dryRun = args.has("--dry-run");

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  "";

if (!databaseUrl) {
  console.error(
    "✗ No database URL. Set DATABASE_URL to your Supabase transaction-pooler string (port 6543).",
  );
  process.exit(1);
}

function migrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // numeric filename prefixes sort correctly as strings (001, 002, ...)
}

async function main() {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false, // pgbouncer transaction mode
    idle_timeout: 5,
    connect_timeout: 15,
    onnotice: () => {}, // suppress NOTICE noise from CREATE ... IF NOT EXISTS
  });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const appliedRows = await sql`SELECT version FROM schema_migrations`;
    const applied = new Set(appliedRows.map((r) => String(r.version)));
    const files = migrationFiles();
    const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, "")));

    if (pending.length === 0) {
      console.log(`✓ Up to date — ${files.length} migration(s), nothing pending.`);
      return;
    }

    if (baseline) {
      for (const file of pending) {
        const version = file.replace(/\.sql$/, "");
        if (!dryRun) {
          await sql`INSERT INTO schema_migrations (version) VALUES (${version})
                    ON CONFLICT (version) DO NOTHING`;
        }
        console.log(`  baselined ${file}`);
      }
      console.log(`✓ Baseline complete — ${pending.length} migration(s) marked applied.`);
      return;
    }

    for (const file of pending) {
      const version = file.replace(/\.sql$/, "");
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      const nonTransactional = /create\s+index\s+concurrently/i.test(content);

      if (dryRun) {
        console.log(`  would apply ${file}${nonTransactional ? " (no transaction)" : ""}`);
        continue;
      }

      process.stdout.write(`  applying ${file}${nonTransactional ? " (no transaction)" : ""}... `);
      if (nonTransactional) {
        await sql.unsafe(content);
        await sql`INSERT INTO schema_migrations (version) VALUES (${version})`;
      } else {
        await sql.begin(async (tx) => {
          await tx.unsafe(content);
          await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
        });
      }
      console.log("done");
    }

    console.log(`✓ Applied ${pending.length} migration(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(`✗ Migration failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
