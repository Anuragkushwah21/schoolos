"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { importStudentsAction, type StudentImportResult } from "./bulk-student-actions";

/** Upload the filled template. Row errors are listed; nothing is saved until every row passes. */
export function StudentImportForm() {
  const [state, dispatch, pending] = useActionState<StudentImportResult, FormData>(importStudentsAction, { status: "idle" });
  const errors = state.status === "error" ? Object.entries(state.fieldErrors ?? {}) : [];
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept=".csv,text/csv" required className="max-w-xs" aria-label="Students CSV file" />
        <Button type="submit" disabled={pending}>
          {pending ? "Checking and importing…" : "Import students"}
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
