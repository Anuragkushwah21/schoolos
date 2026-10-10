import { z } from "zod";

import { checkbox, id, optionalId, optionalText, requiredText } from "@/lib/validation/common";

const list = z.preprocess((value) => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]), z.array(z.string().max(64)).max(200));

export const FEATURE_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const FEATURE_STATUSES = ["SUBMITTED", "NEEDS_INFO", "UNDER_EVALUATION", "APPROVED", "IN_DEVELOPMENT", "TESTING", "RELEASED", "DECLINED"] as const;
export const FEATURE_SCOPES = ["CUSTOMER_SPECIFIC", "OPTIONAL_MODULE", "STANDARD_FEATURE", "PREMIUM_ADDON"] as const;

/** The owner's request form. */
export const featureRequestSchema = z.object({
  title: requiredText("a short title", 120),
  problem: requiredText("the problem you want solved", 2000),
  description: requiredText("a description", 4000),
  expectedOutcome: optionalText(2000),
  schoolId: optionalId,
  moduleKey: optionalText(40),
  priority: z.enum(FEATURE_PRIORITIES).default("MEDIUM"),
  examples: optionalText(2000),
});

export const featureCommentSchema = z.object({ requestId: id, body: requiredText("your reply", 2000) });

/** The Super Admin's decision form. Money in rupees, stored in paise. */
export const featureDecisionSchema = z.object({
  requestId: id,
  status: z.enum(FEATURE_STATUSES),
  note: optionalText(2000),
  internal: checkbox,
  estimatedTimeline: optionalText(200),
  estimatedCostRupees: z.preprocess((value) => (value === "" || value === undefined ? undefined : value), z.coerce.number().min(0).max(100_000_000).optional()),
  costAgreed: checkbox,
  potentialStandard: checkbox,
  releaseScope: z.preprocess((value) => (value === "" ? undefined : value), z.enum(FEATURE_SCOPES).optional()),
  eligiblePlanIds: list,
  eligibleOrgIds: list,
  releaseNote: optionalText(2000),
  developedBy: optionalText(200),
  testedBy: optionalText(200),
});
