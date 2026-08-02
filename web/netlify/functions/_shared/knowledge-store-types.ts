export const SHARED_FILES = [
  "shared/company.md",
  "shared/products.md",
  "shared/pricing.md",
  "shared/faq.md",
  "shared/policies.md",
  "shared/brand_voice.md",
  "shared/sops.md",
  "shared/documents.md",
] as const;

export const CORE_SHARED_FILES = [
  "shared/company.md",
  "shared/products.md",
  "shared/pricing.md",
  "shared/faq.md",
  "shared/policies.md",
  "shared/brand_voice.md",
] as const;

export type SharedFile = (typeof SHARED_FILES)[number];
export type CoreSharedFile = (typeof CORE_SHARED_FILES)[number];
