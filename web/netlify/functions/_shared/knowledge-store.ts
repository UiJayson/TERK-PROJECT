import { bundledContent } from "./content-bundle.ts";
import {
  CORE_SHARED_FILES,
  SHARED_FILES,
  type CoreSharedFile,
  type SharedFile,
} from "./knowledge-store-types.ts";
import * as db from "./db.ts";
import { indexSharedKnowledgeFile } from "./embeddings.ts";

export { CORE_SHARED_FILES, SHARED_FILES, type CoreSharedFile, type SharedFile };

export async function getKnowledge(
  filePath: SharedFile | string,
  workspaceId?: string,
): Promise<string> {
  if (workspaceId) {
    const stored = await db.getKnowledgeFile(workspaceId, filePath);
    if (stored) return stored;
  }

  return bundledContent[filePath] ?? "";
}

export async function getAllKnowledge(
  workspaceId?: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of SHARED_FILES) {
    result[file] = await getKnowledge(file, workspaceId);
  }
  return result;
}

export async function setKnowledge(
  filePath: SharedFile | string,
  content: string,
  workspaceId?: string,
): Promise<void> {
  if (!workspaceId) {
    throw new Error("WORKSPACE_ID_REQUIRED");
  }
  await db.setKnowledgeFile(workspaceId, filePath, content);
  try {
    await indexSharedKnowledgeFile(workspaceId, filePath, content);
  } catch (error) {
    console.warn("Shared knowledge indexing failed:", error);
  }
}

export async function setKnowledgeFiles(
  files: Record<string, string>,
  workspaceId: string,
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    await db.setKnowledgeFile(workspaceId, filePath, content);
  }
}

export async function seedKnowledgeFromBundle(workspaceId: string): Promise<void> {
  const files: Record<string, string> = {};
  for (const file of SHARED_FILES) {
    files[file] = bundledContent[file] ?? "";
  }
  await setKnowledgeFiles(files, workspaceId);
}

export function extractWorkspaceName(companyMarkdown: string): string {
  const match =
    companyMarkdown.match(/\*\*Name:\*\*\s*(.+)/) ||
    companyMarkdown.match(/^##\s+Company Name\s*\n\s*(.+)/m) ||
    companyMarkdown.match(/^##\s+(.+)$/m);
  return match?.[1]?.trim() ?? "Your Business";
}
