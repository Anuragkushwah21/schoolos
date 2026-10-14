import { NotFoundError } from "@/lib/errors";
import { apiRoute } from "@/server/api/handler";
import { privateImage } from "@/server/documents/images";
import { currentSignatureKey } from "@/server/documents/settings";

/** The current signature image, for the document settings preview. School leaders only. */
export const GET = apiRoute<{ who: string }>({ roles: ["SCHOOL_ADMIN", "PRINCIPAL"] }, async ({ ctx, params }) => {
  if (params.who !== "principal" && params.who !== "admin") throw new NotFoundError();
  return privateImage(await currentSignatureKey(ctx, params.who === "principal" ? "PRINCIPAL" : "SCHOOL_ADMIN"));
});
