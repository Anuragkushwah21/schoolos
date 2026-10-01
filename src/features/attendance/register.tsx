"use client";

import { useEffect, useRef, useState } from "react";

import { ActionForm, type FormAction } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { markAttendanceAction, markStaffAttendanceAction, saveRegisterDraftAction } from "./actions";

/**
 * A register: one row per person, a segmented choice per row, and a single
 * save. Built for a phone in one hand — large targets, "all present" first,
 * then tap the exceptions.
 */

type Option = { value: string; label: string; short: string; tone: string };

const STUDENT_OPTIONS: Option[] = [
  { value: "PRESENT", label: "Present", short: "P", tone: "peer-checked:bg-success peer-checked:text-white peer-checked:border-success" },
  { value: "ABSENT", label: "Absent", short: "A", tone: "peer-checked:bg-danger peer-checked:text-white peer-checked:border-danger" },
  { value: "LATE", label: "Late", short: "L", tone: "peer-checked:bg-warning peer-checked:text-white peer-checked:border-warning" },
  { value: "EXCUSED", label: "Excused", short: "E", tone: "peer-checked:bg-info peer-checked:text-white peer-checked:border-info" },
];

const STAFF_OPTIONS: Option[] = [
  STUDENT_OPTIONS[0]!,
  STUDENT_OPTIONS[1]!,
  STUDENT_OPTIONS[2]!,
  { value: "ON_LEAVE", label: "On leave", short: "OL", tone: "peer-checked:bg-info peer-checked:text-white peer-checked:border-info" },
];

export type RegisterRow = {
  id: string;
  name: string;
  detail?: string | null;
  status: string | null;
  remarks: string | null;
  /** Approved leave for the day (the reason), if any. */
  leave?: string | null;
};

function RegisterForm({
  action,
  hidden,
  rows,
  options,
  editable,
  submitLabel = "Save attendance",
  footer,
  onEdit,
}: {
  action: FormAction<undefined>;
  hidden: Record<string, string>;
  rows: RegisterRow[];
  options: Option[];
  editable: boolean;
  submitLabel?: string;
  /** Shown above the button: draft status, correction window, reason field. */
  footer?: React.ReactNode;
  /** Called with the form after any change — used for auto-save. */
  onEdit?: (form: HTMLFormElement) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const edited = () => {
    const form = wrapper.current?.querySelector("form");
    if (form && onEdit) onEdit(form);
  };
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, row.status ?? ""])),
  );
  const counts = options.map((option) => ({
    ...option,
    count: Object.values(statuses).filter((value) => value === option.value).length,
  }));
  const unmarked = Object.values(statuses).filter((value) => !value).length;

  return (
    <div ref={wrapper} onChange={edited}>
    <ActionForm action={action} className="gap-4">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {counts.map((c) => `${c.count} ${c.label.toLowerCase()}`).join(" · ")}
          {unmarked ? ` · ${unmarked} not marked` : ""}
        </p>
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              // Students on approved leave are marked Excused, not Present — visibly, before saving.
              const excused = options.find((option) => option.value === "EXCUSED")?.value;
              const onLeave = new Set(rows.filter((row) => row.leave).map((row) => row.id));
              setStatuses((current) =>
                Object.fromEntries(Object.keys(current).map((key) => [key, current[key] || (onLeave.has(key) && excused ? excused : options[0]!.value)])),
              );
              // After React has ticked the radios, save the draft.
              setTimeout(edited, 0);
            }}
          >
            Mark the rest present
          </Button>
        ) : null}
      </div>

      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {row.name}
                {row.leave ? <span className="bg-info-soft text-info-strong rounded-full px-2 py-0.5 text-xs font-medium">On leave · {row.leave}</span> : null}
              </p>
              {row.detail ? <p className="text-muted-foreground text-xs">{row.detail}</p> : null}
              {row.leave && statuses[row.id] && statuses[row.id] !== "EXCUSED" ? (
                <p className="text-warning-strong text-xs" role="status">
                  Approved leave, but marked {options.find((option) => option.value === statuses[row.id])?.label ?? statuses[row.id]}. Change it to Excused if the leave was taken — the mark is not changed automatically.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <fieldset className="flex gap-1" disabled={!editable}>
                <legend className="sr-only">Attendance for {row.name}</legend>
                {options.map((option) => (
                  <label key={option.value} className="cursor-pointer">
                    <input
                      type="radio"
                      name={`status:${row.id}`}
                      value={option.value}
                      checked={statuses[row.id] === option.value}
                      onChange={() => setStatuses((current) => ({ ...current, [row.id]: option.value }))}
                      className="peer sr-only"
                    />
                    <span
                      title={option.label}
                      className={cn(
                        "peer-focus-visible:ring-ring/50 flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors peer-focus-visible:ring-3",
                        "hover:bg-muted",
                        option.tone,
                      )}
                    >
                      {option.short}
                      <span className="sr-only"> {option.label}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Input
                name={`remarks:${row.id}`}
                defaultValue={row.remarks ?? (row.leave && !row.status ? `Approved leave (${row.leave})` : "")}
                placeholder="Remark"
                aria-label={`Remark for ${row.name}`}
                disabled={!editable}
                className="h-9 w-full sm:w-40"
              />
            </div>
          </li>
        ))}
      </ul>

      {editable ? (
        <div className="bg-background/90 sticky bottom-0 -mx-1 flex flex-col gap-2 px-1 py-3 backdrop-blur">
          {footer}
          <div className="flex items-center gap-3">
            <SubmitButton pendingLabel="Saving…" className="h-10 px-6">
              {submitLabel}
            </SubmitButton>
            {unmarked ? <p className="text-muted-foreground text-xs">Unmarked rows are left as they are.</p> : null}
          </div>
        </div>
      ) : null}
    </ActionForm>
    </div>
  );
}

