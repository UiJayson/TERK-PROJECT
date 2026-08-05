import type { ModuleManifest } from "../../kernel/adapter.ts";

/**
 * E-Commerce module manifest. Typed const in place of the spec's manifest.json
 * (JSON module imports are not enabled for the functions build). The kernel
 * validates this against the adapter at registration.
 */
export const ECOMMERCE_MANIFEST: ModuleManifest = {
  id: "ecommerce",
  name: "E-Commerce",
  description:
    "Product catalog, inventory, orders, cart, shipping and returns for online stores.",
  version: "1.0.0",
  requiredKernelVersion: "1.0.0",
  capabilities: ["products", "inventory", "orders", "cart", "shipping", "returns"],
  status: "available",
};
