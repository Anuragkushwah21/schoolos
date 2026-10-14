import { apiRoute } from "@/server/api/handler";
import { documentSignature } from "@/server/documents/service";
import { privateImage } from "@/server/documents/images";

/** The signature an issued document was signed with — for school leaders who may see that document. */
export const GET = apiRoute<{ documentId: string }>({ roles: ["SCHOOL_ADMIN", "PRINCIPAL"] }, async ({ ctx, params }) => privateImage(await documentSignature(ctx, params.documentId)));
