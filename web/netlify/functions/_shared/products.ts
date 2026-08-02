import { getSql } from "./db.ts";
import { extractKeywords } from "./knowledge.ts";

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock" | "preorder" | string;

export interface CatalogProduct {
  id: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  stockStatus: StockStatus | null;
  category: string | null;
  tags: string[];
}

function rowToProduct(row: Record<string, unknown>): CatalogProduct {
  const metadata = (row.metadata as Record<string, unknown>) ?? {};
  const priceRaw = row.price;
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.content),
    price: priceRaw === null || priceRaw === undefined ? null : Number(priceRaw),
    currency: row.currency ? String(row.currency) : "USD",
    imageUrl: row.image_url ? String(row.image_url) : null,
    stockStatus: row.stock_status ? (String(row.stock_status) as StockStatus) : null,
    category: metadata.section ? String(metadata.section) : null,
    tags: (row.tags as string[] | null) ?? [],
  };
}

function scoreProduct(product: CatalogProduct, keywords: string[]): number {
  let score = 0;
  const titleLower = product.title.toLowerCase();
  const contentLower = product.description.toLowerCase();
  const tagsLower = product.tags.map((tag) => tag.toLowerCase());

  for (const keyword of keywords) {
    if (titleLower.includes(keyword)) score += 3;
    if (contentLower.includes(keyword)) score += 1;
    if (tagsLower.some((tag) => tag === keyword || tag.includes(keyword))) score += 2;
  }

  return score;
}

async function setWorkspaceContext(workspaceId: string): Promise<void> {
  const db = getSql();
  await db`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
}

async function listProducts(workspaceId: string): Promise<CatalogProduct[]> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const rows = await db`
    SELECT id, title, content, price, currency, image_url, stock_status, tags, metadata
    FROM knowledge_items
    WHERE workspace_id = ${workspaceId}
      AND type = 'entry'
      AND content_type = 'product'
    ORDER BY title ASC
  `;

  return rows.map((row) => rowToProduct(row as Record<string, unknown>));
}

export async function searchProducts(
  workspaceId: string,
  query: string,
  topK = 5,
): Promise<CatalogProduct[]> {
  const keywords = extractKeywords(query);
  const products = await listProducts(workspaceId);

  if (keywords.length === 0) {
    return products.slice(0, topK);
  }

  return products
    .map((product) => ({ product, score: scoreProduct(product, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((entry) => entry.product);
}

export async function getProductById(
  workspaceId: string,
  productId: string,
): Promise<CatalogProduct | null> {
  const db = getSql();
  await setWorkspaceContext(workspaceId);

  const rows = await db`
    SELECT id, title, content, price, currency, image_url, stock_status, tags, metadata
    FROM knowledge_items
    WHERE workspace_id = ${workspaceId}
      AND id = ${productId}
      AND type = 'entry'
      AND content_type = 'product'
    LIMIT 1
  `;

  return rows.length ? rowToProduct(rows[0] as Record<string, unknown>) : null;
}

export async function getRelatedProducts(
  workspaceId: string,
  productId: string,
  limit = 3,
): Promise<CatalogProduct[]> {
  const current = await getProductById(workspaceId, productId);
  if (!current) return [];

  const all = await listProducts(workspaceId);
  const currentPrice = current.price ?? 0;

  return all
    .filter((product) => product.id !== productId)
    .map((product) => {
      let score = 0;
      if (product.category && product.category === current.category) score += 2;
      const sharedTags = product.tags.filter((tag) => current.tags.includes(tag));
      score += sharedTags.length;
      const price = product.price ?? 0;
      if (price > currentPrice) score += 1;
      return { product, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.product);
}

export function formatProductForPrompt(product: CatalogProduct): string {
  const parts = [product.title];
  if (product.price !== null) {
    parts.push(`${product.currency} ${product.price}`);
  }
  if (product.stockStatus) parts.push(`Stock: ${product.stockStatus}`);
  parts.push(product.description);
  return parts.join(" — ");
}

export function formatProductsForPrompt(products: CatalogProduct[]): string {
  if (products.length === 0) {
    return "No matching products found in catalog.";
  }
  return products.map((product) => `- ${formatProductForPrompt(product)}`).join("\n");
}
