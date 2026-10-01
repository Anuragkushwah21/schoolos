import { NextResponse } from "next/server";

import { apiRoute } from "@/server/api/handler";
import { readPhoto } from "@/server/people/photos";

/** A profile photo, for whoever may see it (see `canViewPhoto`). Never cached publicly. */
export const GET = apiRoute<{ photoId: string }>(
  { roles: ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"] },
  async ({ ctx, params }) => {
    const photo = await readPhoto(ctx, params.photoId);
    return new NextResponse(new Uint8Array(photo.bytes), {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  },
);
