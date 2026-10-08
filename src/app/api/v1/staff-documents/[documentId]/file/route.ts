import { NextResponse } from "next/server";

import { apiRoute } from "@/server/api/handler";
import { readStaffDocument } from "@/server/staff/profiles";

/**
 * A staff document (Aadhaar, certificates…), for the School Admin of the same
 * school only. Never public: another school's id, or any other role, is refused.
 */
export const GET = apiRoute<{ documentId: string }>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, params, ctx }) => {
  const file = await readStaffDocument(ctx, params.documentId);
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
});
