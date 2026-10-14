import "server-only";

import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/errors";
import { readStoredFile } from "@/server/storage/files";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** A private image (a signature), never cached publicly and never run as a page. */
export async function privateImage(key: string | null): Promise<NextResponse> {
  if (!key) throw new NotFoundError();
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext];
  if (!mime) throw new NotFoundError();
  const bytes = await readStoredFile(key);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" },
  });
}
