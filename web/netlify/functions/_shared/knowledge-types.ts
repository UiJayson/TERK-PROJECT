export const KNOWLEDGE_SECTIONS = [
  "company",
  "products",
  "pricing",
  "policies",
  "faqs",
  "brand_voice",
  "documents",
] as const;

export type KnowledgeSection = (typeof KNOWLEDGE_SECTIONS)[number];

export interface KnowledgeDocumentMeta {
  filename: string;
  mimeType: string;
  size: number;
}

export interface KnowledgeItem {
  id: string;
  section: KnowledgeSection;
  type: string;
  tags: string[];
  title: string;
  content: string;
  imageUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  stockStatus?: string | null;
  document?: KnowledgeDocumentMeta;
  createdAt: string;
  updatedAt: string;
}

export const SECTION_LABELS: Record<KnowledgeSection, string> = {
  company: "Company Information",
  products: "Products",
  pricing: "Pricing",
  policies: "Policies",
  faqs: "FAQs",
  brand_voice: "Brand Voice",
  documents: "Documents",
};

export const SECTION_TO_FILE: Record<KnowledgeSection, string> = {
  company: "shared/company.md",
  products: "shared/products.md",
  pricing: "shared/pricing.md",
  policies: "shared/policies.md",
  faqs: "shared/faq.md",
  brand_voice: "shared/brand_voice.md",
  documents: "shared/documents.md",
};

export function isKnowledgeSection(value: string): value is KnowledgeSection {
  return (KNOWLEDGE_SECTIONS as readonly string[]).includes(value);
}
