"use client";

import type { Route } from "next";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import type { BulkResult } from "@/server/documents/service";

import { approveDocumentAction, bulkDocumentsAction, createDocumentAction, rejectDocumentAction, revokeDocumentAction, saveDocumentSettingsAction, saveSignatureAction } from "./actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const SIGNATORIES = [
  { value: "PRINCIPAL", label: "The Principal" },
  { value: "SCHOOL_ADMIN", label: "The School Admin / MD" },
];

export function DocumentSettingsForm({ values }: { values: { documentHeaderNote: string | null; documentFooterNote: string | null; adminSignatoryName: string | null; adminSignatoryTitle: string | null; certificateSignatory: string; employmentSignatory: string; tcApprovalRequired: boolean } }) {
  return (
    <ActionForm action={saveDocumentSettingsAction} className="gap-4">
      <TextField name="documentHeaderNote" label="Line under the school's name" defaultValue={values.documentHeaderNote ?? ""} placeholder="Affiliated to CBSE, New Delhi · Affiliation no. 1234567" hint="Blank: the fee receipt's header line is used." />
      <TextareaField name="documentFooterNote" label="Footer" rows={2} defaultValue={values.documentFooterNote ?? ""} placeholder="This is a computer-generated document from the school's records." />
      <FieldRow>
        <TextField name="adminSignatoryName" label="School Admin / MD — name" defaultValue={values.adminSignatoryName ?? ""} />
        <TextField name="adminSignatoryTitle" label="School Admin / MD — designation" defaultValue={values.adminSignatoryTitle ?? ""} placeholder="Managing Director" />
      </FieldRow>
      <FieldRow>
        <SelectField name="certificateSignatory" label="Student certificates are signed by" options={SIGNATORIES} defaultValue={values.certificateSignatory} required />
        <SelectField name="employmentSignatory" label="Employment documents are signed by" options={SIGNATORIES} defaultValue={values.employmentSignatory} required />
      </FieldRow>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="tcApprovalRequired" defaultChecked={values.tcApprovalRequired} className="mt-0.5 size-4" />
        <span>
          <span className="font-medium">Transfer certificates need a second leader&apos;s approval</span>
          <span className="text-muted-foreground block text-xs">The School Admin or Principal who prepares a TC sends it for approval; the other approves it, and only then does it get its number.</span>
        </span>
      </label>
      <div>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Upload or remove one signatory's approved signature image (PNG or JPG, kept private). */
export function SignatureForm({ who, label, hasImage }: { who: "PRINCIPAL" | "SCHOOL_ADMIN"; label: string; hasImage: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private image served after an access check
        <img src={`/api/v1/documents/signatures/${who === "PRINCIPAL" ? "principal" : "admin"}`} alt={`${label} signature`} className="h-16 w-fit rounded border bg-white object-contain p-1" />
      ) : (
        <p className="text-muted-foreground text-sm">No signature image. Documents print with a blank line to sign by hand.</p>
      )}
      <ActionForm action={saveSignatureAction} className="flex-row flex-wrap items-end gap-2" resetOnSuccess>
        <input type="hidden" name="who" value={who} />
        <TextField name="file" label={`${label} signature (PNG or JPG)`} type="file" accept="image/png,image/jpeg" required />
        <SubmitButton size="sm" variant="outline" pendingLabel="Uploading…">
          Upload
        </SubmitButton>
      </ActionForm>
      {hasImage ? (
        <ActionButton action={saveSignatureAction} fields={{ who, remove: "true" }} variant="ghost" size="xs" confirm={{ title: "Remove this signature image?", description: "New documents print without it. Documents already issued keep the image they were issued with.", confirmLabel: "Remove" }}>
          Remove image
        </ActionButton>
      ) : null}
    </div>
  );
}

/**
 * Confirm a previewed document. The values shown in the preview travel as
 * hidden fields; one key per form, so pressing twice makes one document.
 */
export function IssueDocumentForm({ hidden, official, alreadyIssued, needsConfirm, disabled, forApproval = false }: { hidden: Record<string, string>; official: boolean; alreadyIssued: string | null; needsConfirm: boolean; disabled: boolean; forApproval?: boolean }) {
  const [requestKey] = useState(newKey);
  const label = forApproval ? "Send for approval" : official ? "Issue officially" : "Generate";
  return (
    <ActionForm action={createDocumentAction} className="gap-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="requestKey" value={requestKey} />
      {alreadyIssued ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="reissue" className="mt-0.5 size-4" required />
          <span>{`Issue again — ${alreadyIssued} becomes “superseded” (it stays on the register).`}</span>
        </label>
      ) : null}
      {needsConfirm ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirmed" className="mt-0.5 size-4" required />
          <span>I have checked every detail of this transfer certificate against the school&apos;s records.</span>
        </label>
      ) : null}
      <div>
        {disabled ? (
          <Button type="button" disabled>
            {label}
          </Button>
        ) : (
          <SubmitButton pendingLabel="Saving…">{label}</SubmitButton>
        )}
      </div>
      {disabled ? <p className="text-destructive text-sm">Fix what is listed as missing first.</p> : null}
    </ActionForm>
  );
}

