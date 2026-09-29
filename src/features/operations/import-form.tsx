"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";

/**
 * Upload a CSV to an import action. Row errors are listed by row number;
 * the imports themselves save nothing unless every row passes.
 */
export function CsvImportForm({
  action,
  label = "Import",
}: {
  action: (state: ActionResult<undefined>, formData: FormData) => Promise<ActionResult<undefined>>;
  label?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" } as ActionResult<undefined>);
  const errors = state.status === "error" ? Object.entries(state.fieldErrors ?? {}) : [];
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept=".csv,text/csv" required className="max-w-xs" aria-label="CSV file" />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Checking…" : label}
        </Button>
      </div>
      {state.status === "success" ? (
        <p role="status" className="text-sm text-success-strong">
          {state.message}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          <p>{state.message}</p>
          {errors.length ? (
            <ul className="mt-1 list-disc pl-5">
              {errors.slice(0, 100).map(([key, messages]) => (
                <li key={key}>
                  {key.replace(/^line (\d+)#\d+$/, "Row $1")}: {messages[0]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
