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
