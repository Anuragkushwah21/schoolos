/**
 * Marks → grades, the same arithmetic on every screen and report card.
 *
 * The scale is the nine-point CBSE scheme Indian schools know: A1 for 91–100%
 * down to E below 33%. A paper with no explicit pass mark passes at 33%, the
 * CBSE and most state-board minimum.
 */

export const DEFAULT_PASS_SHARE = 0.33;

const SCALE: Array<{ min: number; grade: string }> = [
  { min: 91, grade: "A1" },
  { min: 81, grade: "A2" },
  { min: 71, grade: "B1" },
  { min: 61, grade: "B2" },
  { min: 51, grade: "C1" },
  { min: 41, grade: "C2" },
  { min: 33, grade: "D" },
  { min: 0, grade: "E" },
];

/** Percentage to one decimal place, or null when there is nothing to divide. */
export function percentage(obtained: number, max: number): number | null {
  if (max <= 0) return null;
  return Math.round((obtained / max) * 1000) / 10;
}

export function gradeFor(percent: number | null): string | null {
  if (percent === null) return null;
  return SCALE.find((band) => percent >= band.min)?.grade ?? "E";
}

export function passMarkFor(maxMarks: number, passMarks: number | null | undefined): number {
  return passMarks ?? Math.ceil(maxMarks * DEFAULT_PASS_SHARE);
}

export type PaperOutcome = "PASS" | "FAIL" | "ABSENT" | "PENDING";

export function paperOutcome(
  paper: { maxMarks: number; passMarks: number | null },
  result: { marksObtained: number | null; absent: boolean } | null,
): PaperOutcome {
  if (!result) return "PENDING";
  if (result.absent) return "ABSENT";
  if (result.marksObtained === null) return "PENDING";
  return result.marksObtained >= passMarkFor(paper.maxMarks, paper.passMarks) ? "PASS" : "FAIL";
}

export type ExamOutcome = "PASS" | "FAIL" | "INCOMPLETE";

/**
 * The overall result: PASS only when every paper is passed. A missing mark
 * makes it INCOMPLETE rather than a fail — the teacher has not finished — and
 * an absence fails the paper, as it would on a printed report card.
 */
export function examOutcome(outcomes: PaperOutcome[]): ExamOutcome {
  if (outcomes.length === 0 || outcomes.includes("PENDING")) return "INCOMPLETE";
  return outcomes.every((outcome) => outcome === "PASS") ? "PASS" : "FAIL";
}

export const OUTCOME_LABEL: Record<PaperOutcome | ExamOutcome, string> = {
  PASS: "Pass",
  FAIL: "Needs improvement",
  ABSENT: "Absent",
  PENDING: "Not entered",
  INCOMPLETE: "Incomplete",
};
