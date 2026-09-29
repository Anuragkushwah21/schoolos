import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * The smallest file store that is safe: a directory on the server's disk.
 *
 * Files are written under `UPLOAD_DIR` (default `./uploads`, gitignored), never
 * under `public/`, so no file is reachable by guessing a URL — the only way out
 * is the download route, which authorizes the lesson first. Keys are generated
 * here, never taken from a request, and every key is prefixed with the school,
 * so even a bug that mixed keys up could not cross into another school's folder.
 *
 * Only PDF is accepted. It is checked by extension, declared type and the
 * file's own first bytes: a renamed executable fails the last check whatever
 * it calls itself.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const PDF_MAGIC = Buffer.from("%PDF-");

// The upload directory holds user files at runtime, not build inputs, so the
// bundler is told not to trace it (it would otherwise pull in the whole project).
function root(): string {
  return path.resolve(
    /*turbopackIgnore: true*/ env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"),
  );
}

/** A key as an absolute path, refusing anything that would escape the root. */
function resolveKey(key: string): string {
  const base = root();
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) {
    throw new Error("Refusing a storage key outside the upload directory.");
  }
  return full;
}

export type ValidatedDocument = {
  bytes: Buffer;
  fileName: string;
  mimeType: "application/pdf";
  size: number;
};

/** Check an uploaded file is a PDF of an acceptable size, and read it. */
export async function validateDocument(file: File): Promise<ValidatedDocument> {
  if (file.size === 0) {
    throw new AppError("VALIDATION", "That file is empty.");
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new AppError("VALIDATION", "That file is too large. The limit is 10 MB.");
  }

  const name = path.basename(file.name || "document.pdf");
  if (!/\.pdf$/i.test(name)) {
    throw new AppError("VALIDATION", "Only PDF files can be uploaded.");
  }
  if (file.type && file.type !== "application/pdf") {
    throw new AppError("VALIDATION", "Only PDF files can be uploaded.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new AppError("VALIDATION", "That file is not a valid PDF.");
  }

  // Kept for display and the download name only; never used as a path.
  const fileName = name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120);

  return { bytes, fileName, mimeType: "application/pdf", size: bytes.length };
}

/** Write a validated document and return the key it is stored under. */
export async function storeDocument(schoolId: string, document: ValidatedDocument): Promise<string> {
  const key = `${schoolId}/lesson-materials/${randomUUID()}.pdf`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, document.bytes, { flag: "wx" });
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(/*turbopackIgnore: true*/ resolveKey(key));
}

/** Best effort: a file that is already gone is not an error. */
export async function deleteStoredFile(key: string): Promise<void> {
  try {
    await rm(resolveKey(key), { force: true });
  } catch (error) {
    console.error("[storage] could not delete", key, error);
  }
}
