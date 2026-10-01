"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { FormSteps } from "@/components/forms/form-steps";
import { useT } from "@/components/i18n/i18n-provider";
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
import { today, toDateInput } from "@/lib/dates";

import { type SectionSeats, StreamSeatPicker } from "./stream-seat-picker";

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

function StudentPersonalFields({ d, requireAdmission, autoNumber }: { d: StudentDefaults; requireAdmission?: boolean; autoNumber?: boolean }) {
  return (
    <>
      <FieldRow>
        <TextField name="firstName" label="First name" defaultValue={d.firstName} required />
        <TextField name="lastName" label="Last name" defaultValue={d.lastName} required />
      </FieldRow>
      <FieldRow>
        <SelectField name="gender" label="Gender" options={GENDER_OPTIONS} placeholder="Not specified" defaultValue={d.gender ?? ""} />
        <TextField name="dateOfBirth" label="Date of birth" type="date" defaultValue={d.dateOfBirth} max={toDateInput(today())} />
      </FieldRow>
      <FieldRow>
        {autoNumber ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Admission number</span>
            <span className="bg-muted/50 rounded-md border px-3 py-2 text-sm">Auto-generated</span>
            <span className="text-muted-foreground text-xs">Given when you save — ADM-{new Date().getFullYear()}-00001 style, never reused.</span>
          </div>
        ) : (
          <TextField
            name="admissionNumber"
            label="Admission number"
            defaultValue={d.admissionNumber}
            required={requireAdmission}
            hint={requireAdmission ? undefined : "Leave blank to number automatically."}
          />
        )}
        <TextField name="admissionDate" label="Admission date" type="date" defaultValue={d.admissionDate ?? toDateInput(today())} />
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
  admission = false,
}: {
  parents: SelectOption[];
  modes: Array<"existing" | "new">;
  /** On the admission form: address, and the "different person" confirmation. */
  admission?: boolean;
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
            <TextField
              name="parentEmail"
              label="Email"
              type="email"
              hint={admission ? "With an email, the parent gets an activation link to choose their own password." : undefined}
            />
          </FieldRow>
          {admission ? (
            <>
              <TextField name="parentAddress" label="Address" autoComplete="street-address" />
              <CheckboxField
                name="confirmNewParent"
                label="This is a different person"
                hint="Tick only if we warn that this mobile or email already belongs to a parent here, and it really is someone else."
              />
            </>
          ) : null}
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

/**
 * Adding a student, one step at a time: who they are, where they sit, who
 * their parent is, and (optionally) address and emergency contact. One form
 * and one save underneath — the steps only decide what is on screen.
 */
/** The student's own login: Class 6 to 12 only. */
function StudentAccountFields() {
  const [login, setLogin] = useState(false);
  return (
    <>
      <FieldRow>
        <TextField name="studentEmail" label="Student email" type="email" hint="Optional." />
        <TextField name="studentPhone" label="Student mobile" type="tel" hint="Optional." />
      </FieldRow>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="studentLogin" checked={login} onChange={(event) => setLogin(event.target.checked)} className="accent-primary mt-0.5 size-4" />
        <span>
          Give the student their own login
          <span className="text-muted-foreground block text-xs">
            An activation link goes to the student&apos;s email, so an email is needed. Without a login the student is still fully admitted.
          </span>
        </span>
      </label>
    </>
  );
}

/**
 * Adding a student, one step at a time: who they are, where they sit, who
 * their parent is, (Class 6–12 only) the student's own account, and address.
 * One form and one save underneath — the steps only decide what is on screen.
 * The server applies the same class rules whatever is sent.
 */
export function CreateStudentForm({
  sections,
  parents,
  sessionName,
  seats = {},
}: {
  sections: Array<SelectOption & { level: number }>;
  parents: SelectOption[];
  sessionName: string;
  /** Each section's stream shares and free seats. */
  seats?: Record<string, SectionSeats>;
}) {
  const t = useT();
  const [sectionId, setSectionId] = useState("");
  const level = sections.find((section) => section.value === sectionId)?.level ?? null;
  const senior = level !== null && level >= 6;
  return (
    <ActionForm action={createStudentAction} className="max-w-3xl">
      <FormSteps
        steps={[
          { title: t("studentForm.stepStudent"), content: <StudentPersonalFields d={{}} autoNumber /> },
          {
            title: t("studentForm.stepClass"),
            description: sessionName,
            content: (
              <>
                <FieldRow>
                  <SelectField
                    name="sectionId"
                    label="Class and section"
                    options={sections}
                    placeholder="Select…"
                    value={sectionId}
                    onChange={(event) => setSectionId(event.target.value)}
                    required
                  />
                  <TextField name="rollNumber" label="Roll number" />
                </FieldRow>
                <StreamSeatPicker key={sectionId} seats={seats[sectionId]} />
              </>
            ),
          },
          { title: t("studentForm.stepParent"), content: <GuardianModeFields parents={parents} modes={["existing", "new"]} admission /> },
          // Nursery to Class 5 have no student account: the step is not there at all.
          ...(senior
            ? [
                {
                  title: "Student account",
                  description: `${t("common.optional")} · Class 6–12`,
                  content: <StudentAccountFields />,
                },
              ]
            : []),
          {
            title: t("studentForm.stepContact"),
            description: t("common.optional"),
            content: <StudentContactFields d={{}} />,
          },
        ]}
        submit={
          <SubmitButton size="lg" pendingLabel={t("studentForm.adding")}>
            {t("studentForm.submit")}
          </SubmitButton>
        }
      />
    </ActionForm>
  );
}

export function EditStudentForm({
  student,
  email,
}: {
  student: StudentDefaults & { studentId: string };
  /** Class 6–12 only: the student's email (their sign-in address when they have a login). */
  email?: { value: string | null; hasLogin: boolean } | null;
}) {
  return (
    <ActionForm action={updateStudentAction} className="max-w-3xl">
      <input type="hidden" name="studentId" value={student.studentId} />
      <Section title="Student">
        <StudentPersonalFields d={student} requireAdmission />
        {email ? (
          <TextField
            name="email"
            label={email.hasLogin ? "Student email (sign-in)" : "Student email"}
            type="email"
            defaultValue={email.value ?? ""}
            required={email.hasLogin}
            hint={email.hasLogin ? "Correcting it moves the student's sign-in to the new address. Links sent to the old one stop working." : "Optional."}
          />
        ) : null}
        {/* Status is changed from the profile's "Change status", which records the date and reason. */}
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
  seats = {},
}: {
  studentId: string;
  sessions: SelectOption[];
  sections: Array<SelectOption & { sessionId: string }>;
  defaults: { sessionId?: string; sectionId?: string; streamId?: string | null; rollNumber?: string | null };
  /** Each section's stream shares and free seats. */
  seats?: Record<string, SectionSeats>;
}) {
  const [sessionId, setSessionId] = useState(defaults.sessionId ?? sessions[0]?.value ?? "");
  const options = sections.filter((section) => section.sessionId === sessionId);
  const [sectionId, setSectionId] = useState(defaults.sectionId ?? "");

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
          onChange={(event) => setSectionId(event.target.value)}
          required
        />
        <TextField name="rollNumber" label="Roll number" defaultValue={defaults.rollNumber ?? ""} />
      </FieldRow>
      <StreamSeatPicker key={`${sessionId}|${sectionId}`} seats={seats[sectionId]} defaultValue={defaults.streamId} />
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
  parent: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    occupation: string | null;
    addressLine: string | null;
    /** Given only where the School Admin should see and edit it. */
    idProof?: { type: string | null; number: string | null };
  };
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
      {parent.idProof ? (
        <>
          <input type="hidden" name="withIdProof" value="on" />
          <FieldRow>
            <TextField name="idProofType" label="ID proof type" placeholder="Aadhaar, PAN, Passport…" defaultValue={parent.idProof.type ?? ""} />
            <TextField name="idProofNumber" label="ID proof number" defaultValue={parent.idProof.number ?? ""} hint="Seen only by the School Admin." />
          </FieldRow>
        </>
      ) : null}
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

/**
 * "Send login email": a new activation link while the account waits to be
 * activated, a password-reset link once it is active. The office never sees
 * or sets a password.
 */
export function ResetPortalPasswordForm({ userId, pending = false }: { userId: string; pending?: boolean }) {
  return (
    <ActionForm action={resetPortalPasswordAction} className="gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <SubmitButton variant="outline" size="sm" pendingLabel="Sending…">
          {pending ? "Resend activation" : "Send password reset email"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The latest activation email for a pending login (see `activationEmailStatuses`). */
export type ActivationEmail = { at: Date | string; status: "SENT" | "FAILED" | null; error: string | null; expired: boolean } | null | undefined;

/** Where a login stands, in words: activation pending, active, or switched off — and, while pending, whether the email went. */
export function LoginStatus({
  user,
  invite,
}: {
  user: { email: string; isActive: boolean; activatedAt: Date | string | null; lastLoginAt: Date | string | null };
  invite?: ActivationEmail;
}) {
  const state = !user.isActive ? "off" : user.activatedAt ? "active" : "pending";
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="break-all">{user.email}</span>
        <span
          className={
            state === "active"
              ? "bg-success-soft text-success-strong rounded-full px-2 py-0.5 text-xs"
              : state === "pending"
                ? "bg-warning-soft text-warning-strong rounded-full px-2 py-0.5 text-xs"
                : "bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
          }
        >
          {state === "active" ? "Active" : state === "pending" ? "Pending activation" : "Login off"}
        </span>
      </p>
      {state === "pending" ? <ActivationEmailNote invite={invite} /> : null}
    </div>
  );
}

/** "Activation email: Sent ✓ 30 Sep" — or failed, and why, so the office knows to resend. */
export function ActivationEmailNote({ invite }: { invite?: ActivationEmail }) {
  if (!invite) return <p className="text-muted-foreground text-xs">Activation email: not sent yet.</p>;
  const when = new Date(invite.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  if (invite.status === "FAILED") {
    return (
      <p className="bg-danger-soft text-danger-strong rounded-lg px-2.5 py-1.5 text-xs" role="status">
        <span className="font-semibold">Activation email: failed</span> ({when}){invite.error ? ` — ${invite.error}` : ""}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-xs">
      Activation email: {invite.status === "SENT" ? <span className="text-success-strong font-medium">sent ✓</span> : "queued"} ({when})
      {invite.expired ? " — the link has expired; resend it." : ""}
    </p>
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
      <TeacherBasicFields d={d} requireEmployeeId={requireEmployeeId} />
      <TeacherMoreFields d={d} />
    </>
  );
}

function TeacherBasicFields({ d, requireEmployeeId }: { d: TeacherDefaults; requireEmployeeId?: boolean }) {
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
    </>
  );
}

function TeacherMoreFields({ d }: { d: TeacherDefaults }) {
  return (
    <>
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
      <TextField name="dateOfBirth" label="Date of birth" type="date" defaultValue={d.dateOfBirth} max={toDateInput(today())} />
      <TextField name="addressLine" label="Address" defaultValue={d.addressLine ?? ""} />
      <FieldRow>
        <TextField name="city" label="City" defaultValue={d.city ?? ""} />
        <TextField name="state" label="State" defaultValue={d.state ?? ""} />
      </FieldRow>
      <TextField name="postalCode" label="Postal code" defaultValue={d.postalCode ?? ""} className="max-w-40" />
    </>
  );
}

/**
 * Adding a teacher in three short steps. Classes and subjects are assigned on
 * the teacher's own page once they exist, where the choices can be checked
 * against the timetable.
 */
export function CreateTeacherForm() {
  const t = useT();
  return (
    <ActionForm action={createTeacherAction} resetOnSuccess className="max-w-3xl">
      <FormSteps
        steps={[
          { title: t("teacherForm.stepBasic"), content: <TeacherBasicFields d={{}} /> },
          { title: t("teacherForm.stepMore"), description: t("common.optional"), content: <TeacherMoreFields d={{}} /> },
          {
            title: t("teacherForm.stepLogin"),
            description: t("teacherForm.classesHint"),
            content: (
              <TextField
                name="email"
                label="Email"
                type="email"
                hint="The teacher signs in with this address. A one-time password is shown after saving."
                required
              />
            ),
          },
        ]}
        submit={
          <SubmitButton size="lg" pendingLabel={t("teacherForm.adding")}>
            {t("teacherForm.submit")}
          </SubmitButton>
        }
      />
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
      {/* Status is changed from the profile's "Change status", which records the date and reason. */}
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
  streamsBySection = {},
}: {
  teacherId: string;
  subjects: SelectOption[];
  sections: SelectOption[];
  /** Streams / groups each section shares its seats with. */
  streamsBySection?: Record<string, SelectOption[]>;
}) {
  const [sectionId, setSectionId] = useState("");
  const streams = streamsBySection[sectionId] ?? [];
  return (
    <ActionForm action={assignSubjectAction} className="gap-3">
      <input type="hidden" name="teacherId" value={teacherId} />
      <FieldRow>
        <SelectField name="subjectId" label="Subject" options={subjects} placeholder="Select…" required />
        <SelectField
          name="sectionId"
          label="Class / section"
          options={sections}
          placeholder="Select…"
          value={sectionId}
          onChange={(event) => setSectionId(event.target.value)}
          required
        />
      </FieldRow>
      {streams.length ? (
        <SelectField
          key={sectionId}
          name="streamId"
          label="Stream / Group"
          options={streams}
          placeholder="Whole section (all streams)"
          hint="Choose a stream when this subject is taught to that group only."
        />
      ) : null}
      <div>
        <SubmitButton variant="outline">Assign</SubmitButton>
      </div>
    </ActionForm>
  );
}

