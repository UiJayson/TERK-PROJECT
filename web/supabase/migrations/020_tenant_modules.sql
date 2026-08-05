-- Problem 2 (Core Kernel + Vertical Adapter Architecture) — M6.
--
-- Establishes the module-ownership model on the shared multi-tenant database.
-- IMPORTANT: this codebase uses ONE shared Postgres with global, idempotent
-- migrations and app-layer workspace_id isolation. Per-tenant CREATE/DROP TABLE
-- (as the spec sketch suggests) is unsafe on a pooled pgbouncer connection, so
-- module tables are created ONCE here and scoped by workspace_id. A module's
-- onTenantInstall/onTenantUninstall manage tenant ROWS, not DDL.
--
-- The destructive half of M6 — renaming pre-existing industry tables (e.g.
-- availability_slots → appointments_availability, product rows in
-- knowledge_items → ecommerce_products) — is intentionally deferred so the MVP
-- ships without a risky data move. Those tables are logically owned by their
-- module now; the physical rename is a future migration.

-- Registry: which modules each tenant has installed. The kernel reads this at
-- request time to decide which adapters to activate.
CREATE TABLE IF NOT EXISTS tenant_modules (
  workspace_id TEXT NOT NULL,
  module_id    TEXT NOT NULL,
  version      TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_modules_workspace
  ON tenant_modules (workspace_id);

-- ── E-Commerce module-owned tables ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecommerce_settings (
  workspace_id TEXT PRIMARY KEY,
  currency     TEXT NOT NULL DEFAULT 'USD',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  total        NUMERIC(12, 2),
  currency     TEXT NOT NULL DEFAULT 'USD',
  customer_ref TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_workspace
  ON ecommerce_orders (workspace_id, created_at DESC);

-- ── Appointments module-owned tables ───────────────────────────────────────
-- (Live availability calendar remains in the legacy availability_slots table;
--  see migration header. appointments_settings is fully module-owned.)
CREATE TABLE IF NOT EXISTS appointments_settings (
  workspace_id     TEXT PRIMARY KEY,
  slot_minutes     INTEGER NOT NULL DEFAULT 60,
  lead_time_hours  INTEGER NOT NULL DEFAULT 1,
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-scoped tables; app-layer isolation enforces workspace_id on every
-- query. RLS is enabled for defense-in-depth, consistent with the rest of the
-- schema (policies are app-driven; see TENANT_ISOLATION_REPORT.md).
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments_settings ENABLE ROW LEVEL SECURITY;
