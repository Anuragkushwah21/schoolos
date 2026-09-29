import { NextResponse } from "next/server";

import { apiRoute } from "@/server/api/handler";
import { readMaterialFile } from "@/server/classwork/lessons";

/**
 * An uploaded lesson PDF, streamed to someone allowed to read that lesson.
 *
 * `readMaterialFile` decides who that is — the student's own section, the
 * teacher who took the class, or the school office — and answers 404 for
 * everything else, another school's id included. Parents are not a role here.
 *
 * `?download=1` asks the browser to save it; otherwise it opens in place.
 */
export const GET = apiRoute<{ materialId: string }>(
  { roles: ["STUDENT", "TEACHER", "SCHOOL_ADMIN"] },
  async ({ request, params, ctx }) => {
    const file = await readMaterialFile(ctx, params.materialId);
    const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");

    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        // Only ever a validated PDF; never let a browser guess otherwise.
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
