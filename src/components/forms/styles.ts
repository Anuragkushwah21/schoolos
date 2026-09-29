/**
 * Class strings shared by client form fields and server-rendered filter forms.
 * Kept out of the "use client" modules: a Server Component importing a plain
 * value from one would receive a client reference, not the string.
 */
export const nativeSelectClass =
  "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-10 min-w-0 rounded-lg border bg-surface px-2.5 text-base outline-none focus-visible:ring-3 aria-invalid:ring-3 disabled:opacity-50 md:text-sm";
