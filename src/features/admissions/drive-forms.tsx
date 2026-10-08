"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, PhoneField, type SelectOption, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMISSION_TASKS, DRIVE_STATUS_LABEL, type DriveStatus } from "@/lib/admission-drives";

import {
  addAdmissionDocumentAction,
  createDriveApplicationAction,
  extendAssignmentAction,
  reassignApplicationsAction,
  reviewDriveApplicationAction,
  saveAssignmentAction,
  saveDriveAction,
  updateDriveApplicationAction,
} from "./drive-actions";

const STATUS_OPTIONS = (Object.keys(DRIVE_STATUS_LABEL) as DriveStatus[]).map((value) => ({ value, label: DRIVE_STATUS_LABEL[value] }));

export function DriveForm({
  sessions,
  drive,
}: {
  sessions: SelectOption[];
  drive?: { id: string; academicSessionId: string; name: string; startDate: string; endDate: string; status: DriveStatus; notes: string | null };
}) {
  return (
    <ActionForm action={saveDriveAction} className="gap-4">
      {drive ? <input type="hidden" name="driveId" value={drive.id} /> : null}
      <FieldRow>
        <TextField name="name" label="Name" defaultValue={drive?.name} placeholder="Admissions 2027–28" required />
        <SelectField name="academicSessionId" label="Academic session" options={sessions} defaultValue={drive?.academicSessionId ?? sessions[0]?.value} required />
      </FieldRow>
      <FieldRow>
        <TextField name="startDate" type="date" label="Start date" defaultValue={drive?.startDate} required />
        <TextField name="endDate" type="date" label="End date" defaultValue={drive?.endDate} required />
        <SelectField
          name="status"
          label="Status"
          options={STATUS_OPTIONS}
          defaultValue={drive?.status ?? "SCHEDULED"}
          hint="Scheduled and Active both follow the dates. Paused, Closed and Cancelled stop all teacher work."
        />
      </FieldRow>
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={drive?.notes ?? undefined} />
      <div>
        <SubmitButton>{drive ? "Save drive" : "Create drive"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export type ClassOption = { id: string; name: string; sections: Array<{ id: string; name: string }> };

export function AssignmentForm({
  driveId,
  classes,
  teachers,
  defaults,
  assignment,
}: {
  driveId: string;
  classes: ClassOption[];
  teachers: SelectOption[];
  /** The drive's dates, prefilled for a new assignment. */
  defaults: { startDate: string; endDate: string };
  assignment?: { id: string; classId: string; sectionId: string | null; teacherId: string; startDate: string; endDate: string; capacity: number; permissions: string[] };
}) {
  const [classId, setClassId] = useState(assignment?.classId ?? "");
  const sections = classes.find((row) => row.id === classId)?.sections ?? [];
  return (
    <ActionForm action={saveAssignmentAction} className="gap-4" resetOnSuccess={!assignment}>
      <input type="hidden" name="driveId" value={driveId} />
      {assignment ? <input type="hidden" name="assignmentId" value={assignment.id} /> : null}
      <FieldRow>
        <SelectField
          name="classId"
          label="Class"
          options={classes.map((row) => ({ value: row.id, label: row.name }))}
          value={classId}
          onChange={(event) => setClassId(event.target.value)}
          placeholder="Choose…"
          required
        />
        <SelectField
          key={classId}
          name="sectionId"
          label="Section"
          options={sections.map((row) => ({ value: row.id, label: row.name }))}
          defaultValue={assignment?.classId === classId ? (assignment.sectionId ?? "") : ""}
          placeholder="Whole class"
        />
        <SelectField name="teacherId" label="Teacher" options={teachers} defaultValue={assignment?.teacherId ?? ""} placeholder="Choose…" required />
      </FieldRow>
      <FieldRow>
        <TextField name="startDate" type="date" label="Teacher's start date" defaultValue={assignment?.startDate ?? defaults.startDate} required />
        <TextField name="endDate" type="date" label="Teacher's end date" defaultValue={assignment?.endDate ?? defaults.endDate} required hint="After this date the teacher can no longer add or change applications." />
        <TextField name="capacity" type="number" min={1} max={2000} label="Admission capacity" defaultValue={assignment?.capacity ?? 40} required />
      </FieldRow>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">The teacher may</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ADMISSION_TASKS.map((task) => (
            <label key={task.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="permissions" value={task.key} defaultChecked={assignment ? assignment.permissions.includes(task.key) : true} className="accent-primary size-4" />
              {task.label}
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">Approving, rejecting and admitting always stay with the School Admin.</p>
      </fieldset>
      <div>
        <SubmitButton>{assignment ? "Save changes" : "Assign teacher"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ExtendAssignmentForm({ assignmentId, endDate, max }: { assignmentId: string; endDate: string; max: string }) {
  return (
    <ActionForm action={extendAssignmentAction} className="flex-row flex-wrap items-end gap-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <TextField name="endDate" type="date" label="Extend to" min={endDate} max={max} required className="w-44" />
      <SubmitButton variant="outline">Extend</SubmitButton>
    </ActionForm>
  );
}

export function ReassignForm({ assignments }: { assignments: Array<{ id: string; label: string; classId: string; pending: number; removed: boolean }> }) {
  const [from, setFrom] = useState("");
  const source = assignments.find((row) => row.id === from);
  const targets = assignments.filter((row) => row.id !== from && !row.removed && (!source || row.classId === source.classId));
  return (
    <ActionForm action={reassignApplicationsAction} className="gap-4">
      <FieldRow>
        <SelectField
          name="fromAssignmentId"
          label="Move pending applications from"
          options={assignments.filter((row) => row.pending > 0).map((row) => ({ value: row.id, label: `${row.label} · ${row.pending} pending` }))}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          placeholder="Choose…"
          required
        />
        <SelectField key={from} name="toAssignmentId" label="To" options={targets.map((row) => ({ value: row.id, label: row.label }))} placeholder="Choose…" required hint="Same class, same drive." />
      </FieldRow>
      <div>
        <SubmitButton variant="outline">Move applications</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DriveDecisionForm({ applicationId }: { applicationId: string }) {
  return (
    <ActionForm action={reviewDriveApplicationAction} className="gap-3" resetOnSuccess>
      <input type="hidden" name="applicationId" value={applicationId} />
      <SelectField
        name="decision"
        label="Decision"
        options={[
          { value: "APPROVE", label: "Approve and admit" },
          { value: "REQUEST_CORRECTION", label: "Send back for correction" },
          { value: "REJECT", label: "Reject" },
        ]}
        placeholder="Choose…"
        required
      />
      <TextareaField name="note" label="Note" rows={2} hint="Needed when sending back or rejecting. The teacher sees it." />
      <div>
        <SubmitButton>Save decision</SubmitButton>
      </div>
    </ActionForm>
  );
}

export type DriveApplicationValues = {
  studentFirstName: string;
  studentLastName: string;
  dateOfBirth: string;
  gender: string;
  previousSchool: string;
  requestedStreamId: string;
  parentName: string;
  parentRelationship: string;
  parentPhone: string;
  parentEmail: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  notes: string;
};

export function DriveApplicationForm({
  assignmentId,
  applicationId,
  values,
  streams,
}: {
  /** New application on this assignment … */
  assignmentId?: string;
  /** … or changes to this one. */
  applicationId?: string;
  values?: Partial<DriveApplicationValues>;
  /** Offered for Class 9–12 only; empty hides the field. */
  streams: SelectOption[];
}) {
  return (
    <ActionForm action={applicationId ? updateDriveApplicationAction : createDriveApplicationAction} className="gap-4">
      {assignmentId ? <input type="hidden" name="assignmentId" value={assignmentId} /> : null}
      {applicationId ? <input type="hidden" name="applicationId" value={applicationId} /> : null}
      <h3 className="text-sm font-semibold">Child</h3>
      <FieldRow>
        <TextField name="studentFirstName" label="First name" defaultValue={values?.studentFirstName} required />
        <TextField name="studentLastName" label="Last name" defaultValue={values?.studentLastName} required />
      </FieldRow>
      <FieldRow>
        <TextField name="dateOfBirth" type="date" label="Date of birth" defaultValue={values?.dateOfBirth} />
        <SelectField
          name="gender"
          label="Gender"
          options={[
            { value: "MALE", label: "Male" },
            { value: "FEMALE", label: "Female" },
            { value: "OTHER", label: "Other" },
          ]}
          defaultValue={values?.gender ?? ""}
          placeholder="—"
        />
        {streams.length ? <SelectField name="requestedStreamId" label="Stream" options={streams} defaultValue={values?.requestedStreamId ?? ""} placeholder="—" /> : null}
      </FieldRow>
      <TextField name="previousSchool" label="Previous school" defaultValue={values?.previousSchool} />
      <h3 className="mt-2 text-sm font-semibold">Parent or guardian</h3>
      <FieldRow>
        <TextField name="parentName" label="Name" defaultValue={values?.parentName} required />
        <SelectField
          name="parentRelationship"
          label="Relationship"
          options={[
            { value: "FATHER", label: "Father" },
            { value: "MOTHER", label: "Mother" },
            { value: "GUARDIAN", label: "Guardian" },
          ]}
          defaultValue={values?.parentRelationship ?? "GUARDIAN"}
        />
      </FieldRow>
      <FieldRow>
        <PhoneField name="parentPhone" label="Mobile" defaultValue={values?.parentPhone} required />
        <TextField name="parentEmail" type="email" label="Email" defaultValue={values?.parentEmail} />
      </FieldRow>
      <TextField name="addressLine" label="Address" defaultValue={values?.addressLine} />
      <FieldRow>
        <TextField name="city" label="City" defaultValue={values?.city} />
        <TextField name="state" label="State" defaultValue={values?.state} />
        <TextField name="postalCode" label="PIN code" defaultValue={values?.postalCode} />
      </FieldRow>
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={values?.notes} />
      <div>
        <SubmitButton>{applicationId ? "Save changes" : "Save as draft"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AdmissionDocumentForm({ applicationId }: { applicationId: string }) {
  return (
    <ActionForm action={addAdmissionDocumentAction} className="gap-3" resetOnSuccess>
      <input type="hidden" name="applicationId" value={applicationId} />
      <FieldRow>
        <TextField name="label" label="Document" placeholder="Birth certificate" required />
        <div className="flex flex-col gap-2">
          <Label htmlFor="admission-document-file">PDF file (up to 10 MB)</Label>
          <Input id="admission-document-file" type="file" name="file" accept="application/pdf,.pdf" required />
        </div>
      </FieldRow>
      <div>
        <SubmitButton variant="outline" pendingLabel="Uploading…">
          Upload
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
