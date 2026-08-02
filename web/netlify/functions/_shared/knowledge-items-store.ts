import { createId } from "./auth-crypto.ts";
import { bundledContent } from "./content-bundle.ts";
import { setWorkspaceKnowledgeIds } from "./auth-store.ts";
import * as db from "./db.ts";
import {
  KNOWLEDGE_SECTIONS,
  SECTION_LABELS,
  SECTION_TO_FILE,
  type KnowledgeItem,
  type KnowledgeSection,
} from "./knowledge-types.ts";
import { isKnowledgeItemType, type KnowledgeItemType } from "./knowledge.ts";
import { setKnowledgeFiles } from "./knowledge-store.ts";
import { deleteEmbeddingsForItem, indexKnowledgeEntry } from "./embeddings.ts";

function sectionToType(section: KnowledgeSection): KnowledgeItemType {
  const map: Record<KnowledgeSection, KnowledgeItemType> = {
    company: "service",
    products: "product",
    pricing: "pricing",
    policies: "policy",
    faqs: "faq",
    brand_voice: "service",
    documents: "document",
  };
  return map[section];
}

function parseTags(input?: string | string[]): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((tag) => tag.trim()).filter(Boolean);
  }
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseItemType(input?: string, section?: KnowledgeSection): KnowledgeItemType {
  if (input && isKnowledgeItemType(input)) return input;
  if (section) return sectionToType(section);
  return "service";
}

function seedFromBundle(): KnowledgeItem[] {
  const now = new Date().toISOString();
  return KNOWLEDGE_SECTIONS.map((section) => {
    const file = SECTION_TO_FILE[section];
    const content = (bundledContent[file] ?? "").trim();
    return {
      id: createId("know"),
      section,
      type: sectionToType(section),
      tags: [],
      title: SECTION_LABELS[section],
      content: content || `Add ${SECTION_LABELS[section].toLowerCase()} details here.`,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function compileKnowledgeFiles(items: KnowledgeItem[]): Record<string, string> {
  const files: Record<string, string> = {};

  for (const section of KNOWLEDGE_SECTIONS) {
    const sectionItems = items.filter((item) => item.section === section);
    const file = SECTION_TO_FILE[section];
    const lines = [`# ${SECTION_LABELS[section]}`, ""];

    if (sectionItems.length === 0) {
      lines.push("_No entries yet._", "");
    } else {
      for (const item of sectionItems) {
        lines.push(`## ${item.title}`, "");
        if (item.document) {
          lines.push(
            `> Source document: ${item.document.filename} (${item.document.mimeType})`,
            "",
          );
        }
        lines.push(item.content.trim(), "");
      }
    }

    files[file] = lines.join("\n");
  }

  files["shared/sops.md"] = bundledContent["shared/sops.md"] ?? "# SOPs\n";
  return files;
}

async function indexItemSafe(workspaceId: string, item: KnowledgeItem): Promise<number> {
  try {
    const result = await indexKnowledgeEntry(workspaceId, item);
    return result.chunksIndexed;
  } catch (error) {
    console.warn("Knowledge indexing failed:", error);
    return 0;
  }
}

async function persistAndCompile(workspaceId: string, items: KnowledgeItem[]) {
  await db.saveKnowledgeItems(workspaceId, items);
  const files = compileKnowledgeFiles(items);
  await setKnowledgeFiles(files, workspaceId);
  await setWorkspaceKnowledgeIds(
    workspaceId,
    items.map((item) => item.id),
  );
  return items;
}

export async function listKnowledgeItems(workspaceId: string): Promise<KnowledgeItem[]> {
  let items = await db.getKnowledgeItems(workspaceId);
  if (items.length === 0) {
    items = await persistAndCompile(workspaceId, seedFromBundle());
    for (const item of items) {
      void indexItemSafe(workspaceId, item);
    }
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

export async function createKnowledgeItem(
  workspaceId: string,
  input: {
    section: KnowledgeSection;
    type?: string;
    tags?: string | string[];
    title: string;
    content: string;
    document?: KnowledgeItem["document"];
    imageUrl?: string | null;
    price?: number | null;
    currency?: string | null;
    stockStatus?: string | null;
  },
): Promise<{ item: KnowledgeItem; chunksIndexed: number }> {
  const items = await listKnowledgeItems(workspaceId);
  const now = new Date().toISOString();
  const itemType = parseItemType(input.type, input.section);
  const item: KnowledgeItem = {
    id: createId("know"),
    section: input.section,
    type: itemType,
    tags: parseTags(input.tags),
    title: input.title.trim(),
    content: input.content.trim(),
    imageUrl: input.imageUrl ?? null,
    price: input.price ?? null,
    currency: input.currency ?? null,
    stockStatus: input.stockStatus ?? null,
    document: input.document,
    createdAt: now,
    updatedAt: now,
  };
  items.push(item);
  await persistAndCompile(workspaceId, items);
  const chunksIndexed = await indexItemSafe(workspaceId, item);
  return { item, chunksIndexed };
}

export async function updateKnowledgeItem(
  workspaceId: string,
  itemId: string,
  patch: {
    section?: KnowledgeSection;
    type?: string;
    tags?: string | string[];
    title?: string;
    content?: string;
    imageUrl?: string | null;
    price?: number | null;
    currency?: string | null;
    stockStatus?: string | null;
  },
): Promise<KnowledgeItem> {
  const items = await listKnowledgeItems(workspaceId);
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error("ITEM_NOT_FOUND");

  const current = items[index];
  const updated: KnowledgeItem = {
    ...current,
    section: patch.section ?? current.section,
    type: patch.type ? parseItemType(patch.type, patch.section ?? current.section) : current.type,
    tags: patch.tags !== undefined ? parseTags(patch.tags) : current.tags,
    title: patch.title?.trim() ?? current.title,
    content: patch.content?.trim() ?? current.content,
    imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : current.imageUrl,
    price: patch.price !== undefined ? patch.price : current.price,
    currency: patch.currency !== undefined ? patch.currency : current.currency,
    stockStatus: patch.stockStatus !== undefined ? patch.stockStatus : current.stockStatus,
    updatedAt: new Date().toISOString(),
  };
  items[index] = updated;
  await persistAndCompile(workspaceId, items);
  await indexItemSafe(workspaceId, updated);
  return updated;
}

export async function deleteKnowledgeItem(
  workspaceId: string,
  itemId: string,
): Promise<void> {
  const items = await listKnowledgeItems(workspaceId);
  const next = items.filter((item) => item.id !== itemId);
  if (next.length === items.length) throw new Error("ITEM_NOT_FOUND");
  await deleteEmbeddingsForItem(workspaceId, itemId).catch(() => undefined);
  await persistAndCompile(workspaceId, next);
}

export function searchKnowledgeItems(
  items: KnowledgeItem[],
  query: string,
): KnowledgeItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const haystack = [
      item.title,
      item.content,
      item.section,
      item.type,
      item.tags.join(" "),
      item.document?.filename ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
