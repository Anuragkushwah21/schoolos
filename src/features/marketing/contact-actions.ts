"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { INQUIRY_STATUSES, inquirySchema } from "@/lib/validation/platform";
import { id } from "@/lib/validation/common";
import { requireRoleForAction } from "@/server/auth/current-user";
import { setInquiryStatus, submitInquiry } from "@/server/platform/inquiries";
import { performAction } from "@/server/perform-action";

/**
 * The public contact form, and the Super Admin's handling of what it receives.
 *
 * Sending needs no account — that is the point of the page. Handling re-checks
 * the Super Admin role here and again in the service.
 */

export async function sendInquiryAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(inquirySchema, formData);
      const forwarded = (await headers()).get("x-forwarded-for");
      await submitInquiry(input, { ipAddress: forwarded?.split(",")[0]?.trim() ?? null });
      return successResult("Thank you — your message has reached the SchoolOS team. We will get back to you soon.");
    },
    { revalidate: "/super-admin" },
  );
}

export async function setInquiryStatusAction(
  _previous: ActionResult<undefined>,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return performAction(
    async () => {
      const actor = await requireRoleForAction("SUPER_ADMIN");
      const { inquiryId, status } = parseFormData(
        z.object({ inquiryId: id, status: z.enum(INQUIRY_STATUSES) }),
        formData,
      );
      await setInquiryStatus(actor, inquiryId, status);
      return successResult("Enquiry updated.");
    },
    { revalidate: "/super-admin" },
  );
}
