import { z } from "zod";

import { id } from "@/lib/validation/common";
import { STUDENT_STATUSES } from "@/lib/validation/school";

const idList = z.preprocess(
  (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
  z.array(id).min(1, "Tick at least one student").max(1000),
);

/** The destination session is the target section's own session. */
export const promoteSchema = z.object({
  fromSessionId: id,
  promoteToSectionId: id,
  studentIds: idList,
});

export const changeSectionSchema = z.object({
  moveToSectionId: id,
  studentIds: idList,
});

export const bulkStatusSchema = z.object({
  status: z.enum(STUDENT_STATUSES, { error: "Choose a status" }),
  studentIds: idList,
});

// -----------------------------------------------------------------------------
// Whole-school promotion
// -----------------------------------------------------------------------------

export const promotionPreviewSchema = z.object({
  fromSessionId: id,
  toSessionId: id,
  sectionIds: z.array(id).min(1, "Choose at least one class or section").max(500),
});

/** `SECTION:<id>`, `NEW:<classId>:<name>` or `GRADUATE`; decoded on the server. */
export const promotionBatchSchema = z.object({
  runId: z.string().uuid(),
  fromSessionId: id,
  toSessionId: id,
  fromSectionId: id,
  destination: z.string().trim().min(1, "Choose where this section goes").max(200),
  students: z
    .array(z.object({ studentId: id, repeat: z.boolean() }))
    .min(1, "Tick at least one student")
    .max(100),
});
