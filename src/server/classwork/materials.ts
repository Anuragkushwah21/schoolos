import "server-only";

import type { LessonMaterialKind } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import type { TenantContext } from "@/server/auth/current-user";
import {
  type ValidatedDocument,
  deleteStoredFile,
  storeDocument,
  validateDocument,
} from "@/server/storage/files";

/**
 * The one resource system behind both a completed class's materials and a
 * homework's study resources.
 *
 * A `LessonMaterial` row belongs to exactly one owner — a `ClassSession` or a
 * `Homework` (a CHECK constraint enforces it). This module does the part that
 * is the same for both: checking a PDF, video or link, writing an uploaded file
 * to storage, and inserting the row. It does no authorization of its own; the
 * callers in `lessons.ts` and `homework.ts` establish that the teacher owns the
 * class or the homework before they get here.
 */

export type MaterialOwner = { classSessionId: string } | { homeworkId: string };

export type MaterialFields = {
  kind: LessonMaterialKind;
  title: string;
  url: string | null;
  body?: string | null;
  description?: string | null;
  /** An uploaded PDF, for a DOCUMENT. Takes the place of `url`. */
  file?: File | null;
};

/** Kinds that carry a URL (or, for DOCUMENT, an uploaded file) rather than text. */
export const URL_KINDS: readonly LessonMaterialKind[] = ["LINK", "DOCUMENT", "VIDEO"];

/** Enough for a real lesson or assignment; a cap so one cannot grow without bound. */
export const MAX_MATERIALS_PER_OWNER = 20;

export function isValidWebAddress(url: string): boolean {
  return url.startsWith("https://") && URL.canParse(url);
}

export type PreparedMaterial = {
  fields: {
    kind: LessonMaterialKind;
    title: string;
    url: string | null;
    body: string | null;
    description: string | null;
  };
  document: ValidatedDocument | null;
};

/**
 * Check one resource and, for an upload, read and verify the PDF.
 *
 * Nothing is written. Callers that save several resources at once prepare all
 * of them first, so one bad file refuses the whole save instead of leaving
 * half of it behind.
 */
export async function prepareMaterial(input: MaterialFields): Promise<PreparedMaterial> {
  const wantsUrl = URL_KINDS.includes(input.kind);
  const file = input.kind === "DOCUMENT" && input.file && input.file.size > 0 ? input.file : null;

  if (wantsUrl && !input.url && !file) {
    throw new AppError(
      "VALIDATION",
      input.kind === "DOCUMENT"
        ? `"${input.title}": upload a PDF, or give the web address of the document.`
        : `"${input.title}": a link or a video needs a web address.`,
    );
  }
  if (!wantsUrl && !input.body) {
    throw new AppError("VALIDATION", "Write the notes, questions or practice work itself.");
  }
  if (input.url && !isValidWebAddress(input.url)) {
    throw new AppError("VALIDATION", `"${input.title}": enter a valid https:// web address.`);
  }

  const document = file ? await validateDocument(file) : null;

  return {
    fields: {
      kind: input.kind,
      title: input.title,
      // Only the field the kind actually uses is stored, so a kind change can
      // never leave a stale URL behind a block of notes.
      url: wantsUrl && !document ? input.url : null,
      body: wantsUrl ? null : (input.body ?? null),
      description: input.description ?? null,
    },
    document,
  };
}

/**
 * Write the file (if any), then the row.
 *
 * File first: a failed insert leaves an orphan file, which is removed here,
 * never a row pointing at nothing.
 */
export async function saveMaterial(
  ctx: TenantContext,
  owner: MaterialOwner,
  prepared: PreparedMaterial,
): Promise<{ id: string; storageKey: string | null }> {
  const storageKey = prepared.document
    ? await storeDocument(ctx.schoolId, prepared.document)
    : null;

  try {
    const created = await ctx.db.lessonMaterial.create({
      data: {
        schoolId: ctx.schoolId,
        ...owner,
        ...prepared.fields,
        storageKey,
        fileName: prepared.document?.fileName ?? null,
        fileSize: prepared.document?.size ?? null,
        mimeType: prepared.document?.mimeType ?? null,
      },
      select: { id: true },
    });
    return { id: created.id, storageKey };
  } catch (error) {
    if (storageKey) await deleteStoredFile(storageKey);
    throw error;
  }
}

/** Refuse a new resource once the owner already has the maximum. */
export async function assertRoomForMore(
  ctx: TenantContext,
  owner: MaterialOwner,
  adding = 1,
): Promise<void> {
  const existing = await ctx.db.lessonMaterial.count({ where: owner });
  if (existing + adding > MAX_MATERIALS_PER_OWNER) {
    throw new AppError(
      "VALIDATION",
      `At most ${MAX_MATERIALS_PER_OWNER} resources can be attached. Remove one first.`,
    );
  }
}
