const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".dll",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".php",
  ".html",
  ".htm",
  ".svg",
  ".zip",
  ".rar",
  ".7z",
]);

const MALICIOUS_PATTERNS = [
  /<script\b/i,
  /javascript:/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /<%/,
  /\$\{/,
];

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function matchesMagicBytes(buffer: Buffer, signature: number[], offset = 0): boolean {
  if (buffer.length < offset + signature.length) return false;
  return signature.every((byte, index) => buffer[offset + index] === byte);
}

export function validateUploadFile(input: {
  filename: string;
  mimeType: string;
  size: number;
  maxBytes: number;
  buffer: Buffer;
}): UploadValidationResult {
  const ext = extensionOf(input.filename);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "File type is not allowed." };
  }

  if (input.size <= 0) {
    return { ok: false, error: "File is empty." };
  }

  if (input.size > input.maxBytes) {
    return { ok: false, error: `File must be ${Math.floor(input.maxBytes / (1024 * 1024))}MB or smaller.` };
  }

  const isPdf =
    ext === ".pdf" &&
    (input.mimeType.includes("pdf") || matchesMagicBytes(input.buffer, [0x25, 0x50, 0x44, 0x46]));
  const isDocx =
    ext === ".docx" &&
    (input.mimeType.includes("wordprocessingml") ||
      matchesMagicBytes(input.buffer, [0x50, 0x4b, 0x03, 0x04]));
  const isTxt = ext === ".txt" || input.mimeType.startsWith("text/");

  if (!isPdf && !isDocx && !isTxt) {
    return { ok: false, error: "Unsupported file type. Upload PDF, DOCX, or TXT." };
  }

  const sample = input.buffer.subarray(0, Math.min(input.buffer.length, 4096)).toString("utf8");
  if (MALICIOUS_PATTERNS.some((pattern) => pattern.test(sample))) {
    return { ok: false, error: "File content failed security validation." };
  }

  return { ok: true };
}

export function scanExtractedText(text: string): UploadValidationResult {
  if (MALICIOUS_PATTERNS.some((pattern) => pattern.test(text.slice(0, 8000)))) {
    return { ok: false, error: "Extracted document content failed security validation." };
  }
  return { ok: true };
}
