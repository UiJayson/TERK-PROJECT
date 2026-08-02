import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "netlify", "functions");

const files = [
  "analytics-summary.ts",
  "notifications.ts",
  "leads.ts",
  "auth-reset-password.ts",
  "auth-forgot-password.ts",
  "settings.ts",
  "agents.ts",
  "channels.ts",
  "agents-test.ts",
  "conversations.ts",
  "knowledge-upload.ts",
  "knowledge.ts",
  "auth-register.ts",
  "auth-login.ts",
  "billing.ts",
  "chat.ts",
  "whatsapp-webhook.ts",
  "instagram-webhook.ts",
  "appointment-reminders.ts",
  "admin-profile.ts",
  "auth-me.ts",
  "auth-logout.ts",
  "admin-knowledge.ts",
  "observability-health.ts",
  "observability-alerts.ts",
  "api/billing/subscribe.ts",
  "api/billing/webhook.ts",
];

for (const relativePath of files) {
  const filePath = join(root, relativePath);
  let source = readFileSync(filePath, "utf8");
  if (source.includes("withObservability")) continue;

  const importPath = relativePath.startsWith("api/")
    ? "../../_shared/observability.ts"
    : "./_shared/observability.ts";

  if (!source.includes("withObservability")) {
    source = source.replace(
      /from "@netlify\/functions";/,
      `from "@netlify/functions";\nimport { withObservability } from "${importPath}";`,
    );
  }

  if (/export default async/.test(source)) {
    source = source.replace("export default async", "async function handler");
    source = source.trimEnd() + "\n\nexport default withObservability(handler);\n";
  } else if (/export default async function/.test(source)) {
    source = source.replace("export default async function handler", "async function handler");
    source = source.trimEnd() + "\n\nexport default withObservability(handler);\n";
  }

  writeFileSync(filePath, source);
  console.log("wrapped", relativePath);
}
