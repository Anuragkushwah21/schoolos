"use client";

import { CheckIcon, XIcon } from "lucide-react";
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
      <p className="text-muted-foreground text-xs">
        {target?.classTeacher
          ? `It goes to ${target.classTeacher} (class teacher) first, then the school gives the final approval.`
          : "It goes to the school office for approval."}
      </p>
      <div>
        <SubmitButton size="lg" pendingLabel="Submitting…">
          Submit Leave Request
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Approve / Reject with an optional comment. */
/**
 * Approve or reject, as two clear buttons. For the class teacher, approving
 * sends the request on to the School Admin. For the admin (principal) it is
 * the final decision — both buttons are always there while it waits, after
 * the class teacher's approval too; once decided, the admin may change it.
 */
export function LeaveDecisionForm({ leaveId, status, finalStep = false }: { leaveId: string; status: string; finalStep?: boolean }) {
  const decided = status === "APPROVED" || status === "REJECTED";
  return (
    <ActionForm action={decideStudentLeaveAction} className="border-primary/20 bg-primary-soft/40 gap-2 rounded-xl border p-3">
      <input type="hidden" name="leaveId" value={leaveId} />
      <p className="text-sm font-semibold">
        {finalStep ? (decided ? "Change the final decision" : status === "TEACHER_APPROVED" ? "Class teacher approved — your final decision" : "Your decision (final)") : "Your review"}
      </p>
      <TextField name="comment" label="Comment (optional)" />
      <div className="flex flex-wrap gap-2">
        {status !== "APPROVED" ? (
          <SubmitButton name="decision" value="APPROVE" pendingLabel="Saving…" className="bg-success hover:bg-success/90 bg-none text-white shadow-none">
            <CheckIcon aria-hidden />
            {finalStep ? "Approve (final)" : "Approve & send to school"}
          </SubmitButton>
        ) : null}
        {status !== "REJECTED" ? (
          <SubmitButton name="decision" value="REJECT" pendingLabel="Saving…" className="bg-destructive hover:bg-destructive/90 bg-none text-white shadow-none">
            <XIcon aria-hidden />
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
