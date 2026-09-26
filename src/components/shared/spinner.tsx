import { cn } from "@/lib/utils";

/**
 * The one spinner in the app.
 *
 * A bordered circle with one transparent edge, rotated by CSS: no SVG, no
 * library, and nothing to animate in JavaScript. `currentColor` means it takes
 * the colour of whatever it sits in, so the same component works inside a
 * primary button, a ghost button and body text.
 *
 * `aria-hidden`, deliberately. A spinner is decoration; what a screen reader
 * needs is the text beside it changing from "Save" to "Saving…", which is what
 * every caller does.
 */
export function Spinner({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const sizes = {
    xs: "size-3 border",
    sm: "size-4 border-2",
    md: "size-6 border-2",
    lg: "size-8 border-[3px]",
  } as const;

  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent",
        sizes[size],
        className,
      )}
    />
  );
}

/**
 * A centred spinner for a whole route, used by `loading.tsx` files.
 *
 * The label is read out, because here the spinner *is* the only thing on screen
 * and silence would leave a screen reader with nothing to announce.
 */
export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted-foreground flex min-h-[40vh] flex-col items-center justify-center gap-3"
    >
      <Spinner size="lg" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
