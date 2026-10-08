import { NextResponse } from "next/server";

import { apiRoute } from "@/server/api/handler";
import { readAdmissionDocument } from "@/server/admissions/drives";

/**
 * A PDF attached to an admission application, for someone allowed to see
 * that application: the School Admin, office staff with "Online applications
 * & status", or the teacher whose admission assignment it is on.
 * `readAdmissionDocument` decides; another school's id is 404.
 */
export const GET = apiRoute<{ documentId: string }>(
  { roles: ["TEACHER", "SCHOOL_ADMIN", "NON_TEACHING_STAFF"] },
  async ({ request, params, ctx }) => {
    const file = await readAdmissionDocument(ctx, params.documentId);
    const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  },
);
