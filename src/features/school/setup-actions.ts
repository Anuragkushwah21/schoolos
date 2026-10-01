"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { OPTIONAL_STEPS, setSetupStepSkipped, type SetupStepKey } from "@/server/academics/setup";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";

const skipSchema = z.object({
  step: z.enum(OPTIONAL_STEPS as [SetupStepKey, ...SetupStepKey[]]),
  skip: z.enum(["true", "false"]),
});

/** "Skip for now" / "Bring back" on an optional setup step. */
export async function skipSetupStepAction(_p: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { step, skip } = parseFormData(skipSchema, formData);
      await setSetupStepSkipped(ctx, step, skip === "true");
      return successResult(undefined);
    },
    { revalidate: "/school-admin" },
  );
}
