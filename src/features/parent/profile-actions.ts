"use server";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { parentSelfProfileSchema } from "@/lib/validation/school";
import { requireTenantForAction } from "@/server/auth/current-user";
import { updateMyParentProfile } from "@/server/parent/self-profile";
import { performAction } from "@/server/perform-action";

/** A parent saves their own details. The record is theirs by sign-in, never by an id from the form. */
export async function updateMyProfileAction(_p: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT");
      const { changed } = await updateMyParentProfile(ctx, parseFormData(parentSelfProfileSchema, formData));
      return successResult(changed.length ? `Saved: ${changed.join(", ")}. The school office sees your updated details.` : "Nothing to change — your details are up to date.");
    },
    { revalidate: ["/parent", "/school-admin"] },
  );
}
