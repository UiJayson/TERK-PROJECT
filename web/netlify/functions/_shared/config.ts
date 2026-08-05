import type { AIProviderName } from "./ai-providers/types.ts";

const DEV_AUTH_SECRET = "dev-auth-secret-change-me-in-production";
const DEV_ADMIN_TOKEN = "dev-admin-change-me";
const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_NOTIFICATION_FROM = "AI Business OS <onboarding@resend.dev>";
const DEFAULT_SITE_URL = "https://harbor-ai-business-os.netlify.app";

export type ServiceHealthStatus = "connected" | "missing_key";

export interface AppConfig {
  supabase: {
    databaseUrl: string;
  };
  anthropic: {
    provider: AIProviderName;
    apiKey: string | null;
    model: string | null;
    embeddingModel: string;
    openaiApiKey: string | null;
    openaiBaseUrl: string | null;
  };
  whatsapp: {
    appSecret: string | null;
  };
  paystack: {
    secretKey: string | null;
    publicKey: string | null;
    webhookSecret: string | null;
    planStarter: string | null;
    planGrowth: string | null;
    planPro: string | null;
    /** USD→NGN rate used to convert plan prices (which are in USD) to naira. */
    usdToNgn: number;
  };
  resend: {
    apiKey: string | null;
    fromEmail: string;
  };
  sentry: {
    dsn: string | null;
  };
  auth: {
    secret: string;
    /** Derives the AES key for encrypting stored channel tokens. Kept
     * separate from `secret` so rotating the session-signing secret doesn't
     * also break decryption of stored WhatsApp/Instagram tokens. */
    secretEncryptionKey: string;
    defaultWorkspaceId: string;
    adminToken: string;
    adminAlertEmail: string | null;
  };
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
    priceStarter: string | null;
    priceGrowth: string | null;
    pricePro: string | null;
  };
  app: {
    siteUrl: string;
    /** Shared secret authenticating the sync-webhook → background-function
     * hop. Sync front-doors send it in `x-internal-secret`; background
     * functions reject requests without it in production. Null in dev. */
    internalWebhookSecret: string | null;
  };
  runtime: {
    nodeEnv: string;
    context: string;
    isProduction: boolean;
  };
}

const ENV_HELP: Record<string, string> = {
  DATABASE_URL:
    "Missing DATABASE_URL. Get your Supabase connection string at supabase.com/dashboard → Project Settings → Database (Transaction pooler, port 6543).",
  AUTH_SECRET:
    "Missing AUTH_SECRET. Generate one with: openssl rand -base64 32",
  SECRET_ENCRYPTION_KEY:
    "Missing SECRET_ENCRYPTION_KEY. Generate one with: openssl rand -base64 32 " +
    "(encrypts stored channel tokens — keep separate from AUTH_SECRET so rotating " +
    "one doesn't break the other).",
  ANTHROPIC_API_KEY:
    "Missing ANTHROPIC_API_KEY. Get one at console.anthropic.com/settings/keys",
  OPENAI_API_KEY:
    "Missing OPENAI_API_KEY. Get one at platform.openai.com/api-keys",
  OPENAI_BASE_URL:
    "Missing OPENAI_BASE_URL. Set your Netlify AI Gateway URL in Netlify Dashboard → Site → AI → Gateway",
};

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^your[-_]/i,
  /yourdomain\.com/i,
  /your-site\.netlify\.app/i,
  /\[password\]/i,
  /\[project-ref\]/i,
  /\[region\]/i,
  /\[key\]/i,
  /examplepublickey/i,
  /change-me/i,
  /xxxxxxxx/i,
  /^sk-ant-api03-x+$/i,
  /^sk-proj-x+$/i,
  /^sk_test_x+$/i,
  /^sk_live_x+$/i,
  /^pk_test_x+$/i,
  /^pk_live_x+$/i,
  /^re_x+$/i,
  /^whsec_x+$/i,
];

let cachedConfig: AppConfig | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() ? value.trim() : undefined;
}

function missingEnvError(name: string): Error {
  return new Error(ENV_HELP[name] ?? `Missing ${name}. See .env.example for setup instructions.`);
}

function resolveProviderName(raw: string | undefined): AIProviderName {
  const value = (raw ?? "anthropic").toLowerCase();
  if (value === "openai" || value === "anthropic" || value === "netlify") {
    return value;
  }
  return "anthropic";
}

