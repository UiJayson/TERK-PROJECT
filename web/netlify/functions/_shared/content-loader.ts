import type { AgentRole } from "./types.ts";
import {
  extractWorkspaceName,
  getKnowledge,
  type SharedFile,
} from "./knowledge-store.ts";
import { bundledContent } from "./content-bundle.ts";

const agentKnowledge: Record<AgentRole, SharedFile[]> = {
  reception: [
    "shared/company.md",
    "shared/faq.md",
    "shared/products.md",
    "shared/policies.md",
    "shared/brand_voice.md",
    "shared/sops.md",
    "shared/documents.md",
  ],
  sales: [
    "shared/company.md",
    "shared/products.md",
    "shared/pricing.md",
    "shared/faq.md",
    "shared/policies.md",
    "shared/brand_voice.md",
    "shared/sops.md",
    "shared/documents.md",
  ],
  marketing: [
    "shared/brand_voice.md",
    "shared/products.md",
    "shared/pricing.md",
    "shared/policies.md",
    "shared/sops.md",
    "shared/documents.md",
  ],
  human_review: ["shared/company.md", "shared/policies.md", "shared/documents.md"],
};

function readPrompt(relativePath: string): string {
  return bundledContent[relativePath] ?? "";
}

export async function getWorkspaceName(workspaceId?: string): Promise<string> {
  const company = await getKnowledge("shared/company.md", workspaceId);
  return extractWorkspaceName(company);
}

export async function loadPrompt(
  relativePath: string,
  workspaceId?: string,
): Promise<string> {
  const workspaceName = await getWorkspaceName(workspaceId);
  return readPrompt(relativePath).replaceAll("{{workspace_name}}", workspaceName);
}

export async function loadKnowledgeForAgent(
  agent: AgentRole,
  workspaceId?: string,
): Promise<Record<string, string>> {
  const files = agentKnowledge[agent] ?? agentKnowledge.reception;
  const knowledge: Record<string, string> = {};

  for (const file of files) {
    knowledge[file] = await getKnowledge(file, workspaceId);
  }

  return knowledge;
}

export function formatKnowledgeBlock(knowledge: Record<string, string>): string {
  return Object.entries(knowledge)
    .map(([file, content]) => `### ${file}\n${content}`)
    .join("\n\n");
}

export function getBundledContent(path: string): string {
  return bundledContent[path] ?? "";
}
