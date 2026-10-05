"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { checkbox, id } from "@/lib/validation/common";
import { createStudentSchema } from "@/lib/validation/school";
import { publicApplicationSchema } from "@/lib/validation/enquiries";
import { acceptAdmissionSchema, admissionFollowUpSchema, admissionStatusSchema } from "@/lib/validation/website";
import { inviteMessage } from "@/server/auth/account-links";
import { requireTenantForAction } from "@/server/auth/current-user";
import { acceptApplication, addFollowUp, convertApplication, setApplicationArchived, setApplicationStatus, submitApplications } from "@/server/admissions/service";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/**
 * Public: anyone may apply. The school comes from the slug, which is fine here
 * precisely because applying grants nothing — the service refuses any school
 * that is not ACTIVE, and any class or stream that is not that school's.
 */
export async function submitApplicationAction(
  _p: ActionResult<{ slug: string; applicationNumbers: string[] }>,
  formData: FormData,
): Promise<ActionResult<{ slug: string; applicationNumbers: string[] }>> {
  return performAction(
    async () => {
      const { slug } = parseFormData(z.object({ slug: z.string().min(1).max(80) }), formData);
      const input = parseFormData(publicApplicationSchema, formData);
      // The school's own extra questions arrive as custom.<key>; the service checks them.
      const answers: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        if (key.startsWith("custom.") && typeof value === "string") answers[key.slice("custom.".length)] = value;
      }
      const forwarded = (await headers()).get("x-forwarded-for");
      const { applicationNumbers } = await submitApplications(slug, input, { ipAddress: forwarded?.split(",")[0]?.trim() ?? null }, answers);
      return successResult(undefined, { slug, applicationNumbers });
    },
    {
      revalidate: "/school-admin",
      redirectTo: ({ slug, applicationNumbers }) =>
        (`/schools/${encodeURIComponent(slug)}/admissions/submitted?no=${encodeURIComponent(applicationNumbers.join(","))}` as Route),
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

const admin = () => requireTenantForAction("SCHOOL_ADMIN");

export async function addFollowUpAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      await addFollowUp(await admin(), parseFormData(admissionFollowUpSchema, formData));
      return successResult("Follow-up saved.");
    },
    { revalidate: "/school-admin" },
  );
}

export async function archiveApplicationAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const { applicationId, archived } = parseFormData(z.object({ applicationId: id, archived: checkbox }), formData);
      await setApplicationArchived(await admin(), applicationId, archived);
      return successResult(archived ? "Archived. It stays in the records and can be restored." : "Restored to the list.");
    },
    { revalidate: "/school-admin" },
  );
}

const convertSchema = z.object({
  applicationId: id,
  admissionType: z.enum(["NEW", "TRANSFER", "READMISSION"]).default("NEW"),
  confirmNotDuplicate: checkbox,
});

type ConvertResult = ActionResult<{ studentId: string; admissionNumber: string; next?: { href: string; label: string } }>;

/** Convert an approved application: the same admission as "Add student", then the application is marked converted. */
export async function convertApplicationAction(_p: ConvertResult, formData: FormData): Promise<ConvertResult> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { applicationId, admissionType, confirmNotDuplicate } = parseFormData(convertSchema, formData);
      const result = await convertApplication(ctx, applicationId, parseFormData(createStudentSchema, formData), { admissionType, confirmNotDuplicate });
      const message = [
        `Converted. Admission number ${result.admissionNumber}.`,
        ...result.invites.map((invite) => `${invite.label}: ${inviteMessage(invite)}`),
        ...result.notes,
      ].join(" ");
      return successResult(message, { studentId: result.studentId, admissionNumber: result.admissionNumber, next: { href: `/school-admin/students/${result.studentId}`, label: "Open the student's profile" } });
    },
    { revalidate: ["/school-admin", "/parent"] },
  );
}
