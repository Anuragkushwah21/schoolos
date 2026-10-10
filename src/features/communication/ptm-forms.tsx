"use client";

import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton, TextareaField } from "@/components/forms/fields";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";

import { recordPtmAttendanceAction, respondToPtmAction } from "./meeting-actions";

const RESPONSE = { WILL_ATTEND: { label: "Will attend", tone: "positive" }, UNABLE_TO_ATTEND: { label: "Unable to attend", tone: "warning" } } as const;
const ATTENDANCE = { ATTENDED: { label: "Attended", tone: "positive" }, DID_NOT_ATTEND: { label: "Did not attend", tone: "negative" }, RESCHEDULED: { label: "Rescheduled", tone: "info" } } as const;

type Response = keyof typeof RESPONSE | null;
type Attendance = keyof typeof ATTENDANCE | null;

export function ResponseBadge({ response }: { response: Response }) {
  return response ? <StatusBadge status={response} label={RESPONSE[response].label} tone={RESPONSE[response].tone} /> : <StatusBadge status="NONE" label="Not responded" tone="neutral" />;
}

export function AttendanceBadge({ attendance }: { attendance: Attendance }) {
  return attendance ? <StatusBadge status={attendance} label={ATTENDANCE[attendance].label} tone={ATTENDANCE[attendance].tone} /> : <span className="text-muted-foreground text-xs">Not recorded</span>;
}

/** A parent's optional answer, one line per child the PTM is for. Big buttons, two choices. */
export function PtmResponseButtons({ meetingId, kids }: { meetingId: string; kids: Array<{ studentId: string; name: string; response: Response; canRespond: boolean }> }) {
  return (
    <div className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-3">
      <p className="text-sm font-semibold">Will you come? (optional)</p>
      {kids.map((child) => (
        <div key={child.studentId} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{child.name}</span>
            <ResponseBadge response={child.response} />
          </span>
          {child.canRespond ? (
            <span className="flex gap-2">
              <ActionButton action={respondToPtmAction} fields={{ meetingId, studentId: child.studentId, response: "WILL_ATTEND" }} size="default" variant={child.response === "WILL_ATTEND" ? "default" : "outline"}>
                <CheckIcon aria-hidden /> Will attend
              </ActionButton>
              <ActionButton action={respondToPtmAction} fields={{ meetingId, studentId: child.studentId, response: "UNABLE_TO_ATTEND" }} size="default" variant={child.response === "UNABLE_TO_ATTEND" ? "default" : "outline"}>
                <XIcon aria-hidden /> Unable to attend
              </ActionButton>
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">Answers are closed.</span>
          )}
        </div>
      ))}
    </div>
  );
}

type Family = { studentId: string; name: string; admissionNumber: string; rollNumber: string | null; parents: string; response: Response; attendance: Attendance; remarks: string | null; followUp: string | null };

/** Staff: one class's families — the parent's answer, and (after the meeting starts) what happened. */
export function PtmSectionList({ meetingId, label, families, canRecord }: { meetingId: string; label: string; families: Family[]; canRecord: boolean }) {
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <h3 className="text-base font-semibold">{`${label} · ${families.length} famil${families.length === 1 ? "y" : "ies"}`}</h3>
      <ul className="bg-card divide-y rounded-2xl border">
        {families.map((family) => (
          <FamilyRow key={family.studentId} meetingId={meetingId} family={family} canRecord={canRecord} />
        ))}
      </ul>
    </section>
  );
}

function FamilyRow({ meetingId, family, canRecord }: { meetingId: string; family: Family; canRecord: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">{`${family.rollNumber ? `${family.rollNumber}. ` : ""}${family.name}`}</p>
          <p className="text-muted-foreground text-xs">{`${family.admissionNumber} · ${family.parents}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Parent said:</span>
          <ResponseBadge response={family.response} />
          <span className="text-muted-foreground text-xs">Meeting:</span>
          <AttendanceBadge attendance={family.attendance} />
          {canRecord ? (
            <button type="button" onClick={() => setOpen((value) => !value)} className={cn("text-primary text-sm font-medium underline", open && "font-semibold")} aria-expanded={open}>
              {family.attendance ? "Change" : "Record"}
            </button>
          ) : null}
        </div>
      </div>
      {family.remarks || family.followUp ? (
        <p className="text-muted-foreground text-xs">{[family.remarks ? `Remarks: ${family.remarks}` : null, family.followUp ? `Follow-up: ${family.followUp}` : null].filter(Boolean).join(" · ")}</p>
      ) : null}
      {open && canRecord ? (
        <ActionForm action={recordPtmAttendanceAction} className="bg-muted/30 gap-3 rounded-xl border p-3">
          <input type="hidden" name="meetingId" value={meetingId} />
          <input type="hidden" name="studentId" value={family.studentId} />
          <SelectField
            name="attendance"
            label="What happened?"
            defaultValue={family.attendance ?? "ATTENDED"}
            options={[
              { value: "ATTENDED", label: "Attended" },
              { value: "DID_NOT_ATTEND", label: "Did not attend" },
              { value: "RESCHEDULED", label: "Rescheduled" },
            ]}
            required
          />
          <TextareaField name="remarks" label="Meeting remarks (staff only — not shown to the family)" rows={2} defaultValue={family.remarks ?? ""} />
          <TextareaField name="followUp" label="Follow-up (optional)" rows={2} defaultValue={family.followUp ?? ""} placeholder="e.g. Call again after the unit test" />
          <div>
            <SubmitButton size="sm" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </div>
        </ActionForm>
      ) : null}
    </li>
  );
}
