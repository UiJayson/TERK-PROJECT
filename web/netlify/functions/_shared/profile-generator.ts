import type { SharedFile } from "./knowledge-store.ts";

export interface WorkspaceProfile {
  company: {
    name: string;
    mission: string;
    vision: string;
    businessDescription: string;
    operatingHours: { weekdays: string; saturday: string; sunday: string };
    locations: Array<{ name: string; address: string }>;
    serviceArea: string;
    contact: {
      email: string;
      phone: string;
      website: string;
      urgentPhone: string;
    };
  };
  products: Array<{
    name: string;
    description: string;
    benefits: string[];
    availableColours: string;
    warranty: string;
    deliveryInformation: string;
  }>;
  pricing: {
    products: Array<{ name: string; price: string }>;
    discounts: string;
    paymentMethods: string[];
  };
  faqs: {
    general: Array<{ q: string; a: string }>;
    shipping: string;
    returns: string;
    delivery: string;
    payments: string;
    support: string;
  };
  brandVoice: {
    professional: boolean;
    friendly: boolean;
    confident: boolean;
    helpful: boolean;
    shortAnswers: boolean;
    neverArgueWithCustomers: boolean;
    say: string[];
    avoid: string[];
  };
  policies: {
    refundPolicy: string;
    privacyPolicy: string;
    warranty: string;
    returns: string;
    escalationRules: string[];
  };
}

export function generateSharedFromProfile(
  profile: WorkspaceProfile,
): Record<Exclude<SharedFile, "shared/documents.md">, string> {
  const { company, products, pricing, faqs, brandVoice, policies } = profile;

  return {
    "shared/company.md": `# Company

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
    "shared/products.md": `# Products

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
    "shared/pricing.md": `# Pricing

## Products and Prices

| Product | Price |
| --- | --- |
${pricing.products.map((item) => `| ${item.name} | ${item.price} |`).join("\n")}

## Discounts

${pricing.discounts}

## Payment Methods

${pricing.paymentMethods.map((method) => `- ${method}`).join("\n")}
`,
    "shared/faq.md": `# FAQ

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
    "shared/brand_voice.md": `# Brand Voice

## Tone

- **Professional:** ${brandVoice.professional ? "Yes" : "No"}
- **Friendly:** ${brandVoice.friendly ? "Yes" : "No"}
- **Confident:** ${brandVoice.confident ? "Yes" : "No"}
- **Helpful:** ${brandVoice.helpful ? "Yes" : "No"}

## Response style

- **Short answers:** ${brandVoice.shortAnswers ? "Keep replies concise." : "Use fuller replies when needed."}
- **Never argue with customers:** ${brandVoice.neverArgueWithCustomers ? "Stay calm and escalate when needed." : ""}

## We say

${brandVoice.say.map((phrase) => `- "${phrase}"`).join("\n")}

## We avoid

${brandVoice.avoid.map((phrase) => `- "${phrase}"`).join("\n")}
`,
    "shared/policies.md": `# Policies

## Refund Policy

${policies.refundPolicy}

## Privacy Policy

${policies.privacyPolicy}

## Warranty

${policies.warranty}

## Returns

${policies.returns}

## Escalation Rules

${policies.escalationRules.map((rule) => `- ${rule}`).join("\n")}
`,
    "shared/sops.md": `# Standard Operating Procedures

> Process facts for tours, qualification, and handoffs. See \`agents/boundaries.md\` for role rules.

## Appointment and tour intake

Collect: name, email or phone, preferred date/time, and interest.

## Lead qualification (Sales)

Collect: team size, timeline, budget range, current situation.

## Handoffs

Reception → Sales for pricing and product fit. Reception → Human for complaints and refunds.
`,
  };
}