function resolveDatabaseUrl(): string {
  return (
    readEnv("DATABASE_URL") ??
    readEnv("SUPABASE_DATABASE_URL") ??
    readEnv("SUPABASE_DB_URL") ??
    // Netlify Database (GA) / legacy Neon extension aliases
    readEnv("NETLIFY_DB_URL") ??
    readEnv("NETLIFY_DATABASE_URL") ??
    ""
  );
}

function resolveAuthSecret(isProduction: boolean): string {
  const secret = readEnv("AUTH_SECRET");
  if (secret && isConfiguredSecret(secret)) return secret;
  if (isProduction) {
    throw missingEnvError("AUTH_SECRET");
  }
  return DEV_AUTH_SECRET;
}

function resolveSecretEncryptionKey(isProduction: boolean, authSecret: string): string {
  const key = readEnv("SECRET_ENCRYPTION_KEY");
  if (key && isConfiguredSecret(key)) return key;

  // Fall back to the auth secret so existing deployments keep working
  // without a hard cutover. Warn in production so the gap is visible in
  // logs until a dedicated key is set.
  if (isProduction) {
    console.warn(
      "SECRET_ENCRYPTION_KEY not set — falling back to AUTH_SECRET for token " +
        "encryption. Set a dedicated SECRET_ENCRYPTION_KEY (openssl rand -base64 32) " +
        "so rotating AUTH_SECRET doesn't also break decryption of stored channel tokens.",
    );
  }
  return authSecret;
}

function resolveAdminToken(isProduction: boolean): string {
  const token = readEnv("ADMIN_TOKEN");
  if (token && isConfiguredSecret(token)) return token;
  // In production an unconfigured admin token disables admin endpoints
  // entirely (empty token never matches) instead of falling back to the
  // well-known dev default.
  return isProduction ? "" : DEV_ADMIN_TOKEN;
}

function resolveSiteUrl(): string {
  return (
    readEnv("URL") ??
    readEnv("DEPLOY_PRIME_URL") ??
    readEnv("DEPLOY_URL") ??
    readEnv("SITE_URL") ??
    DEFAULT_SITE_URL
  );
}

function resolveInternalWebhookSecret(isProduction: boolean): string | null {
  const raw = readEnv("INTERNAL_WEBHOOK_SECRET");
  if (raw && isConfiguredSecret(raw)) return raw;
  // In production the background function refuses unauthenticated calls;
  // in dev (and when the secret is missing) we let the hop through so
  // `netlify dev` still works end-to-end.
  if (isProduction) {
    console.warn(
      "INTERNAL_WEBHOOK_SECRET not set — background webhook processors " +
        "will refuse the sync→background hop. Generate one with " +
        "`openssl rand -base64 32` and set it in Netlify env vars.",
    );
  }
  return null;
}

