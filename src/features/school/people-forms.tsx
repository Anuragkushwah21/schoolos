"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import {
  CheckboxField,
  FieldRow,
  type SelectOption,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/forms/fields";
import { nativeSelectClass } from "@/components/forms/styles";
import { Label } from "@/components/ui/label";

import {
  assignSubjectAction,
  createStudentAction,
  createTeacherAction,
  enrollStudentAction,
  grantParentPortalAction,
  grantStudentPortalAction,
  linkGuardianAction,
  resetPortalPasswordAction,
  updateParentAction,
  updateStudentAction,
  updateTeacherAction,
} from "./people-actions";

const GENDER_OPTIONS: SelectOption[] = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "OTHER", label: "Other" },
];

const RELATIONSHIP_OPTIONS: SelectOption[] = [
  { value: "FATHER", label: "Father" },
  { value: "MOTHER", label: "Mother" },
  { value: "GUARDIAN", label: "Guardian" },
];

const STUDENT_STATUS_OPTIONS: SelectOption[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "TRANSFERRED", label: "Transferred" },
  { value: "GRADUATED", label: "Graduated" },
];

const TEACHER_STATUS_OPTIONS: SelectOption[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "ON_LEAVE", label: "On leave" },
  { value: "INACTIVE", label: "Left the school" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-5 rounded-xl border p-5">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------

type StudentDefaults = {
  studentId?: string;
  firstName?: string;
  lastName?: string;
  gender?: string | null;
  admissionNumber?: string;
  dateOfBirth?: string;
  admissionDate?: string;
  bloodGroup?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  status?: string;
};

function StudentPersonalFields({ d, requireAdmission }: { d: StudentDefaults; requireAdmission?: boolean }) {
  return (
    <>
      <FieldRow>
        <TextField name="firstName" label="First name" defaultValue={d.firstName} required />
        <TextField name="lastName" label="Last name" defaultValue={d.lastName} required />
      </FieldRow>
      <FieldRow>
        <SelectField name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not specified" defaultValue={d.gender ?? ""} />
        <TextField name="dateOfBirth" label="Date of birth" type="date" defaultValue={d.dateOfBirth} />
      </FieldRow>
      <FieldRow>
        <TextField
          name="admissionNumber"
          label="Admission number"
          defaultValue={d.admissionNumber}
          required={requireAdmission}
          hint={requireAdmission ? undefined : "Leave blank to number automatically."}
        />
        <TextField name="admissionDate" label="Admission date" type="date" defaultValue={d.admissionDate} />
      </FieldRow>
      <FieldRow>
        <TextField name="bloodGroup" label="Blood group" placeholder="B+" defaultValue={d.bloodGroup ?? ""} />
        <div />
      </FieldRow>
    </>
  );
}

function StudentContactFields({ d }: { d: StudentDefaults }) {
  return (
    <>
      <TextField name="addressLine" label="Address" defaultValue={d.addressLine ?? ""} autoComplete="street-address" />
      <FieldRow>
        <TextField name="city" label="City" defaultValue={d.city ?? ""} />
        <TextField name="state" label="State" defaultValue={d.state ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="postalCode" label="PIN code" defaultValue={d.postalCode ?? ""} inputMode="numeric" />
        <div />
      </FieldRow>
      <FieldRow>
        <TextField name="emergencyContactName" label="Emergency contact" defaultValue={d.emergencyContactName ?? ""} />
        <TextField name="emergencyContactPhone" label="Emergency phone" type="tel" defaultValue={d.emergencyContactPhone ?? ""} />
      </FieldRow>
    </>
  );
}

/**
 * Attaching a parent to a child.
 *
 * There is no "add later": a child cannot be admitted with nobody responsible
 * for them, and the server refuses it too. The choice that matters is whether
 * this family is already at the school — picking the existing parent is what
 * keeps one guardian with three children as one account rather than three.
 */
function GuardianModeFields({
  parents,
  modes,
}: {
  parents: SelectOption[];
  modes: Array<"existing" | "new">;
}) {
  // Default to the existing parent when there is one to pick: a sibling already
  // at the school is the case that creates duplicates when it is missed.
  const [mode, setMode] = useState<"existing" | "new">(
    modes.includes("existing") && parents.length ? "existing" : "new",
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="guardianMode">Parent or guardian</Label>
        <select
          id="guardianMode"
          name="guardianMode"
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
          className={`${nativeSelectClass} w-full`}
        >
          {modes.includes("existing") && parents.length ? (
            <option value="existing">Existing parent — a sibling is already at this school</option>
          ) : null}
          {modes.includes("new") ? <option value="new">New parent</option> : null}
        </select>
        <p className="text-muted-foreground text-xs">
          Every student needs at least one. Search the existing list first so a family with more
          than one child keeps a single parent account.
        </p>
      </div>

      {mode === "existing" ? (
        <SelectField
          name="existingParentId"
          label="Choose the parent"
          options={parents}
          placeholder="Search by name or phone…"
          hint="Listed with their phone number so two people with the same name can be told apart."
          required
        />
      ) : null}

      {mode === "new" ? (
        <>
          <FieldRow>
            <TextField name="parentFirstName" label="First name" required />
            <TextField name="parentLastName" label="Last name" required />
          </FieldRow>
          <FieldRow>
            <TextField name="parentPhone" label="Mobile" type="tel" required />
            <TextField name="parentEmail" label="Email" type="email" />
          </FieldRow>
        </>
      ) : null}

      <SelectField
        name="relationship"
        label="Relationship to the student"
        options={RELATIONSHIP_OPTIONS}
        defaultValue="FATHER"
        required
      />
    </>
  );
}

export function CreateStudentForm({
  sections,
  parents,
  sessionName,
}: {
  sections: SelectOption[];
  parents: SelectOption[];
  sessionName: string;
}) {
  return (
    <ActionForm action={createStudentAction} className="max-w-3xl">
      <Section title="Student">
        <StudentPersonalFields d={{}} />
      </Section>

      <Section title={`Placement for ${sessionName}`}>
        <FieldRow>
          <SelectField name="sectionId" label="Class and section" options={sections} placeholder="Select…" required />
          <TextField name="rollNumber" label="Roll number" />
        </FieldRow>
      </Section>

      <Section title="Parent">
        <GuardianModeFields parents={parents} modes={["existing", "new"]} />
      </Section>

      <Section title="Address and emergency contact">
        <StudentContactFields d={{}} />
      </Section>

      <div>
        <SubmitButton pendingLabel="Adding…">Add student</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditStudentForm({ student }: { student: StudentDefaults & { studentId: string } }) {
  return (
    <ActionForm action={updateStudentAction} className="max-w-3xl">
      <input type="hidden" name="studentId" value={student.studentId} />
      <Section title="Student">
        <StudentPersonalFields d={student} requireAdmission />
        <SelectField
          name="status"
          label="Status"
          options={STUDENT_STATUS_OPTIONS}
          defaultValue={student.status}
          hint="Anything other than Active also disables the student's login."
          required
        />
      </Section>
      <Section title="Address and emergency contact">
        <StudentContactFields d={student} />
      </Section>
      <div>
        <SubmitButton>Save student</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EnrollmentForm({
  studentId,
  sessions,
  sections,
  defaults,
}: {
  studentId: string;
  sessions: SelectOption[];
  sections: Array<SelectOption & { sessionId: string }>;
  defaults: { sessionId?: string; sectionId?: string; rollNumber?: string | null };
}) {
  const [sessionId, setSessionId] = useState(defaults.sessionId ?? sessions[0]?.value ?? "");
  const options = sections.filter((section) => section.sessionId === sessionId);

  return (
    <ActionForm action={enrollStudentAction} className="gap-4">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="enroll-session">Academic session</Label>
        <select
          id="enroll-session"
          name="academicSessionId"
          value={sessionId}
          onChange={(event) => setSessionId(event.target.value)}
          className={`${nativeSelectClass} w-full`}
        >
          {sessions.map((session) => (
            <option key={session.value} value={session.value}>
              {session.label}
            </option>
          ))}
        </select>
      </div>
      <FieldRow>
        <SelectField
          key={sessionId}
          name="sectionId"
          label="Class and section"
          options={options}
          placeholder={options.length ? "Select…" : "No sections in this session"}
          defaultValue={sessionId === defaults.sessionId ? defaults.sectionId : ""}
          required
        />
        <TextField name="rollNumber" label="Roll number" defaultValue={defaults.rollNumber ?? ""} />
      </FieldRow>
      <p className="text-muted-foreground text-xs">
        Choosing a different session promotes the student and keeps this
        year&apos;s record as history.
      </p>
      <div>
        <SubmitButton variant="outline">Save placement</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function LinkGuardianForm({ studentId, parents }: { studentId: string; parents: SelectOption[] }) {
  return (
    <ActionForm action={linkGuardianAction} resetOnSuccess className="gap-4">
      <input type="hidden" name="studentId" value={studentId} />
      <GuardianModeFields parents={parents} modes={parents.length ? ["new", "existing"] : ["new"]} />
      <CheckboxField name="isPrimary" label="Primary contact" hint="The guardian the school contacts first." />
      <div>
        <SubmitButton variant="outline">Link guardian</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditParentForm({
  parent,
}: {
  parent: { id: string; firstName: string; lastName: string; phone: string; email: string | null; occupation: string | null; addressLine: string | null };
}) {
  return (
    <ActionForm action={updateParentAction} className="gap-4">
      <input type="hidden" name="parentId" value={parent.id} />
      <FieldRow>
        <TextField name="firstName" label="First name" defaultValue={parent.firstName} required />
        <TextField name="lastName" label="Last name" defaultValue={parent.lastName} required />
      </FieldRow>
      <FieldRow>
        <TextField name="phone" label="Phone" type="tel" defaultValue={parent.phone} required />
        <TextField name="email" label="Email" type="email" defaultValue={parent.email ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="occupation" label="Occupation" defaultValue={parent.occupation ?? ""} />
        <TextField name="addressLine" label="Address" defaultValue={parent.addressLine ?? ""} />
      </FieldRow>
      <div>
        <SubmitButton variant="outline" size="sm">Save guardian</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PortalAccessForm({
  kind,
  personId,
  defaultEmail,
}: {
  kind: "student" | "parent";
  personId: string;
  defaultEmail?: string | null;
}) {
  return (
    <ActionForm action={kind === "student" ? grantStudentPortalAction : grantParentPortalAction} className="gap-3">
      <input type="hidden" name="personId" value={personId} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          name="email"
          label="Login email"
          type="email"
          defaultValue={defaultEmail ?? ""}
          className="min-w-56 flex-1"
          required
        />
        <SubmitButton variant="outline" pendingLabel="Creating…">
          Create login
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ResetPortalPasswordForm({ userId }: { userId: string }) {
  return (
    <ActionForm action={resetPortalPasswordAction} className="gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <SubmitButton variant="outline" size="sm" pendingLabel="Issuing…">
          Reset password
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

// -----------------------------------------------------------------------------
// Teachers
// -----------------------------------------------------------------------------

type TeacherDefaults = {
  teacherId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  gender?: string | null;
  employeeId?: string;
  phone?: string | null;
  qualification?: string | null;
  designation?: string | null;
  dateOfBirth?: string;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  joiningDate?: string;
  status?: string;
};

function TeacherFields({ d, requireEmployeeId }: { d: TeacherDefaults; requireEmployeeId?: boolean }) {
  return (
    <>
      <FieldRow>
        <TextField name="firstName" label="First name" defaultValue={d.firstName} required />
        <TextField name="lastName" label="Last name" defaultValue={d.lastName} required />
      </FieldRow>
      <FieldRow>
        <TextField
          name="employeeId"
          label="Employee ID"
          defaultValue={d.employeeId}
          required={requireEmployeeId}
          hint={requireEmployeeId ? undefined : "Leave blank to number automatically."}
        />
        <SelectField name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not specified" defaultValue={d.gender ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="phone" label="Phone" type="tel" defaultValue={d.phone ?? ""} />
        <TextField name="joiningDate" label="Joining date" type="date" defaultValue={d.joiningDate} />
      </FieldRow>
      <FieldRow>
        <TextField name="qualification" label="Qualification" placeholder="M.Sc., B.Ed." defaultValue={d.qualification ?? ""} />
        <TextField
          name="designation"
          label="Designation"
          placeholder="Senior Teacher"
          defaultValue={d.designation ?? ""}
          hint="What the school calls this post."
        />
      </FieldRow>
      <TextField name="dateOfBirth" label="Date of birth" type="date" defaultValue={d.dateOfBirth} />
      <TextField name="addressLine" label="Address" defaultValue={d.addressLine ?? ""} />
      <FieldRow>
        <TextField name="city" label="City" defaultValue={d.city ?? ""} />
        <TextField name="state" label="State" defaultValue={d.state ?? ""} />
      </FieldRow>
      <TextField name="postalCode" label="Postal code" defaultValue={d.postalCode ?? ""} className="max-w-40" />
    </>
  );
}

export function CreateTeacherForm() {
  return (
    <ActionForm action={createTeacherAction} resetOnSuccess className="max-w-3xl">
      <Section title="Teacher">
        <TeacherFields d={{}} />
      </Section>
      <Section title="Sign-in">
        <TextField
          name="email"
          label="Email"
          type="email"
          hint="The teacher signs in with this address. A one-time password is shown after saving."
          required
        />
      </Section>
      <div>
        <SubmitButton pendingLabel="Adding…">Add teacher</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditTeacherForm({ teacher }: { teacher: TeacherDefaults & { teacherId: string } }) {
  return (
    <ActionForm action={updateTeacherAction}>
      <input type="hidden" name="teacherId" value={teacher.teacherId} />
      <TeacherFields d={teacher} requireEmployeeId />
      <TextField
        name="email"
        label="Sign-in email"
        type="email"
        defaultValue={teacher.email}
        hint="Changing this changes the address they sign in with. Their password is unaffected."
        required
      />
      <SelectField
        name="status"
        label="Status"
        options={TEACHER_STATUS_OPTIONS}
        defaultValue={teacher.status}
        hint="A teacher who has left keeps their history but can no longer sign in."
        required
      />
      <div>
        <SubmitButton>Save teacher</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AssignSubjectForm({
  teacherId,
  subjects,
  sections,
}: {
  teacherId: string;
  subjects: SelectOption[];
  sections: SelectOption[];
}) {
  return (
    <ActionForm action={assignSubjectAction} className="gap-3">
      <input type="hidden" name="teacherId" value={teacherId} />
      <FieldRow>
        <SelectField name="subjectId" label="Subject" options={subjects} placeholder="Select…" required />
        <SelectField name="sectionId" label="Section" options={sections} placeholder="Select…" required />
      </FieldRow>
      <div>
        <SubmitButton variant="outline">Assign</SubmitButton>
      </div>
    </ActionForm>
  );
}

