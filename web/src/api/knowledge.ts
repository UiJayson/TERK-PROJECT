import { getStoredToken } from "../auth/api";

export type KnowledgeSection =
  | "company"
  | "products"
  | "pricing"
  | "policies"
  | "faqs"
  | "brand_voice"
  | "documents";

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
  document?: {
    filename: string;
    mimeType: string;
    size: number;
  };
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

export const KNOWLEDGE_ITEM_TYPES = [
  "product",
  "service",
  "pricing",
  "faq",
  "policy",
  "document",
] as const;

export type KnowledgeItemType = (typeof KNOWLEDGE_ITEM_TYPES)[number];

export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeItemType, string> = {
  product: "Product",
  service: "Service",
  pricing: "Pricing",
  faq: "FAQ",
  policy: "Policy",
  document: "Document",
};

export const SHARED_KNOWLEDGE_FILES = [
  { path: "shared/company.md", label: "Company", hint: "Name, hours, location, contact" },
  { path: "shared/products.md", label: "Products", hint: "What the business sells" },
  { path: "shared/pricing.md", label: "Pricing", hint: "Prices and packages" },
  { path: "shared/faq.md", label: "FAQ", hint: "Top questions and answers" },
  { path: "shared/brand_voice.md", label: "Brand Voice", hint: "Tone and communication style" },
  { path: "shared/policies.md", label: "Policies", hint: "Refunds, guarantees, terms" },
] as const;

export type SharedKnowledgeFilePath = (typeof SHARED_KNOWLEDGE_FILES)[number]["path"];

async function request(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error ?? "Request failed"));
  }
  return data;
}

export async function fetchKnowledgeItems(input?: {
  section?: KnowledgeSection | "all";
  q?: string;
}): Promise<KnowledgeItem[]> {
  const params = new URLSearchParams();
  if (input?.section && input.section !== "all") params.set("section", input.section);
  if (input?.q?.trim()) params.set("q", input.q.trim());
  const query = params.toString();
  const data = await request(`/api/knowledge${query ? `?${query}` : ""}`);
  return (data.items as KnowledgeItem[]) ?? [];
}

export const KNOWLEDGE_SECTIONS = Object.keys(SECTION_LABELS) as KnowledgeSection[];

export async function createKnowledgeItem(input: {
  section?: KnowledgeSection;
  type: KnowledgeItemType;
  tags?: string;
  title: string;
  content: string;
  imageUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  stockStatus?: string | null;
}): Promise<KnowledgeItem> {
  const data = await request("/api/knowledge", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.item as KnowledgeItem;
}

export async function updateKnowledgeItem(
  id: string,
  input: {
    section?: KnowledgeSection;
    type?: KnowledgeItemType;
    tags?: string;
    title?: string;
    content?: string;
    imageUrl?: string | null;
    price?: number | null;
    currency?: string | null;
    stockStatus?: string | null;
  },
): Promise<KnowledgeItem> {
  const data = await request(`/api/knowledge/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.item as KnowledgeItem;
}

export async function deleteKnowledgeItem(id: string): Promise<void> {
  await request(`/api/knowledge/${id}`, { method: "DELETE" });
}

export async function uploadKnowledgeDocument(
  file: File,
  input: { title: string; type: KnowledgeItemType; tags: string },
): Promise<{ item: KnowledgeItem; chunksIndexed: number }> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", input.title);
  form.append("type", input.type);
  form.append("tags", input.tags);
  const data = await request("/api/knowledge/upload", {
    method: "POST",
    body: form,
  });
  const indexed = data.indexed as { chunksIndexed?: number } | undefined;
  return {
    item: data.item as KnowledgeItem,
    chunksIndexed: indexed?.chunksIndexed ?? 0,
  };
}

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  content: string;
  type: string;
  relevanceScore: number;
}

export async function searchKnowledgeTest(
  query: string,
): Promise<KnowledgeSearchResult[]> {
  const params = new URLSearchParams({ test: "1", q: query.trim() });
  const data = await request(`/api/knowledge?${params.toString()}`);
  return (data.results as KnowledgeSearchResult[]) ?? [];
}

/** @deprecated Use searchKnowledgeTest — keyword search replaces semantic for M14 */
export async function searchKnowledgeSemantic(
  query: string,
): Promise<KnowledgeSearchResult[]> {
  return searchKnowledgeTest(query);
}

export async function fetchSharedKnowledgeFiles(): Promise<Record<string, string>> {
  const data = await request("/api/knowledge?files=1");
  return (data.files as Record<string, string>) ?? {};
}

export async function saveSharedKnowledgeFile(
  path: SharedKnowledgeFilePath,
  content: string,
): Promise<void> {
  await request("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({ path, content }),
  });
}
