"use server";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { visitorEntrySchema, visitorExitSchema, visitorUpdateSchema } from "@/lib/validation/visitors";
import { requireTenantForAction } from "@/server/auth/current-user";
import { markVisitorExit, recordVisitorEntry, updateVisitor } from "@/server/operations/visitors";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
/** The School Admin, or staff with "Record visitor entry & exit" — the service checks. */
const gate = () => requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");
const revalidate = ["/school-admin/visitors", "/staff/visitors", "/staff/dashboard"];

export async function recordVisitorEntryAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const input = parseFormData(visitorEntrySchema, formData);
      await recordVisitorEntry(await gate(), input);
      return successResult(input.denied ? "Recorded as turned away." : `${input.name} logged in.`);
    },
    { revalidate },
  );
}

export async function markVisitorExitAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await markVisitorExit(await gate(), parseFormData(visitorExitSchema, formData));
      return successResult("Marked out.");
    },
    { revalidate },
  );
}

export async function updateVisitorAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await updateVisitor(await gate(), parseFormData(visitorUpdateSchema, formData));
      return successResult("Visit corrected.");
    },
    { revalidate },
  );
}
