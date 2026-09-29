"use client";

import { useState } from "react";

import { ActionForm, type FormAction } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { markAttendanceAction, markStaffAttendanceAction } from "./actions";

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
};

function RegisterForm({
  action,
  hidden,
  rows,
  options,
  editable,
}: {
  action: FormAction<undefined>;
  hidden: Record<string, string>;
  rows: RegisterRow[];
  options: Option[];
  editable: boolean;
}) {
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, row.status ?? ""])),
  );
  const counts = options.map((option) => ({
    ...option,
    count: Object.values(statuses).filter((value) => value === option.value).length,
  }));
  const unmarked = Object.values(statuses).filter((value) => !value).length;

  return (
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
            onClick={() =>
              setStatuses((current) =>
                Object.fromEntries(Object.keys(current).map((key) => [key, current[key] || options[0]!.value])),
              )
            }
          >
            Mark the rest present
          </Button>
        ) : null}
      </div>

      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{row.name}</p>
              {row.detail ? <p className="text-muted-foreground text-xs">{row.detail}</p> : null}
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
                defaultValue={row.remarks ?? ""}
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
        <div className="bg-background/90 sticky bottom-0 -mx-1 flex items-center gap-3 px-1 py-3 backdrop-blur">
          <SubmitButton pendingLabel="Saving…" className="h-10 px-6">
            Save attendance
          </SubmitButton>
          {unmarked ? (
            <p className="text-muted-foreground text-xs">Unmarked rows are left as they are.</p>
          ) : null}
        </div>
      ) : null}
    </ActionForm>
  );
}

export function StudentRegister({
  sectionId,
  date,
  rows,
  editable,
}: {
  sectionId: string;
  date: string;
  rows: RegisterRow[];
  editable: boolean;
}) {
  return (
    <RegisterForm
      key={`${sectionId}-${date}`}
      action={markAttendanceAction}
      hidden={{ sectionId, date }}
      rows={rows}
      options={STUDENT_OPTIONS}
      editable={editable}
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
