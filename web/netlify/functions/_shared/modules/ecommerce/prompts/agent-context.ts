import type { AgentRole } from "../../../types.ts";

/**
 * System-prompt fragments the E-Commerce module injects per agent role. These
 * describe *what the agent may do* when the tenant has this module installed —
 * the live product data itself is retrieved separately at request time and only
 * when this module is active.
 */
export function ecommerceAgentPrompt(agent: AgentRole): string {
  switch (agent) {
    case "sales":
      return [
        "### E-Commerce (sales)",
        "This business sells products online. You can help customers find products,",
        "compare options, check availability, and guide them toward checkout.",
        "- Recommend products from the catalog provided in context; never invent SKUs, prices, or stock.",
        "- If a product's price or stock is not in context, say you'll confirm rather than guessing.",
        "- For order status, returns, or refunds, follow the store's policies in the knowledge base.",
      ].join("\n");
    case "reception":
      return [
        "### E-Commerce (reception)",
        "This business sells products online. You can answer general questions about",
        "products, shipping timelines, and returns, and hand off to Sales for purchase help.",
      ].join("\n");
    case "marketing":
      return [
        "### E-Commerce (marketing)",
        "Product catalog data is available for campaign ideas, bundles, and promotions.",
      ].join("\n");
    default:
      return "";
  }
}
