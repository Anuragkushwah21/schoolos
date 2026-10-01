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

// -----------------------------------------------------------------------------
// Profile photos
// -----------------------------------------------------------------------------

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const IMAGE_TYPES = [
  { mime: "image/jpeg", ext: "jpg", magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", magic: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", magic: (b: Buffer) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
] as const;

export type ValidatedImage = { bytes: Buffer; mimeType: (typeof IMAGE_TYPES)[number]["mime"]; ext: string; size: number };

/** A profile photo must be at least this many pixels on each side, and at most the max. */
export const MIN_PHOTO_SIDE = 64;
export const MAX_PHOTO_SIDE = 6000;

/**
 * Width and height from the image's own header — PNG IHDR, a JPEG SOF
 * marker, or WebP's VP8 / VP8L / VP8X chunk. Null when the header cannot be
 * read, which is treated as not an image.
 */
export function imageSize(bytes: Buffer, mime: ValidatedImage["mimeType"]): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1]!;
        const length = bytes.readUInt16BE(offset + 2);
        // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
      return null;
    }
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    return null;
  } catch {
    return null;
  }
}

/**
 * A JPEG, PNG or WebP photo of at most 2 MB and sensible dimensions — judged
 * by its own bytes, never its name or the browser's word for its type, so a
 * renamed executable or script is refused.
 */
export async function validateImage(file: File): Promise<ValidatedImage> {
  if (file.size === 0) throw new AppError("VALIDATION", "That file is empty.");
  if (file.size > MAX_PHOTO_BYTES) throw new AppError("VALIDATION", "That photo is too large. The limit is 2 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = IMAGE_TYPES.find((candidate) => candidate.magic(bytes));
  if (!type) throw new AppError("VALIDATION", "Use a JPG, PNG or WebP photo.");
  const size = imageSize(bytes, type.mime);
  if (!size) throw new AppError("VALIDATION", "That photo could not be read. Save it again as JPG or PNG and retry.");
  if (size.width < MIN_PHOTO_SIDE || size.height < MIN_PHOTO_SIDE) {
    throw new AppError("VALIDATION", `That photo is too small (${size.width}×${size.height}). Use one at least ${MIN_PHOTO_SIDE}×${MIN_PHOTO_SIDE} pixels.`);
  }
  if (size.width > MAX_PHOTO_SIDE || size.height > MAX_PHOTO_SIDE) {
    throw new AppError("VALIDATION", `That photo is too large (${size.width}×${size.height}). Use one at most ${MAX_PHOTO_SIDE} pixels on each side.`);
  }
  return { bytes, mimeType: type.mime, ext: type.ext, size: bytes.length };
}

/** Write a validated photo under the school's own folder and return its key. */
export async function storeImage(schoolId: string, image: ValidatedImage): Promise<string> {
  const key = `${schoolId}/photos/${randomUUID()}.${image.ext}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, image.bytes, { flag: "wx" });
  return key;
}
