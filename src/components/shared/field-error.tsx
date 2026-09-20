/**
 * Inline validation message for a single form field.
 *
 * `role="alert"` so screen readers announce the problem when it appears, and
 * the id is wired to the input's `aria-describedby` by the caller.
 */
export function FieldError({
  id,
  messages,
}: {
  id: string;
  messages?: string[];
}) {
  if (!messages?.length) return null;

  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {messages[0]}
    </p>
  );
}
