import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sharedDir = path.join(repoRoot, "shared");
const profile = JSON.parse(
  fs.readFileSync(path.join(sharedDir, "workspace.profile.json"), "utf8"),
);

const { company, products, pricing, faqs, brandVoice, policies } = profile;

const files = {
  "company.md": `# Company

> **Step 2 — Shared Knowledge.** Everything every agent should know about the business lives here.
> Edit via Admin UI or \`workspace.profile.json\`, then run \`npm run generate:shared\`.

## Company Name

${company.name}

## Mission

${company.mission}

## Vision

${company.vision}

## Business Description

${company.businessDescription}

## Operating Hours

| Day | Hours |
| --- | --- |
| Weekdays | ${company.operatingHours.weekdays} |
| Saturday | ${company.operatingHours.saturday} |
| Sunday | ${company.operatingHours.sunday} |

## Locations

${company.locations.map((loc) => `- **${loc.name}:** ${loc.address}`).join("\n")}
- **Service area:** ${company.serviceArea}

## Contact Information

- **Email:** ${company.contact.email}
- **Phone:** ${company.contact.phone}
- **Website:** ${company.contact.website}
- **Urgent (access, safety):** ${company.contact.urgentPhone}
`,

  "products.md": `# Products

> **Step 2 — Shared Knowledge.** Canonical product and service facts for all agents.

${products
  .map(
    (product) => `## ${product.name}

### Description

${product.description}

### Benefits

${product.benefits.map((b) => `- ${b}`).join("\n")}

### Available Colours

${product.availableColours}

### Warranty

${product.warranty}

### Delivery Information

${product.deliveryInformation}
`,
  )
  .join("\n")}
`,

  "pricing.md": `# Pricing

> **Step 2 — Shared Knowledge.** Approved prices only. Custom quotes require Sales.

## Products and Prices

| Product | Price |
| --- | --- |
${pricing.products.map((item) => `| ${item.name} | ${item.price} |`).join("\n")}

## Discounts

${pricing.discounts}

## Payment Methods

${pricing.paymentMethods.map((method) => `- ${method}`).join("\n")}
`,

  "faq.md": `# FAQ

> **Step 2 — Shared Knowledge.** Short approved answers for common questions.

## Frequently Asked Questions

${faqs.general.map((item) => `**Q: ${item.q}**  \nA: ${item.a}\n`).join("\n")}

## Shipping

${faqs.shipping}

## Returns

${faqs.returns}

## Delivery

${faqs.delivery}

## Payments

${faqs.payments}

## Support

${faqs.support}
`,

  "brand_voice.md": `# Brand Voice

> **Step 2 — Shared Knowledge.** How every agent should sound.

## Tone

- **Professional:** ${brandVoice.professional ? "Yes" : "No"}
- **Friendly:** ${brandVoice.friendly ? "Yes" : "No"}
- **Confident:** ${brandVoice.confident ? "Yes" : "No"}
- **Helpful:** ${brandVoice.helpful ? "Yes" : "No"}

## Response style

- **Short answers:** ${brandVoice.shortAnswers ? "Keep replies concise — one idea at a time." : "Use fuller replies when needed."}
- **Never argue with customers:** ${brandVoice.neverArgueWithCustomers ? "Stay calm, acknowledge concerns, and escalate when needed." : ""}

## We say

${brandVoice.say.map((phrase) => `- "${phrase}"`).join("\n")}

## We avoid

${brandVoice.avoid.map((phrase) => `- "${phrase}"`).join("\n")}
`,

  "policies.md": `# Policies

> **Step 2 — Shared Knowledge.** Rules that constrain what agents may commit to.

## Refund Policy

${policies.refundPolicy}

## Privacy Policy

${policies.privacyPolicy}

## Warranty

${policies.warranty}

## Returns

${policies.returns}

## Escalation Rules

Route to human review when the message involves:

${policies.escalationRules.map((rule) => `- ${rule}`).join("\n")}
`,
};

for (const [filename, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(sharedDir, filename), content, "utf8");
}

console.log(`Generated ${Object.keys(files).length} shared knowledge files (Step 2 structure)`);
