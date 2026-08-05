/**
 * Ingestion pipeline coordinator (Problem 3 §Step 2, §Knowledge Ingestion
 * Pipeline). Runs the parse → chunk → classify → contradiction-check →
 * conditional embed → mark-complete sequence. On any chunk being flagged, the
 * document's contradiction_status flips to `flagged` and blocks it from the
 * live KB until the owner resolves it in the staging UI.
 */

import { extractDocumentText, isSupportedDocument } from "../../document-extract.ts";
import { getCurrentKbVersion, incrementKbVersion } from "../versioning/kb-version-manager.ts";
import { chunkText } from "./chunker.ts";
import { classifyChunk } from "./classifier.ts";
import { checkChunkForContradictions } from "./contradiction-checker.ts";
import {
  createUploadedDocument,
  insertChunks,
  updateDocumentStatus,
  type UploadedDocumentRow,
} from "./document-store.ts";

export interface IngestionResult {
  document: UploadedDocumentRow;
  chunksTotal: number;
  chunksIngested: number;
  chunksFlagged: number;
}

export async function processDocumentUpload(input: {
  workspaceId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<IngestionResult> {
  if (!isSupportedDocument(input.filename, input.mimeType)) {
    throw new Error("UNSUPPORTED_FILE_TYPE");
  }

  const fileType = input.filename.toLowerCase().split(".").pop() ?? "unknown";
  const document = await createUploadedDocument({
    workspaceId: input.workspaceId,
    filename: input.filename,
    fileType,
    byteSize: input.buffer.byteLength,
  });

  try {
    const text = await extractDocumentText(input);
    const rawChunks = chunkText(text);
    if (rawChunks.length === 0) {
      await updateDocumentStatus(input.workspaceId, document.id, {
        uploadStatus: "complete",
        contradictionStatus: "clean",
        processed: true,
      });
      return { document, chunksTotal: 0, chunksIngested: 0, chunksFlagged: 0 };
    }

    const kbVersion = await getCurrentKbVersion(input.workspaceId);

    const processed = await Promise.all(
      rawChunks.map(async (chunk) => {
        const category = classifyChunk(chunk.text);
        const contradiction = await checkChunkForContradictions(
          input.workspaceId,
          category,
          chunk.text,
        );
        return {
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          category,
          contradictionFlag: contradiction.hasContradiction,
          contradictionDetail: contradiction.hasContradiction ? contradiction.detail : null,
          kbVersion,
        };
      }),
    );

    await insertChunks(input.workspaceId, document.id, processed);

    const flagged = processed.filter((c) => c.contradictionFlag).length;
    await updateDocumentStatus(input.workspaceId, document.id, {
      uploadStatus: "complete",
      contradictionStatus: flagged > 0 ? "flagged" : "clean",
      processed: true,
    });

    // Every successful ingest that added new clean chunks bumps the KB version
    // so active conversations continue on their pinned version. If everything
    // was flagged, the version is not bumped — nothing new is queryable.
    if (processed.length - flagged > 0) {
      await incrementKbVersion(input.workspaceId, "document ingest");
    }

    return {
      document,
      chunksTotal: processed.length,
      chunksIngested: processed.length - flagged,
      chunksFlagged: flagged,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ingest_failed";
    await updateDocumentStatus(input.workspaceId, document.id, {
      uploadStatus: "failed",
      errorMessage: message,
      processed: true,
    });
    throw error;
  }
}
