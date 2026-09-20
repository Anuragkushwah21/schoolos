"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

import type { FormAction } from "./action-form";

/**
 * A single button that invokes a Server Action with a few fixed fields —
 * publish, approve, remove. Outcomes surface as toasts.
 *
 * `confirm` puts a dialog in front of anything destructive or hard to undo.
 */
export function ActionButton({
  action,
  fields,
  children,
  pendingLabel,
  confirm,
  variant,
  size = "sm",
  className,
}: {
  action: FormAction<undefined>;
  fields: Record<string, string>;
  children: React.ReactNode;
  pendingLabel?: string;
  confirm?: { title: string; description: string; confirmLabel?: string };
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {
    status: "idle",
  } as ActionResult<undefined>);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);

  function run() {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    startTransition(() => dispatch(formData));
  }

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      onClick={() => (confirm ? setOpen(true) : run())}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );

  if (!confirm) return button;

  return (
    <>
      {button}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                run();
              }}
            >
              {confirm.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
