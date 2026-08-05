/**
 * DB access for uploaded documents and their extracted chunks. Chunks land in
 * `knowledge_chunks` with `ingested=false` until either (a) the contradiction
 * checker gives them a clean bill and the embedder runs, or (b) an owner
 * resolves the flag from the staging UI. Only ingested chunks are visible to
 * the Track-2 retrieval path.
 */

import { createId } from "../../auth-crypto.ts";
import { ensureDbConnection, getSql } from "../../db.ts";
import type { ChunkCategory } from "../types.ts";

export interface UploadedDocumentRow {
  id: string;
  workspaceId: string;
  filename: string;
  fileType: string;
  byteSize: number | null;
  uploadStatus: "pending" | "processing" | "complete" | "failed";
  contradictionStatus: "clean" | "flagged" | "resolved";
  errorMessage: string | null;
  uploadedAt: string;
  processedAt: string | null;
}

export interface KnowledgeChunkRow {
  id: string;
  workspaceId: string;
  documentId: string | null;
  chunkIndex: number;
  chunkText: string;
  category: ChunkCategory;
  contradictionFlag: boolean;
  contradictionDetail: string | null;
  ingested: boolean;
  kbVersion: number;
  createdAt: string;
  filename?: string;
}

export async function createUploadedDocument(input: {
  workspaceId: string;
  filename: string;
  fileType: string;
  byteSize: number;
}): Promise<UploadedDocumentRow> {
  await ensureDbConnection();
  const db = getSql();
  const id = createId("doc");
  await db`
    INSERT INTO uploaded_documents
      (id, workspace_id, filename, file_type, byte_size, upload_status)
    VALUES
      (${id}, ${input.workspaceId}, ${input.filename}, ${input.fileType},
       ${input.byteSize}, 'processing')
  `;
  const rows = await db`
    SELECT * FROM uploaded_documents WHERE id = ${id} AND workspace_id = ${input.workspaceId}
  `;
  return rowToDocument(rows[0]);
}

export async function updateDocumentStatus(
  workspaceId: string,
  documentId: string,
  patch: {
    uploadStatus?: UploadedDocumentRow["uploadStatus"];
    contradictionStatus?: UploadedDocumentRow["contradictionStatus"];
    errorMessage?: string | null;
    processed?: boolean;
  },
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  await db`
    UPDATE uploaded_documents SET
      upload_status         = COALESCE(${patch.uploadStatus ?? null}, upload_status),
      contradiction_status  = COALESCE(${patch.contradictionStatus ?? null}, contradiction_status),
      error_message         = COALESCE(${patch.errorMessage ?? null}, error_message),
      processed_at          = CASE WHEN ${patch.processed ?? false} THEN now() ELSE processed_at END
    WHERE id = ${documentId} AND workspace_id = ${workspaceId}
  `;
}

export async function insertChunks(
  workspaceId: string,
  documentId: string,
  chunks: Array<{
    chunkIndex: number;
    chunkText: string;
    category: ChunkCategory;
    contradictionFlag: boolean;
    contradictionDetail: string | null;
    kbVersion: number;
  }>,
): Promise<void> {
  if (chunks.length === 0) return;
  await ensureDbConnection();
  const db = getSql();
  await db.begin(async (tx) => {
    for (const chunk of chunks) {
      await tx`
        INSERT INTO knowledge_chunks
          (id, workspace_id, document_id, chunk_index, chunk_text, category,
           contradiction_flag, contradiction_detail, ingested, kb_version)
        VALUES
          (${createId("kc")}, ${workspaceId}, ${documentId}, ${chunk.chunkIndex},
           ${chunk.chunkText}, ${chunk.category},
           ${chunk.contradictionFlag}, ${chunk.contradictionDetail},
           ${!chunk.contradictionFlag}, ${chunk.kbVersion})
      `;
    }
  });
}

