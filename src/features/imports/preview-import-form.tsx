"use client";

import { useActionState, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { ActionResult } from "@/lib/action-result";

type Line = { line: number; message: string };

/** What an import action returns: the check / import report, plus any logins it created. */
export type PreviewImportResult = ActionResult<
  | {
      mode: "check" | "import";
      total: number;
      valid: number;
      created: number;
      errors: Line[];
      warnings: Line[];
      /** Logins created: one activation email each (no passwords are ever returned). */
      invites?: Array<{ email: string; delivered: boolean; label?: string }>;
    }
  | undefined
>;

function downloadCsv(fileName: string, head: string[], rows: Array<Array<string | number>>) {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const body = [head.map(quote).join(","), ...rows.map((row) => row.map(quote).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", body], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Upload → preview → import, for any importer that supports a check mode. "Check file" reads the file and saves nothing;
 * the preview shows valid rows, warnings and errors, and "Import valid
 * records" then admits the rows that passed, in one go.
 */
export function PreviewImportForm({
  action,
  noun,
}: {
  action: (state: PreviewImportResult, formData: FormData) => Promise<PreviewImportResult>;
  /** "student", "teacher" — for the file label and the download name. */
  noun: string;
}) {
  const [state, dispatch, pending] = useActionState<PreviewImportResult, FormData>(action, { status: "idle" });
  const form = useRef<HTMLFormElement>(null);
  const report = state.status === "success" ? state.data : undefined;
  const checked = report?.mode === "check" ? report : undefined;

  return (
    <form ref={form} action={dispatch} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="max-w-xs"
          aria-label={`${noun}s CSV file`}
        />
        <Button type="submit" name="mode" value="check" disabled={pending} variant={checked ? "outline" : "default"}>
          {pending ? "Checking…" : "Check file"}
        </Button>
      </div>
      <input type="hidden" name="validOnly" value="1" />

      {state.status === "error" ? (
        <p role="alert" className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
          {state.message}
        </p>
      ) : null}

      {report?.mode === "import" ? (
        <div role="status" className="border-success/30 bg-success-soft text-success-strong flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
          <p>{state.status === "success" && state.message ? state.message : "Nothing was imported."}</p>
          {report.invites?.length ? (
            <ul className="text-foreground list-disc pl-5 text-xs">
              {report.invites.map((invite) => (
                <li key={invite.email}>
                  {invite.label ? `${invite.label} · ` : ""}
                  {invite.email} — {invite.delivered ? "activation email sent" : "email not sent, resend from their page"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {checked ? (
        <div className="flex flex-col gap-3 rounded-xl border p-4" aria-live="polite">
          <p className="font-medium">Import preview — nothing has been saved yet</p>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">Valid rows</dt>
              <dd className="text-success-strong text-2xl font-semibold tabular-nums">{checked.valid}</dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">Warnings</dt>
              <dd className="text-warning-strong text-2xl font-semibold tabular-nums">{checked.warnings.length}</dd>
            </div>
            <div className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">Errors</dt>
              <dd className="text-danger-strong text-2xl font-semibold tabular-nums">{checked.errors.length}</dd>
            </div>
          </dl>

          {checked.errors.length ? (
            <details open className="text-sm">
              <summary className="cursor-pointer font-medium">Rows that cannot be imported</summary>
              <ul className="mt-2 list-disc pl-5">
                {checked.errors.slice(0, 100).map((error, index) => (
                  <li key={`${error.line}-${index}`}>
                    {error.line === 1 ? "Whole file" : `Row ${error.line}`}: {error.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {checked.warnings.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Warnings (these rows will still be imported)</summary>
              <ul className="text-muted-foreground mt-2 list-disc pl-5">
                {checked.warnings.slice(0, 100).map((warning, index) => (
                  <li key={`${warning.line}-${index}`}>
                    Row {warning.line}: {warning.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {checked.errors.length ? (
              <Button type="button" variant="outline" onClick={() => downloadCsv(`${noun}-import-errors.csv`, ["Row", "Problem"], checked.errors.map((error) => [error.line, error.message]))}>
                Download errors
              </Button>
            ) : null}
            <Button type="submit" name="mode" value="cancel" variant="ghost" formNoValidate>
              Cancel
            </Button>
            {checked.valid && !checked.errors.some((error) => error.line === 1) ? (
              <Button type="submit" name="mode" value="import" disabled={pending}>
                {pending ? "Importing…" : `Import ${checked.valid} valid record${checked.valid === 1 ? "" : "s"}`}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}
