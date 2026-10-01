/**
 * Where an exam is in its life, worked out from its papers and marks — never
 * stored, so it cannot drift from the marks actually entered.
 *
 *   DRAFT             no papers yet, or none has been held
 *   IN_PROGRESS       some papers held, some still to come
 *   MARKS_PENDING     every paper held, some marks still to enter
 *   READY_TO_PUBLISH  every paper held and every mark in
 *   PUBLISHED         results are out to students and parents
 *
 * Only READY_TO_PUBLISH can be published; `publishBlocker` says, in plain
 * words, what stands in the way otherwise.
 */
export const EXAM_STAGES = ["DRAFT", "IN_PROGRESS", "MARKS_PENDING", "READY_TO_PUBLISH", "PUBLISHED"] as const;
export type ExamStage = (typeof EXAM_STAGES)[number];

export type ExamProgress = {
  published: boolean;
  papers: number;
  /** Papers dated after today. */
  notHeld: number;
  entered: number;
  expected: number;
};

export function examStage(p: ExamProgress): ExamStage {
  if (p.published) return "PUBLISHED";
  if (p.papers === 0 || p.notHeld === p.papers) return "DRAFT";
  if (p.notHeld > 0) return "IN_PROGRESS";
  if (p.entered < p.expected) return "MARKS_PENDING";
  return "READY_TO_PUBLISH";
}

export const EXAM_STAGE_LABEL: Record<ExamStage, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  MARKS_PENDING: "Marks pending",
  READY_TO_PUBLISH: "Ready to publish",
  PUBLISHED: "Published",
};

export const EXAM_STAGE_TONE: Record<ExamStage, "neutral" | "info" | "warning" | "positive"> = {
  DRAFT: "neutral",
  IN_PROGRESS: "info",
  MARKS_PENDING: "warning",
  READY_TO_PUBLISH: "positive",
  PUBLISHED: "positive",
};

/** Why these results cannot be published yet, as a sentence — or null when they can. */
export function publishBlocker(p: ExamProgress): { headline: string; detail: string; action: "papers" | "marks" } | null {
  const stage = examStage(p);
  if (stage === "READY_TO_PUBLISH" || stage === "PUBLISHED") return null;
  if (p.papers === 0) return { headline: "Results can't be published yet.", detail: "This exam has no papers.", action: "papers" };
  if (p.notHeld > 0) {
    return {
      headline: "Results can't be published yet.",
      detail: `${p.notHeld} paper${p.notHeld === 1 ? " is" : "s are"} still pending.`,
      action: "papers",
    };
  }
  const missing = p.expected - p.entered;
  return {
    headline: "All papers are complete.",
    detail: `${p.entered} / ${p.expected} marks entered. ${missing} mark${missing === 1 ? " is" : "s are"} still missing.`,
    action: "marks",
  };
}
