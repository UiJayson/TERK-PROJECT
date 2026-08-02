import type { CustomerProfile } from "./memory.ts";
import {
  formatProductsForPrompt,
  getProductById,
  getRelatedProducts,
  searchProducts,
  type CatalogProduct,
} from "./products.ts";

export interface SalesAgentContext {
  pricingAnswer: string | null;
  recommendations: CatalogProduct[];
  upsells: CatalogProduct[];
  crossSells: CatalogProduct[];
  promptBlock: string;
}

function formatPrice(product: CatalogProduct): string {
  if (product.price === null) return "Price not listed";
  return `${product.currency} ${product.price.toFixed(2)}`;
}

export async function handlePricingQuestion(
  workspaceId: string,
  productName: string,
): Promise<{ product: CatalogProduct | null; answer: string }> {
  const matches = await searchProducts(workspaceId, productName, 1);
  const product = matches[0] ?? null;

  if (!product) {
    return {
      product: null,
      answer: `I don't have pricing for "${productName}" in our catalog.`,
    };
  }

  if (product.price === null) {
    return {
      product,
      answer: `${product.title} is in our catalog but no price is listed. I can connect you with the team for a quote.`,
    };
  }

  const stockNote =
    product.stockStatus === "out_of_stock"
      ? " It is currently out of stock."
      : product.stockStatus === "low_stock"
        ? " Stock is limited."
        : "";

  return {
    product,
    answer: `${product.title} is ${formatPrice(product)}.${stockNote}`,
  };
}

export async function handleProductRecommendation(
  workspaceId: string,
  customerProfile: Pick<CustomerProfile, "preferences" | "tags" | "leadData">,
): Promise<CatalogProduct[]> {
  const preferenceHints = [
    ...customerProfile.tags,
    ...Object.values(customerProfile.preferences).map(String),
    ...Object.values(customerProfile.leadData).map(String),
  ]
    .join(" ")
    .trim();

  if (preferenceHints) {
    return searchProducts(workspaceId, preferenceHints, 3);
  }

  const all = await searchProducts(workspaceId, "product service", 5);
  return all.filter((product) => product.stockStatus !== "out_of_stock").slice(0, 3);
}

export async function handleUpsell(
  workspaceId: string,
  currentProduct: CatalogProduct | string,
): Promise<CatalogProduct[]> {
  const product =
    typeof currentProduct === "string"
      ? (await getProductById(workspaceId, currentProduct)) ??
        (await searchProducts(workspaceId, currentProduct, 1))[0] ??
        null
      : currentProduct;

  if (!product) return [];

  const related = await getRelatedProducts(workspaceId, product.id, 5);
  const currentPrice = product.price ?? 0;

  return related
    .filter((item) => (item.price ?? 0) > currentPrice && item.stockStatus !== "out_of_stock")
    .slice(0, 2);
}

export async function handleCrossSell(
  workspaceId: string,
  currentProduct: CatalogProduct | string,
): Promise<CatalogProduct[]> {
  const product =
    typeof currentProduct === "string"
      ? (await getProductById(workspaceId, currentProduct)) ??
        (await searchProducts(workspaceId, currentProduct, 1))[0] ??
        null
      : currentProduct;

  if (!product) return [];

  const related = await getRelatedProducts(workspaceId, product.id, 5);
  const currentPrice = product.price ?? 0;

  return related
    .filter((item) => {
      const price = item.price ?? 0;
      return price <= currentPrice && item.stockStatus !== "out_of_stock";
    })
    .slice(0, 2);
}

export async function buildSalesAgentContext(input: {
  workspaceId: string;
  message: string;
  customerProfile?: Pick<CustomerProfile, "preferences" | "tags" | "leadData"> | null;
}): Promise<SalesAgentContext> {
  const lower = input.message.toLowerCase();
  const isPricing =
    /\b(price|pricing|cost|how much|quote|fee|rate)\b/.test(lower) ||
    /\$\d/.test(lower);

  let pricingAnswer: string | null = null;
  let pricingProduct: CatalogProduct | null = null;

  if (isPricing) {
    const pricing = await handlePricingQuestion(input.workspaceId, input.message);
    pricingAnswer = pricing.answer;
    pricingProduct = pricing.product;
  }

  const recommendations = await handleProductRecommendation(
    input.workspaceId,
    input.customerProfile ?? { preferences: {}, tags: [], leadData: {} },
  );

  const focusProduct =
    pricingProduct ?? recommendations[0] ?? (await searchProducts(input.workspaceId, input.message, 1))[0] ?? null;

  const upsells = focusProduct
    ? await handleUpsell(input.workspaceId, focusProduct)
    : [];
  const crossSells = focusProduct
    ? await handleCrossSell(input.workspaceId, focusProduct)
    : [];

  const lines = [
    "## Product catalog (retrieved — use ONLY these products and prices)",
    "",
    formatProductsForPrompt(recommendations),
  ];

  if (pricingAnswer) {
    lines.push("", "## Pricing answer", pricingAnswer);
  }

  if (upsells.length > 0) {
    lines.push("", "## Upsell options (higher-tier alternatives)", formatProductsForPrompt(upsells));
  }

  if (crossSells.length > 0) {
    lines.push("", "## Cross-sell options (complementary products)", formatProductsForPrompt(crossSells));
  }

  lines.push(
    "",
    "Rules: Never invent products or prices. If the catalog has no match, say so honestly.",
  );

  return {
    pricingAnswer,
    recommendations,
    upsells,
    crossSells,
    promptBlock: lines.join("\n"),
  };
}

export function collectRecommendedProducts(context: SalesAgentContext): CatalogProduct[] {
  const seen = new Set<string>();
  const combined = [
    ...context.recommendations,
    ...context.upsells,
    ...context.crossSells,
  ];

  return combined.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}
