"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { markAlertsRead } from "@/server/alerts/center";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";

const ROLES = ["SCHOOL_ADMIN", "PARENT", "STUDENT", "TEACHER", "NON_TEACHING_STAFF"] as const;

/** Mark one alert read (`key`), or every alert showing (`all=true`). */
export async function markAlertsReadAction(_p: ActionResult<undefined>, formData: FormData): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction(...ROLES);
      const { key, all } = parseFormData(z.object({ key: z.string().max(80).optional(), all: z.enum(["true"]).optional() }), formData);
      await markAlertsRead(ctx, all ? { all: true } : { keys: key ? [key] : [] });
      return successResult(undefined);
    },
    { revalidate: "/notifications" },
  );
}