/** Marks in the form, as register entries — what auto-save sends. */
function entriesFrom(form: HTMLFormElement) {
  const data = new FormData(form);
  const entries: Array<{ studentId: string; status: string; remarks: string | null }> = [];
  for (const [key, value] of data.entries()) {
    if (!key.startsWith("status:") || typeof value !== "string" || !value) continue;
    const studentId = key.slice("status:".length);
    const remarks = data.get(`remarks:${studentId}`);
    entries.push({ studentId, status: value, remarks: typeof remarks === "string" && remarks.trim() ? remarks.trim() : null });
  }
  return entries;
}

const clock = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export type RegisterPhase = "NOT_TAKEN" | "DRAFT" | "CORRECTABLE" | "LOCKED";

/**
 * The student register. Before it is submitted, every tap is saved as a
 * draft (nothing reaches parents yet) and the footer says when it will be
 * submitted. After submission a correction needs a short reason and is only
 * possible until the deadline the server set — the server checks again.
 */
export function StudentRegister({
  sectionId,
  date,
  rows,
  editable,
  phase = "NOT_TAKEN",
  deadline = null,
  finalizeAt = null,
  draftSavedAt = null,
  submission = "AUTO",
  isAdmin = false,
}: {
  sectionId: string;
  date: string;
  rows: RegisterRow[];
  editable: boolean;
  phase?: RegisterPhase;
  deadline?: string | null;
  finalizeAt?: string | null;
  draftSavedAt?: string | null;
  submission?: "AUTO" | "MANUAL";
  isAdmin?: boolean;
}) {
  const drafting = phase === "NOT_TAKEN" || phase === "DRAFT";
  const [saved, setSaved] = useState<{ at: string | null; finalizeAt: string | null; failed: boolean }>({
    at: draftSavedAt,
    finalizeAt,
    failed: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  function autosave(form: HTMLFormElement) {
    if (!drafting || !editable) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const result = await saveRegisterDraftAction({ sectionId, date, entries: entriesFrom(form) }).catch(() => null);
      if (result?.status === "success") setSaved({ at: result.data.savedAt, finalizeAt: result.data.finalizeAt, failed: false });
      else setSaved((current) => ({ ...current, failed: true }));
    }, 700);
  }

  const footer = drafting ? (
    <p className="text-muted-foreground text-xs" aria-live="polite">
      {saved.failed
        ? "Could not save the draft — check your connection. Your marks are still on this page."
        : saved.at
          ? `Draft saved at ${clock(saved.at)}. `
          : "Marks are saved as a draft as you go. "}
      {submission === "AUTO" && saved.finalizeAt
        ? `It submits itself at ${clock(saved.finalizeAt)} — or submit now.`
        : "Press Submit when you are done."}
    </p>
  ) : (
    <div className="flex flex-col gap-1.5">
      {phase === "CORRECTABLE" && deadline && !isAdmin ? (
        <p className="text-success-strong text-sm">✓ Attendance submitted · correction available until {clock(deadline)}</p>
      ) : null}
      {/* A form field, so the server's "say why" appears right under it, highlighted. */}
      <TextField
        name="reason"
        label={`Reason for correction${isAdmin ? " (optional)" : ""}`}
        placeholder="e.g. Student was present but marked absent by mistake"
        maxLength={300}
        required={!isAdmin}
        hint={isAdmin ? undefined : "Needed only when you change a mark."}
      />
    </div>
  );

  return (
    <RegisterForm
      key={`${sectionId}-${date}`}
      action={markAttendanceAction}
      hidden={{ sectionId, date }}
      rows={rows}
      options={STUDENT_OPTIONS}
      editable={editable}
      submitLabel={drafting ? (submission === "AUTO" ? "Submit now" : "Submit attendance") : "Save correction"}
      footer={footer}
      onEdit={autosave}
    />
  );
}

export function StaffRegister({
  date,
  rows,
  editable = true,
}: {
  date: string;
  rows: RegisterRow[];
  editable?: boolean;
}) {
  return (
    <RegisterForm
      key={date}
      action={markStaffAttendanceAction}
      hidden={{ date }}
      rows={rows}
      options={STAFF_OPTIONS}
      editable={editable}
    />
  );
}
