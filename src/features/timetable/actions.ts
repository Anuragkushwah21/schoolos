"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { slotSchema } from "@/lib/validation/timetable";
import { requireTenantForAction } from "@/server/auth/current-user";
import { createSlot, deleteSlot } from "@/server/timetable/service";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

export async function createSlotAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await createSlot(ctx, parseFormData(slotSchema, formData));
      return successResult("Period added.");
    },
    { revalidate: ["/school-admin", "/teacher", "/student", "/parent"] },
  );
}

const slotIdSchema = z.object({ slotId: id });

export async function deleteSlotAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { slotId } = parseFormData(slotIdSchema, formData);
      await deleteSlot(ctx, slotId);
      return successResult("Period removed.");
    },
    { revalidate: ["/school-admin", "/teacher", "/student", "/parent"] },
  );
}
