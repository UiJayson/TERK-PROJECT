import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SITE_ID = "9e2c7c5e-f0bb-4320-87ca-0a7a6a586a9b";
const NETLIFY_CONFIG = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "netlify",
  "Config",
  "config.json",
);

const REQUIRED_KEYS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_MODEL",
  "AI_EMBEDDING_MODEL",
  "WHATSAPP_APP_SECRET",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_PUBLIC_KEY",
  "PAYSTACK_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "NOTIFICATION_FROM_EMAIL",
  "ADMIN_ALERT_EMAIL",
  "SENTRY_DSN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_GROWTH",
  "STRIPE_PRICE_PRO",
  "DEFAULT_WORKSPACE_ID",
  "ADMIN_TOKEN",
  "SITE_URL",
];

function loadToken() {
  const raw = fs.readFileSync(NETLIFY_CONFIG, "utf8");
  const config = JSON.parse(raw);
  const user = Object.values(config.users ?? {})[0];
  const token = user?.auth?.token;
  if (!token) throw new Error("Netlify auth token not found in local CLI config");
  return token;
}

function parseEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function upsertEnvVar(token, key, values, scopes = ["production", "deploy-preview"]) {
  const body = {
    key,
    values,
    is_secret: /SECRET|KEY|TOKEN|PASSWORD|DSN|DATABASE_URL/i.test(key),
    scopes,
    context: "all",
  };

  const response = await fetch(`https://api.netlify.com/api/v1/accounts/self/env/${encodeURIComponent(key)}?site_id=${SITE_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok) return "updated";

  if (response.status === 404) {
    const create = await fetch(`https://api.netlify.com/api/v1/accounts/self/env?site_id=${SITE_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!create.ok) {
      const detail = await create.text();
      throw new Error(`Failed to create ${key}: ${create.status} ${detail}`);
    }
    return "created";
  }

  const detail = await response.text();
  throw new Error(`Failed to update ${key}: ${response.status} ${detail}`);
}

async function main() {
  const envPath = path.resolve(".env");
  const fileValues = parseEnvFile(envPath);
  const token = loadToken();

  if (!fileValues.AUTH_SECRET) {
    fileValues.AUTH_SECRET = randomBytes(32).toString("base64");
    console.log("Generated AUTH_SECRET");
  }

  const keys = [...new Set([...REQUIRED_KEYS, ...Object.keys(fileValues)])];
  const set = [];
  const skipped = [];

  for (const key of keys) {
    const value = fileValues[key];
    if (!value) {
      skipped.push(key);
      continue;
    }
    const action = await upsertEnvVar(token, key, [{ value, context: "all" }]);
    set.push(`${key} (${action})`);
  }

  console.log(`Set ${set.length} variables on Netlify:`);
  for (const item of set) console.log(`  - ${item}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} empty variables:`);
    for (const key of skipped) console.log(`  - ${key}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
