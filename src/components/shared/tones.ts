/**
 * Semantic accent colours, one place. Each area of the app has a colour so
 * people learn it at a glance — students blue, teachers purple, attendance
 * green, money orange, warnings amber, problems red, information cyan — and
 * every tone is built only from the design tokens in `globals.css`, so it
 * follows light and dark mode automatically.
 *
 * A plain module (not "use client") so Server Components can use it too.
 */
export type AccentTone = "blue" | "purple" | "green" | "orange" | "amber" | "red" | "cyan" | "neutral";

/** Icon chip: tinted square with the accent colour. */
export const TONE_ICON: Record<AccentTone, string> = {
  blue: "bg-primary-soft text-primary-strong",
  purple: "bg-purple-soft text-purple-strong",
  green: "bg-success-soft text-success-strong",
  orange: "bg-orange-soft text-orange-strong",
  amber: "bg-warning-soft text-warning-strong",
  red: "bg-danger-soft text-danger-strong",
  cyan: "bg-info-soft text-info-strong",
  neutral: "bg-muted text-muted-foreground",
};

/** A thin accent bar along the top of a card. */
export const TONE_BAR: Record<AccentTone, string> = {
  blue: "bg-primary",
  purple: "bg-purple",
  green: "bg-success",
  orange: "bg-orange",
  amber: "bg-warning",
  red: "bg-danger",
  cyan: "bg-info",
  neutral: "bg-border",
};

/**
 * A filled, gradient icon tile with a white icon — the colourful version of
 * `TONE_ICON`, for stat cards, quick actions and page headers. Built only
 * from tokens, so it follows light and dark mode.
 */
export const TONE_SOLID: Record<AccentTone, string> = {
  blue: "bg-[linear-gradient(135deg,var(--brand-from),var(--primary))] text-white shadow-[0_6px_16px_-6px_var(--primary)]",
  purple: "bg-[linear-gradient(135deg,var(--purple),var(--brand-from))] text-white shadow-[0_6px_16px_-6px_var(--purple)]",
  green: "bg-[linear-gradient(135deg,var(--success),var(--info))] text-white shadow-[0_6px_16px_-6px_var(--success)]",
  orange: "bg-[linear-gradient(135deg,var(--orange),var(--warning))] text-white shadow-[0_6px_16px_-6px_var(--orange)]",
  amber: "bg-[linear-gradient(135deg,var(--warning),var(--orange))] text-white shadow-[0_6px_16px_-6px_var(--warning)]",
  red: "bg-[linear-gradient(135deg,var(--danger),var(--orange))] text-white shadow-[0_6px_16px_-6px_var(--danger)]",
  cyan: "bg-[linear-gradient(135deg,var(--info),var(--primary))] text-white shadow-[0_6px_16px_-6px_var(--info)]",
  neutral: "bg-muted text-muted-foreground",
};

/** A soft glow of the accent colour in a card's corner (decoration only). */
export const TONE_GLOW: Record<AccentTone, string> = {
  blue: "bg-primary/15",
  purple: "bg-purple/15",
  green: "bg-success/15",
  orange: "bg-orange/15",
  amber: "bg-warning/15",
  red: "bg-danger/15",
  cyan: "bg-info/15",
  neutral: "bg-muted",
};

/** The same colours in order, for things without a fixed area (a person's initials, list items). */
export const TONE_CYCLE: AccentTone[] = ["blue", "purple", "green", "orange", "cyan", "red", "amber"];

/** A stable colour for a name, so the same person always gets the same initials colour. */
export function toneFor(key: string): AccentTone {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TONE_CYCLE[hash % TONE_CYCLE.length]!;
}