export async function listDocuments(workspaceId: string): Promise<UploadedDocumentRow[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT * FROM uploaded_documents WHERE workspace_id = ${workspaceId}
    ORDER BY uploaded_at DESC LIMIT 200
  `;
  return rows.map(rowToDocument);
}

export async function listFlaggedChunks(workspaceId: string): Promise<KnowledgeChunkRow[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT c.*, d.filename
    FROM knowledge_chunks c
    LEFT JOIN uploaded_documents d ON d.id = c.document_id
    WHERE c.workspace_id = ${workspaceId} AND c.contradiction_flag = TRUE
    ORDER BY c.created_at ASC
  `;
  return rows.map(rowToChunk);
}

export async function listIngestedChunks(
  workspaceId: string,
  kbVersion: number,
): Promise<KnowledgeChunkRow[]> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT c.*, d.filename
    FROM knowledge_chunks c
    LEFT JOIN uploaded_documents d ON d.id = c.document_id
    WHERE c.workspace_id = ${workspaceId}
      AND c.ingested = TRUE
      AND c.kb_version = ${kbVersion}
    ORDER BY c.created_at ASC LIMIT 2000
  `;
  return rows.map(rowToChunk);
}

export async function resolveChunkContradiction(
  workspaceId: string,
  chunkId: string,
  action: "confirm" | "discard" | "edit",
  correctedText?: string,
): Promise<void> {
  await ensureDbConnection();
  const db = getSql();
  if (action === "discard") {
    await db`DELETE FROM knowledge_chunks WHERE id = ${chunkId} AND workspace_id = ${workspaceId}`;
    return;
  }
  if (action === "edit") {
    if (!correctedText?.trim()) throw new Error("edit_requires_correctedText");
    await db`
      UPDATE knowledge_chunks SET
        chunk_text = ${correctedText},
        contradiction_flag = FALSE,
        contradiction_detail = NULL,
        ingested = TRUE
      WHERE id = ${chunkId} AND workspace_id = ${workspaceId}
    `;
    return;
  }
  // confirm: keep original text, clear the flag, mark ingested.
  await db`
    UPDATE knowledge_chunks SET
      contradiction_flag = FALSE,
      contradiction_detail = NULL,
      ingested = TRUE
    WHERE id = ${chunkId} AND workspace_id = ${workspaceId}
  `;
}

export async function countContradictions(workspaceId: string): Promise<number> {
  await ensureDbConnection();
  const db = getSql();
  const rows = await db`
    SELECT count(*)::int AS n FROM knowledge_chunks
    WHERE workspace_id = ${workspaceId} AND contradiction_flag = TRUE
  `;
  return Number(rows[0]?.n ?? 0);
}

function rowToDocument(row: Record<string, unknown>): UploadedDocumentRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    filename: String(row.filename),
    fileType: String(row.file_type),
    byteSize: row.byte_size == null ? null : Number(row.byte_size),
    uploadStatus: String(row.upload_status) as UploadedDocumentRow["uploadStatus"],
    contradictionStatus: String(row.contradiction_status) as UploadedDocumentRow["contradictionStatus"],
    errorMessage: (row.error_message as string | null) ?? null,
    uploadedAt: new Date(row.uploaded_at as string).toISOString(),
    processedAt: row.processed_at ? new Date(row.processed_at as string).toISOString() : null,
  };
}

function rowToChunk(row: Record<string, unknown>): KnowledgeChunkRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    documentId: row.document_id ? String(row.document_id) : null,
    chunkIndex: Number(row.chunk_index ?? 0),
    chunkText: String(row.chunk_text),
    category: String(row.category) as ChunkCategory,
    contradictionFlag: Boolean(row.contradiction_flag),
    contradictionDetail: (row.contradiction_detail as string | null) ?? null,
    ingested: Boolean(row.ingested),
    kbVersion: Number(row.kb_version ?? 1),
    createdAt: new Date(row.created_at as string).toISOString(),
    filename: (row.filename as string | undefined) ?? undefined,
  };
}
