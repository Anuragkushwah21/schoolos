/**
 * Marks → grades, the same arithmetic on every screen and report card.
 *
 * Each school sets its own grading scale and default pass percentage
 * (Settings → Grading; `School.gradeBands` / `passPercent`). Without one, the
 * nine-point CBSE scheme Indian schools know applies: A1 for 91–100% down to
 * E below 33%, and a paper with no pass mark of its own passes at 33%.
 *
 * Marks are whole numbers, so percentages are worked out in integers and
 * rounded half up to one decimal place — no floating-point drift: 2/3 is
 * always 66.7, and 45.45 is never 45.4. A grade is read from that rounded
 * percentage, which is the figure the report card prints.
 */

export type GradeBand = { min: number; grade: string };
export type GradingRules = { bands: GradeBand[]; passPercent: number };

export const DEFAULT_PASS_PERCENT = 33;
/** Kept for older callers: the default pass share (33%). */
export const DEFAULT_PASS_SHARE = DEFAULT_PASS_PERCENT / 100;

export const DEFAULT_BANDS: GradeBand[] = [
  { min: 91, grade: "A1" },
  { min: 81, grade: "A2" },
  { min: 71, grade: "B1" },
  { min: 61, grade: "B2" },
  { min: 51, grade: "C1" },
  { min: 41, grade: "C2" },
  { min: 33, grade: "D" },
  { min: 0, grade: "E" },
];

export const DEFAULT_RULES: GradingRules = { bands: DEFAULT_BANDS, passPercent: DEFAULT_PASS_PERCENT };

/**
 * A school's scale, checked: 2–15 bands, highest first, each starting at a
 * whole percentage from 0 to 100, no two at the same point, unique grade
 * names, and the last starting at 0 so every mark has a grade. Returns the
 * reason when it is not valid.
 */
export function checkBands(value: unknown): { ok: true; bands: GradeBand[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || value.length < 2 || value.length > 15) return { ok: false, reason: "Use between 2 and 15 grades." };
  const bands: GradeBand[] = [];
  for (const raw of value) {
    const min = typeof raw?.min === "number" ? raw.min : Number(raw?.min);
    const grade = typeof raw?.grade === "string" ? raw.grade.trim() : "";
    if (!grade || grade.length > 10) return { ok: false, reason: "Every grade needs a short name (up to 10 characters)." };
    if (!Number.isInteger(min) || min < 0 || min > 100) return { ok: false, reason: `"${grade}" must start at a whole percentage from 0 to 100.` };
    bands.push({ min, grade });
  }
  bands.sort((a, b) => b.min - a.min);
  if (new Set(bands.map((band) => band.min)).size !== bands.length) return { ok: false, reason: "Two grades start at the same percentage." };
  if (new Set(bands.map((band) => band.grade.toLowerCase())).size !== bands.length) return { ok: false, reason: "Each grade name can appear once." };
  if (bands[bands.length - 1]!.min !== 0) return { ok: false, reason: "The lowest grade must start at 0%, so every mark has a grade." };
  return { ok: true, bands };
}

/** The school's rules from its stored settings, falling back to the default for anything invalid. */
export function rulesFrom(stored: { gradeBands?: unknown; passPercent?: number | null } | null | undefined): GradingRules {
  const checked = stored?.gradeBands ? checkBands(stored.gradeBands) : null;
  const pass = stored?.passPercent;
  return {
    bands: checked && checked.ok ? checked.bands : DEFAULT_BANDS,
    passPercent: Number.isInteger(pass) && pass! >= 1 && pass! <= 100 ? pass! : DEFAULT_PASS_PERCENT,
  };
}

/**
 * `obtained / max` as a percentage to one decimal place, rounded half up, in
 * integer arithmetic. Null when there is nothing to divide.
 */
