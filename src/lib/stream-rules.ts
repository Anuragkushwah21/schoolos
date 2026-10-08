/**
 * Which classes take a stream, by class level (Nursery −3 … Class 12):
 *
 * - Nursery to Class 8: no stream.
 * - Class 9 and 10: optional — only if the school has streams set up.
 * - Class 11 and 12: required, from the school's own streams.
 *
 * The same rule runs in the browser (to show or hide the field) and on the
 * server (which is what actually decides).
 */

export type StreamRule = "NONE" | "OPTIONAL" | "REQUIRED";

export function streamRuleForLevel(level: number): StreamRule {
  if (level >= 11) return "REQUIRED";
  if (level >= 9) return "OPTIONAL";
  return "NONE";
}

/**
 * The problem with a class/stream choice, or null when it is fine.
 * `className` is only for the message.
 */
export function streamProblem(level: number, streamId: string | null | undefined, className = "This class"): string | null {
  const rule = streamRuleForLevel(level);
  if (rule === "NONE" && streamId) return `${className} has no stream — leave it as Not applicable.`;
  if (rule === "REQUIRED" && !streamId) return `Choose a stream for ${className}.`;
  return null;
}
