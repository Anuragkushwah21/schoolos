"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id, optionalDate, requiredText } from "@/lib/validation/common";
import { requireRoleForAction } from "@/server/auth/current-user";
import { createApiToken, revokeApiToken } from "@/server/auth/api-token";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

const admin = () => requireRoleForAction("SCHOOL_ADMIN", "SUPER_ADMIN");

const createSchema = z.object({
  name: requiredText("a name for this token", 60),
  scope: z.enum(["READ", "FULL"]),
  expiresAt: optionalDate,
});

export async function createApiTokenAction(
  _p: ActionResult<{ secret?: { label: string; value: string; hint?: string } }>,
  formData: FormData,
): Promise<ActionResult<{ secret?: { label: string; value: string; hint?: string } }>> {
  return performAction(
    async () => {
      const actor = await admin();
      const input = parseFormData(createSchema, formData);
      const { token } = await createApiToken(actor, input);

      return successResult("Token created.", {
        secret: {
          label: `API token · ${input.name}`,
          value: token,
          hint: "Copy it now — only a hash is stored, so it cannot be shown again.",
        },
      });
    },
    { revalidate: "/account" },
  );
}

export async function revokeApiTokenAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const actor = await admin();
      const { tokenId } = parseFormData(z.object({ tokenId: id }), formData);
      await revokeApiToken(actor, tokenId);
      return successResult("Token revoked.");
    },
    { revalidate: "/account" },
  );
}
