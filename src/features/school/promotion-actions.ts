"use server";

import type { z } from "zod";

import { type ActionResult, runAction, successResult } from "@/lib/action-result";
import { AppError, ValidationError } from "@/lib/errors";
import { promotionBatchSchema, promotionPreviewSchema } from "@/lib/validation/bulk-students";
import {
  type PromotionBatchResult,
  type PromotionPreview,
  decodeDestination,
  previewPromotion,
  runPromotionBatch,
} from "@/server/academics/promotion";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";

/**
 * Whole-school promotion. Both actions take plain objects rather than
 * FormData: the preview is a nested plan the page edits in memory. Neither
 * trusts anything but ids — the school comes from the session, and every
 * student and section is looked up again inside it.
 */

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  throw new ValidationError(parsed.error.issues[0]?.message ?? "Please check the promotion.", fieldErrors);
}

export async function previewPromotionAction(input: unknown): Promise<ActionResult<PromotionPreview>> {
  return runAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN");
    return successResult(undefined, await previewPromotion(ctx, parse(promotionPreviewSchema, input)));
  });
}

export async function promotionBatchAction(input: unknown): Promise<ActionResult<PromotionBatchResult>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { destination, ...rest } = parse(promotionBatchSchema, input);
      const decoded = decodeDestination(destination);
      if (!decoded) throw new AppError("VALIDATION", "Choose where this section goes.");
      return successResult(undefined, await runPromotionBatch(ctx, { ...rest, destination: decoded }));
    },
    { revalidate: ["/school-admin", "/teacher", "/student", "/parent"] },
  );
}