/** True when a value is present and not a documented placeholder/example. */
export function isConfiguredSecret(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const normalized = value.trim();
  if (normalized.length < 8) return false;
  return !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function requireConfiguredSecret(name: string, value: string | undefined): string {
  if (!isConfiguredSecret(value)) {
    throw missingEnvError(name);
  }
  return value!.trim();
}

export function loadConfig(): AppConfig {
  const nodeEnv = readEnv("NODE_ENV") ?? "development";
  const context = readEnv("CONTEXT") ?? "";
  const isProduction = nodeEnv === "production" || context === "production";

  const databaseUrl = requireConfiguredSecret(
    "DATABASE_URL",
    resolveDatabaseUrl() || undefined,
  );

  const authSecret = resolveAuthSecret(isProduction);

  const provider = resolveProviderName(readEnv("AI_PROVIDER"));
  const anthropicApiKey = readEnv("ANTHROPIC_API_KEY") ?? null;
  const openaiApiKey = readEnv("OPENAI_API_KEY") ?? null;
  const openaiBaseUrl = readEnv("OPENAI_BASE_URL") ?? null;

  if (isProduction && provider === "anthropic" && !isConfiguredSecret(anthropicApiKey)) {
    throw missingEnvError("ANTHROPIC_API_KEY");
  }

  if (isProduction && provider === "openai" && !isConfiguredSecret(openaiApiKey)) {
    throw missingEnvError("OPENAI_API_KEY");
  }

  if (
    isProduction &&
    provider === "netlify" &&
    (!isConfiguredSecret(openaiApiKey) || !isConfiguredSecret(openaiBaseUrl))
  ) {
    if (!isConfiguredSecret(openaiApiKey)) throw missingEnvError("OPENAI_API_KEY");
    throw missingEnvError("OPENAI_BASE_URL");
  }

  return {
    supabase: {
      databaseUrl,
    },
    anthropic: {
      provider,
      apiKey: anthropicApiKey,
      model: readEnv("AI_MODEL") ?? null,
      embeddingModel: readEnv("AI_EMBEDDING_MODEL") ?? DEFAULT_EMBEDDING_MODEL,
      openaiApiKey,
      openaiBaseUrl,
    },
    whatsapp: {
      appSecret: readEnv("WHATSAPP_APP_SECRET") ?? readEnv("META_APP_SECRET") ?? null,
    },
    paystack: {
      secretKey: readEnv("PAYSTACK_SECRET_KEY") ?? null,
      publicKey: readEnv("PAYSTACK_PUBLIC_KEY") ?? null,
      webhookSecret: readEnv("PAYSTACK_WEBHOOK_SECRET") ?? null,
      planStarter: readEnv("PAYSTACK_PLAN_STARTER") ?? null,
      planGrowth: readEnv("PAYSTACK_PLAN_GROWTH") ?? null,
      planPro: readEnv("PAYSTACK_PLAN_PRO") ?? null,
      // Plan prices are defined in USD; Paystack charges in NGN. Override with
      // PAYSTACK_USD_TO_NGN to track the real rate. Default is a deliberately
      // recent-ballpark figure, NOT the old implicit "$1 = ₦100" that made a
      // $9 plan charge ~₦900.
      usdToNgn: Number(readEnv("PAYSTACK_USD_TO_NGN") ?? "1600") || 1600,
    },
    resend: {
      apiKey: readEnv("RESEND_API_KEY") ?? null,
      fromEmail: readEnv("NOTIFICATION_FROM_EMAIL") ?? DEFAULT_NOTIFICATION_FROM,
    },
    sentry: {
      dsn: readEnv("SENTRY_DSN") ?? null,
    },
    auth: {
      secret: authSecret,
      secretEncryptionKey: resolveSecretEncryptionKey(isProduction, authSecret),
      defaultWorkspaceId: readEnv("DEFAULT_WORKSPACE_ID") ?? DEFAULT_WORKSPACE_ID,
      adminToken: resolveAdminToken(isProduction),
      adminAlertEmail: readEnv("ADMIN_ALERT_EMAIL") ?? null,
    },
    stripe: {
      secretKey: readEnv("STRIPE_SECRET_KEY") ?? null,
      webhookSecret: readEnv("STRIPE_WEBHOOK_SECRET") ?? null,
      priceStarter: readEnv("STRIPE_PRICE_STARTER") ?? null,
      priceGrowth: readEnv("STRIPE_PRICE_GROWTH") ?? null,
      pricePro: readEnv("STRIPE_PRICE_PRO") ?? null,
    },
    app: {
      siteUrl: resolveSiteUrl(),
      internalWebhookSecret: resolveInternalWebhookSecret(isProduction),
    },
    runtime: {
      nodeEnv,
      context,
      isProduction,
    },
  };
}

/** Validated application config (singleton, loaded on first access). */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function isProduction(): boolean {
  return getConfig().runtime.isProduction;
}

export function getSiteUrl(): string {
  return getConfig().app.siteUrl;
}

function serviceStatus(value: string | null | undefined): ServiceHealthStatus {
  return isConfiguredSecret(value) ? "connected" : "missing_key";
}

export function getServiceHealth(): Record<string, ServiceHealthStatus> {
  const databaseUrl = resolveDatabaseUrl();
  const whatsappSecret = readEnv("WHATSAPP_APP_SECRET") ?? readEnv("META_APP_SECRET") ?? null;

  return {
    supabase: serviceStatus(databaseUrl),
    anthropic: serviceStatus(readEnv("ANTHROPIC_API_KEY")),
    whatsapp: serviceStatus(whatsappSecret),
    paystack: serviceStatus(readEnv("PAYSTACK_SECRET_KEY")),
    resend: serviceStatus(readEnv("RESEND_API_KEY")),
    sentry: serviceStatus(readEnv("SENTRY_DSN")),
  };
}