export function RevokeDocumentForm({ documentId }: { documentId: string }) {
  return (
    <ActionForm action={revokeDocumentAction} className="gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <TextField name="reason" label="Reason for revoking" required />
      <div>
        <SubmitButton size="sm" variant="destructive" pendingLabel="Revoking…">
          Revoke
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Approve, or turn down with a reason, a document waiting for approval. */
export function ApprovalForms({ documentId, mine }: { documentId: string; mine: boolean }) {
  if (mine) return <p className="text-muted-foreground text-xs">Waiting for another leader to approve — you prepared it.</p>;
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionButton action={approveDocumentAction} fields={{ documentId }} size="sm" confirm={{ title: "Approve and issue this transfer certificate?", description: "It gets the school's next number and becomes official.", confirmLabel: "Approve" }}>
        Approve &amp; issue
      </ActionButton>
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer py-1.5">Not approve</summary>
        <div className="mt-2 max-w-sm">
          <ActionForm action={rejectDocumentAction} className="gap-2">
            <input type="hidden" name="documentId" value={documentId} />
            <TextField name="reason" label="Reason" required />
            <div>
              <SubmitButton size="sm" variant="destructive" pendingLabel="Saving…">
                Not approve
              </SubmitButton>
            </div>
          </ActionForm>
        </div>
      </details>
    </div>
  );
}

type Option = { value: string; label: string; published?: boolean };

/**
 * Select rows on a list and make one document type for them. The list's own
 * rows carry a checkbox named `personIds` with `data-bulk-row`; "Select all
 * on this page" ticks only the rows shown — never the whole school. The run
 * reports made / already made / skipped (with reasons); "Retry skipped" runs
 * the same batch again, which never makes a second copy of anything.
 */
export function BulkDocumentsPanel({ kind, types, exams = [], children }: { kind: "STUDENT" | "TEACHER" | "STAFF" | "PRINCIPAL"; types: Option[]; exams?: Option[]; children: React.ReactNode }) {
  const area = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [type, setType] = useState(types[0]?.value ?? "");
  const [batchKey, setBatchKey] = useState(newKey);

  useEffect(() => {
    const root = area.current;
    if (!root) return;
    // A row can appear twice (phone card and desktop table): count each person once.
    const sync = () => setSelected([...new Set([...root.querySelectorAll<HTMLInputElement>("input[data-bulk-row]:checked")].map((input) => input.value))]);
    root.addEventListener("change", sync);
    return () => root.removeEventListener("change", sync);
  }, []);

  const setAll = (on: boolean) => {
    const root = area.current;
    if (!root) return;
    for (const input of root.querySelectorAll<HTMLInputElement>("input[data-bulk-row]")) input.checked = on;
    setSelected(on ? [...new Set([...root.querySelectorAll<HTMLInputElement>("input[data-bulk-row]")].map((input) => input.value))] : []);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">{selected.length ? `${selected.length} selected on this page` : "Tick rows to make documents for them"}</span>
          <button type="button" className="text-primary underline" onClick={() => setAll(true)}>
            Select all on this page
          </button>
          {selected.length ? (
            <button type="button" className="text-primary underline" onClick={() => setAll(false)}>
              Clear selection
            </button>
          ) : null}
        </div>
        {selected.length ? <BulkForm kind={kind} types={types} exams={exams} selected={selected} type={type} setType={setType} batchKey={batchKey} onNew={() => setBatchKey(newKey())} /> : null}
      </div>
      <div ref={area}>{children}</div>
    </div>
  );
}

/** The bulk form, with its own result: made, already made, and each skipped record with the reason. */
function BulkForm({ kind, types, exams, selected, type, setType, batchKey, onNew }: { kind: string; types: Option[]; exams: Option[]; selected: string[]; type: string; setType: (value: string) => void; batchKey: string; onNew: () => void }) {
  const [state, dispatch, pending] = useActionState(bulkDocumentsAction, { status: "idle" } as ActionResult<BulkResult>);
  const result = state.status === "success" ? state.data : null;
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => dispatch(formData));
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="batchKey" value={batchKey} />
      {selected.map((value) => (
        <input key={value} type="hidden" name="personIds" value={value} />
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <SelectField name="type" label="Document" options={types} value={type} onChange={(event) => setType(event.target.value)} required />
        {type === "MARKSHEET" || type === "ADMIT_CARD" ? (
          <SelectField
            name="examId"
            label={type === "MARKSHEET" ? "Published examination" : "Examination"}
            options={(type === "MARKSHEET" ? exams.filter((exam) => exam.published !== false) : exams).map(({ value, label }) => ({ value, label }))}
            placeholder={exams.length ? "Choose" : "No examination"}
            required
          />
        ) : null}
        {["BONAFIDE_CERTIFICATE", "ENROLLMENT_CONFIRMATION", "ATTENDANCE_CERTIFICATE", "EMPLOYMENT_VERIFICATION"].includes(type) ? <TextField name="purpose" label="Purpose (optional)" /> : null}
        {type === "CHARACTER_CERTIFICATE" ? <TextField name="conduct" label="Conduct" placeholder="Good" required /> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Making…" : result ? "Retry skipped" : "Make for selected"}
        </Button>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-white p-3 text-sm dark:bg-transparent">
          <p className="font-medium">{`Made ${result.created} · already made ${result.repeated} · skipped ${result.skipped.length}`}</p>
          {result.skipped.length ? (
            <ul className="text-muted-foreground list-disc pl-5 text-xs">
              {result.skipped.map((row) => (
                <li key={row.personId}>{`${row.name}: ${row.reason}`}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {result.documentIds.length ? (
              <Button asChild size="sm">
                <Link href={`/documents/print?batch=${result.batchKey}` as Route} target="_blank">
                  {type.endsWith("ID_CARD") ? "Print on A4 sheets (10 a page)" : "Print / save as PDF"}
                </Link>
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onNew}>
              Start a new batch
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">Retrying the same batch never makes a second copy; it only tries the skipped ones again.</p>
        </div>
      ) : null}
    </form>
  );
}

/** The checkbox on one list row, picked up by `BulkDocumentsPanel`. */
export function BulkRowCheckbox({ id, label }: { id: string; label: string }) {
  return <input type="checkbox" data-bulk-row value={id} aria-label={`Select ${label}`} className="size-4" />;
}
