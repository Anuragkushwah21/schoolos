"use client";

import { useTransition } from "react";

import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";

import { logoutAction } from "./actions";

/**
 * Signing out, with the press acknowledged.
 *
 * A plain `<form action={logoutAction}>` works but gives no feedback: the button
 * sits there while the session row is deleted and the cookie cleared, and an
 * impatient second press fires a second request. `useTransition` gives the
 * pending flag that both disables the button and changes its label.
 *
 * `logoutAction` redirects, so there is no success state to return to — the
 * button stays disabled until the new page arrives, which is the honest thing
 * for it to do.
 */
export function SignOutButton({
  variant = "outline",
  size = "sm",
  className,
}: {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => start(() => void logoutAction())}
    >
      {pending ? (
        <>
          <Spinner size="xs" />
          Signing out…
        </>
      ) : (
        "Sign out"
      )}
    </Button>
  );
}
