"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextareaField, TextField } from "@/components/forms/fields";
import { STUDENT_LEAVE_REASONS } from "@/lib/validation/student-leave";

import { applyStudentLeaveAction, decideStudentLeaveAction, saveStudentLeaveSettingsAction } from "./actions";

const REASON_LABELS: Record<(typeof STUDENT_LEAVE_REASONS)[number], string> = {
  SICK: "Sick",
  FAMILY_FUNCTION: "Family function",
  MEDICAL_APPOINTMENT: "Medical appointment",
  PERSONAL: "Personal reason",
  TRAVEL: "Travel",
  OTHER: "Other",
};

/**
 * Apply for Leave: child (for a parent), dates, reason, an optional note.
 * The server checks the child is theirs and the dates make sense.
 */
export function ApplyLeaveForm({ targets, defaultStudentId, today }: { targets: Array<{ id: string; name: string; group: string; classTeacher: string | null }>; defaultStudentId?: string; today: string }) {
  const [studentId, setStudentId] = useState(defaultStudentId && targets.some((t) => t.id === defaultStudentId) ? defaultStudentId : (targets[0]?.id ?? ""));
  const [reason, setReason] = useState("SICK");
  const [from, setFrom] = useState(today);
  const target = targets.find((row) => row.id === studentId);
  return (
    <ActionForm action={applyStudentLeaveAction} resetOnSuccess className="gap-4">
      {targets.length > 1 ? (
        <SelectField
          name="studentId"
          label="Child"
          options={targets.map((row) => ({ value: row.id, label: `${row.name} · ${row.group}` }))}
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          required
        />
      ) : (
        <>
          <input type="hidden" name="studentId" value={studentId} />
          {target ? (
            <p className="text-sm">
              <span className="font-semibold">{target.name}</span> <span className="text-muted-foreground">· {target.group}</span>
            </p>
          ) : null}
        </>
      )}
      <FieldRow>
        <TextField name="fromDate" label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} required />
        <TextField name="toDate" label="To date" type="date" defaultValue={today} min={from} required />
      </FieldRow>
      <SelectField
        name="reason"
        label="Reason"
        options={STUDENT_LEAVE_REASONS.map((value) => ({ value, label: REASON_LABELS[value] }))}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
      />
      {reason === "OTHER" ? <TextField name="reasonText" label="Your reason" required /> : null}
      <TextareaField name="note" label="Additional note (optional)" rows={2} />
      {target?.classTeacher ? <p className="text-muted-foreground text-xs">It goes to {target.classTeacher}, the class teacher, to approve.</p> : null}
      <div>
        <SubmitButton size="lg" pendingLabel="Submitting…">
          Submit Leave Request
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Approve / Reject with an optional comment. */
export function LeaveDecisionForm({ leaveId, status }: { leaveId: string; status: string }) {
  return (
    <ActionForm action={decideStudentLeaveAction} className="gap-2">
      <input type="hidden" name="leaveId" value={leaveId} />
      <TextField name="comment" label="Comment (optional)" />
      <div className="flex flex-wrap gap-2">
        {status !== "APPROVED" ? (
          <SubmitButton size="sm" name="decision" value="APPROVE" pendingLabel="Saving…">
            Approve
          </SubmitButton>
        ) : null}
        {status !== "REJECTED" ? (
          <SubmitButton size="sm" variant="outline" name="decision" value="REJECT" pendingLabel="Saving…">
            Reject
          </SubmitButton>
        ) : null}
      </div>
    </ActionForm>
  );
}

/** School Admin: how far back a family may date a request. */
export function LeaveSettingsForm({ backdateDays }: { backdateDays: number }) {
  return (
    <ActionForm action={saveStudentLeaveSettingsAction} className="gap-3">
      <TextField
        name="backdateDays"
        label="Leave may start up to (days ago)"
        type="number"
        min={0}
        max={60}
        defaultValue={String(backdateDays)}
        hint="0 means from today only. Future dates are always allowed."
        required
      />
      <div>
        <SubmitButton size="sm" variant="outline">
          Save
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