export function percentage(obtained: number, max: number): number | null {
  if (max <= 0) return null;
  if (Number.isInteger(obtained) && Number.isInteger(max)) {
    // tenths = round(obtained * 1000 / max), half up, without floats.
    return Math.floor((obtained * 2000 + max) / (2 * max)) / 10;
  }
  return Math.round((obtained / max) * 1000) / 10;
}

export function gradeFor(percent: number | null, bands: readonly GradeBand[] = DEFAULT_BANDS): string | null {
  if (percent === null) return null;
  return bands.find((band) => percent >= band.min)?.grade ?? bands[bands.length - 1]?.grade ?? null;
}

/** The paper's own pass mark, or the school's pass percentage of its maximum (rounded up). */
export function passMarkFor(maxMarks: number, passMarks: number | null | undefined, passPercent: number = DEFAULT_PASS_PERCENT): number {
  if (passMarks !== null && passMarks !== undefined) return passMarks;
  return Math.floor((maxMarks * passPercent + 99) / 100);
}

export type PaperOutcome = "PASS" | "FAIL" | "ABSENT" | "EXEMPT" | "PENDING";

export function paperOutcome(
  paper: { maxMarks: number; passMarks: number | null },
  result: { marksObtained: number | null; absent: boolean; exempt?: boolean } | null,
  passPercent: number = DEFAULT_PASS_PERCENT,
): PaperOutcome {
  if (!result) return "PENDING";
  if (result.exempt) return "EXEMPT";
  if (result.absent) return "ABSENT";
  if (result.marksObtained === null) return "PENDING";
  return result.marksObtained >= passMarkFor(paper.maxMarks, paper.passMarks, passPercent) ? "PASS" : "FAIL";
}

export type ExamOutcome = "PASS" | "FAIL" | "INCOMPLETE";

/**
 * The overall result: PASS only when every paper sat is passed. A missing mark
 * makes it INCOMPLETE rather than a fail — the teacher has not finished — an
 * absence fails the paper, as it would on a printed report card, and an
 * exempt paper is left out altogether.
 */
export function examOutcome(outcomes: PaperOutcome[]): ExamOutcome {
  const counted = outcomes.filter((outcome) => outcome !== "EXEMPT");
  if (counted.length === 0 || counted.includes("PENDING")) return "INCOMPLETE";
  return counted.every((outcome) => outcome === "PASS") ? "PASS" : "FAIL";
}

/** Has this paper been dealt with — a mark, Absent or Exempt? */
export function isEntered(result: { marksObtained: number | null; absent: boolean; exempt?: boolean } | null | undefined): boolean {
  return Boolean(result && (result.exempt || result.absent || result.marksObtained !== null));
}

export const OUTCOME_LABEL: Record<PaperOutcome | ExamOutcome, string> = {
  PASS: "Pass",
  FAIL: "Needs improvement",
  ABSENT: "Absent",
  EXEMPT: "Exempt",
  PENDING: "Not entered",
  INCOMPLETE: "Incomplete",
};

/** "A1 91–100 · A2 81–90 · …" for a report card's grading key. */
export function gradingKey(bands: readonly GradeBand[]): string {
  return bands.map((band, index) => `${band.grade} ${band.min}${index === 0 ? "–100" : `–${bands[index - 1]!.min - 1}`}`).join(" · ");
}

/**
 * A weighted final result for one subject: each component's percentage times
 * its weight, over the weights of the components the student actually has (a
 * component not yet published, or exempt, is left out rather than counted as
 * zero). Never raw marks added across different maximums. Returns null when
 * no component counts.
 */
export function weightedPercent(components: ReadonlyArray<{ percent: number | null; weight: number }>): number | null {
  const counted = components.filter((row) => row.percent !== null && row.weight > 0);
  const weights = counted.reduce((sum, row) => sum + row.weight, 0);
  if (!weights) return null;
  // Percentages carry one decimal: work in hundredths of a percent-weight, then round once.
  const tenths = counted.reduce((sum, row) => sum + Math.round(row.percent! * 10) * row.weight, 0);
  return Math.floor((tenths * 2 + weights) / (2 * weights)) / 10;
}
