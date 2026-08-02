#!/usr/bin/env node
/**
 * Bundle-size budget check for CI.
 *
 * Measures web/dist (the deployed static bundle) and fails when the total
 * or the largest JS chunk exceeds budget. Budgets are deliberately generous
 * — the goal is catching accidental regressions (a mis-imported SDK doubling
 * the bundle), not micro-optimizing.
 *
 * Usage: node scripts/check-bundle-size.mjs   (run after `npm run build`)
 * Override budgets via env: BUNDLE_BUDGET_TOTAL_KB, BUNDLE_BUDGET_CHUNK_KB
 */
import { readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const DIST = join(process.cwd(), "web", "dist");
const TOTAL_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_TOTAL_KB ?? 2048);
const CHUNK_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_CHUNK_KB ?? 800);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push({ path: full, size: stat.size });
  }
  return files;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`✗ ${DIST} not found — run \`npm run build\` first.`);
  process.exit(1);
}

const totalKb = files.reduce((sum, f) => sum + f.size, 0) / 1024;
const jsFiles = files
  .filter((f) => extname(f.path) === ".js")
  .sort((a, b) => b.size - a.size);

console.log(`Bundle report for web/dist`);
console.log(`  total: ${totalKb.toFixed(0)} KB (budget ${TOTAL_BUDGET_KB} KB)`);
console.log(`  largest JS chunks:`);
for (const f of jsFiles.slice(0, 5)) {
  console.log(`    ${(f.size / 1024).toFixed(0).padStart(6)} KB  ${relative(DIST, f.path)}`);
}

let failed = false;
if (totalKb > TOTAL_BUDGET_KB) {
  console.error(`✗ Total bundle ${totalKb.toFixed(0)} KB exceeds budget ${TOTAL_BUDGET_KB} KB`);
  failed = true;
}
const biggest = jsFiles[0];
if (biggest && biggest.size / 1024 > CHUNK_BUDGET_KB) {
  console.error(
    `✗ Chunk ${relative(DIST, biggest.path)} is ${(biggest.size / 1024).toFixed(0)} KB (budget ${CHUNK_BUDGET_KB} KB)`,
  );
  failed = true;
}

if (failed) process.exit(1);
console.log("✓ Bundle within budget");
