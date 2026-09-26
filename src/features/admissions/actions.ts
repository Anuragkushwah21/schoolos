"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import {
  acceptAdmissionSchema,
  admissionApplicationSchema,
  admissionStatusSchema,
} from "@/lib/validation/website";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  acceptApplication,
  setApplicationStatus,
  submitApplication,
} from "@/server/admissions/service";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/**
 * Public: anyone may apply. The school comes from the slug, which is fine here
 * precisely because applying grants nothing — the service refuses any school
 * that is not ACTIVE, and any class or stream that is not that school's.
 */
export async function submitApplicationAction(
  _p: ActionResult<{ slug: string; applicationNumber: string }>,
  formData: FormData,
): Promise<ActionResult<{ slug: string; applicationNumber: string }>> {
  return performAction(
    async () => {
      const { slug } = parseFormData(z.object({ slug: z.string().min(1).max(80) }), formData);
      const input = parseFormData(admissionApplicationSchema, formData);
      const forwarded = (await headers()).get("x-forwarded-for");
      const { applicationNumber } = await submitApplication(slug, input, {
        ipAddress: forwarded?.split(",")[0]?.trim() ?? null,
      });
      return successResult(undefined, { slug, applicationNumber });
    },
    {
      revalidate: "/school-admin",
      redirectTo: ({ slug, applicationNumber }) =>
        (`/schools/${encodeURIComponent(slug)}/admissions/submitted?no=${encodeURIComponent(applicationNumber)}` as Route),
    },
  );
}

export async function setApplicationStatusAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await setApplicationStatus(ctx, parseFormData(admissionStatusSchema, formData));
      return successResult("Application updated.");
    },
    { revalidate: "/school-admin" },
  );
}

export async function acceptApplicationAction(
  _p: ActionResult<{ studentId: string }>,
  formData: FormData,
): Promise<ActionResult<{ studentId: string }>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { studentId } = await acceptApplication(ctx, parseFormData(acceptAdmissionSchema, formData));
      return successResult("Application accepted and student admitted.", { studentId });
    },
    { revalidate: "/school-admin", redirectTo: ({ studentId }) => `/school-admin/students/${studentId}` as Route },
  );
}
