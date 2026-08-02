import mammoth from "mammoth";

function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export async function extractDocumentText(input: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<string> {
  const ext = extensionOf(input.filename);
  const mime = input.mimeType.toLowerCase();

  if (ext === "txt" || mime.startsWith("text/")) {
    return input.buffer.toString("utf8").trim();
  }

  if (
    ext === "docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    return result.value.trim();
  }

  if (ext === "pdf" || mime === "application/pdf") {
    const mod = (await import("pdf-parse")) as { default?: unknown };
    const pdfParse = (mod.default ?? mod) as unknown as (
      data: Buffer,
    ) => Promise<{ text: string }>;
    const result = await pdfParse(input.buffer);
    return (result.text ?? "").trim();
  }

  throw new Error("Unsupported file type. Upload PDF, DOCX, or TXT.");
}

export function isSupportedDocument(filename: string, mimeType: string): boolean {
  const ext = extensionOf(filename);
  const mime = mimeType.toLowerCase();
  return (
    ext === "txt" ||
    ext === "pdf" ||
    ext === "docx" ||
    mime.startsWith("text/") ||
    mime === "application/pdf" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}
