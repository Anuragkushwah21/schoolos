"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, FileTextIcon, ShieldCheckIcon, UserIcon } from "lucide-react";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type BaseStaffRole, STAFF_GRANTS, STAFF_MODULES, STAFF_MODULE_LABEL, STAFF_ROLE_WORKSPACE, staffRoleMayHold } from "@/lib/staff-access";
import { cn } from "@/lib/utils";

import { createStaffProfileAction } from "./profile-actions";

export type WizardRole = { id: string; name: string; baseRole: string; defaultGrants: string[]; category: "TEACHING" | "NON_TEACHING" };

const STEPS = [
  { title: "Personal & employment", icon: UserIcon },
  { title: "Role & responsibilities", icon: ShieldCheckIcon },
  { title: "Documents", icon: FileTextIcon },
  { title: "Review & create", icon: CheckIcon },
] as const;

/** Which step a server-side field error belongs to, so the wizard can open it. */
const STEP_OF_FIELD = (field: string): number => (field === "roleProfileId" || field === "grants" ? 1 : field.startsWith("doc.") ? 2 : 0);

const DOC_TYPES = [
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "PAN", label: "PAN" },
  { value: "QUALIFICATION", label: "Qualification certificate" },
  { value: "EXPERIENCE", label: "Experience certificate" },
  { value: "PREVIOUS_EMPLOYMENT", label: "Previous employment certificate" },
  { value: "APPOINTMENT_LETTER", label: "Appointment letter" },
  { value: "JOINING", label: "Joining document" },
  { value: "OTHER", label: "Other document" },
];

/** Opens the step holding the first field the server refused. */
function ErrorJumper({ onStep }: { onStep: (step: number) => void }) {
  const { fieldErrors } = useFormContext();
  useEffect(() => {
    const first = fieldErrors ? Object.keys(fieldErrors).find((key) => key !== "_form") : undefined;
    if (first) onStep(STEP_OF_FIELD(first));
  }, [fieldErrors, onStep]);
  return null;
}

/**
 * The staff creation wizard: personal & employment details, role with its
 * default permissions (adjustable before saving), optional documents, and a
 * review. One form, one submission: the server creates everything in a
 * single transaction and checks every field again.
 */
export function StaffWizard({ roles, initialCategory = "NON_TEACHING", initialRoleId }: { roles: WizardRole[]; initialCategory?: "TEACHING" | "NON_TEACHING"; initialRoleId?: string }) {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState(initialCategory);
  const [roleId, setRoleId] = useState(initialRoleId ?? "");
  const role = roles.find((row) => row.id === roleId);
  const [granted, setGranted] = useState<string[]>(() => (role ? role.defaultGrants.filter((key) => staffRoleMayHold(role.baseRole, key)) : []));
  const [docRows, setDocRows] = useState<number[]>([0]);
  const [review, setReview] = useState<Array<[string, string]>>([]);
  const [createLogin, setCreateLogin] = useState(true);
  const anchor = useRef<HTMLDivElement>(null);

  const chooseRole = (id: string) => {
    setRoleId(id);
    const next = roles.find((row) => row.id === id);
    setGranted(next ? next.defaultGrants.filter((key) => staffRoleMayHold(next.baseRole, key)) : []);
  };
  const toggle = (key: string) => setGranted((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));

  /** The browser's own checks on the visible step before moving on. */
  const go = (next: number) => {
    const form = anchor.current?.closest("form");
    if (next > step && form) {
      const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-step="${step}"] input, [data-step="${step}"] select, [data-step="${step}"] textarea`);
      for (const field of fields) if (!field.checkValidity()) return void field.reportValidity();
    }
    if (next === 3 && form) {
      const data = new FormData(form);
      const value = (key: string) => String(data.get(key) ?? "").trim();
      const docs = docRows.filter((index) => (data.get(`doc.${index}.file`) as File | null)?.size).length;
      setReview([
        ["Name", value("fullName")],
        ["Category", category === "TEACHING" ? "Teaching" : "Non-teaching"],
        ["Role", role?.name ?? "—"],
        ["Job title", value("designation") || "—"],
        ["Email", value("email") || "—"],
        ["Mobile", value("phone") || "—"],
        ["Joining date", value("joiningDate") || "—"],
        ["Monthly salary", value("salaryMinor") ? `₹${value("salaryMinor")}` : "—"],
        ["Permissions", `${granted.length} (${role ? role.defaultGrants.length : 0} role defaults)`],
        ["Documents", String(docs)],
        ["Login", createLogin ? `Activation email to ${value("email") || "—"}` : "No login for now"],
      ]);
    }
    setStep(next);
  };

  const visibleRoles = roles.filter((row) => row.category === category);
  const defaults = role ? role.defaultGrants : [];

  return (
    <ActionForm action={createStaffProfileAction} className="max-w-4xl gap-6">
      <div ref={anchor} />
      <ErrorJumper onStep={setStep} />
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((item, index) => (
          <li key={item.title}>
            <button
              type="button"
              onClick={() => (index < step ? setStep(index) : undefined)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
                index === step ? "border-primary bg-primary text-primary-foreground" : index < step ? "border-success/40 bg-success-soft text-success-strong" : "text-muted-foreground",
              )}
              aria-current={index === step ? "step" : undefined}
            >
              <item.icon className="size-4" aria-hidden />
              {index + 1}. {item.title}
            </button>
          </li>
        ))}
      </ol>

      {/* Step 1 */}
      <section data-step="0" hidden={step !== 0} className="flex flex-col gap-4">
        <fieldset className="flex flex-wrap gap-3">
          <legend className="mb-2 text-sm font-medium">Staff category</legend>
          {(["TEACHING", "NON_TEACHING"] as const).map((value) => (
            <label key={value} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", category === value && "border-primary bg-primary-soft")}>
              <input type="radio" name="_category" value={value} checked={category === value} onChange={() => (setCategory(value), chooseRole(""))} className="accent-primary" />
              {value === "TEACHING" ? "Teaching" : "Non-teaching"}
            </label>
          ))}
        </fieldset>
        {category === "TEACHING" ? (
          <p className="bg-muted/50 rounded-lg p-3 text-sm">
            Teachers are added with the teacher form, where their subjects and classes are set:{" "}
            <Link href="/school-admin/teachers/new" className="text-primary font-medium underline-offset-4 hover:underline">
              Add a teacher
            </Link>
            . Use this wizard for an academic coordinator.
          </p>
        ) : null}
        <FieldRow>
          <TextField name="fullName" label="Full name" required />
          <TextField name="designation" label="Job title" placeholder="Senior accountant" />
        </FieldRow>
        <FieldRow>
          <TextField name="email" type="email" label="Email" hint="Needed for their login." required={createLogin} />
          <PhoneField name="phone" label="Mobile" />
        </FieldRow>
        <FieldRow>
          <TextField name="dateOfBirth" type="date" label="Date of birth" />
          <SelectField
            name="gender"
            label="Gender"
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
              { value: "OTHER", label: "Other" },
            ]}
            placeholder="—"
          />
        </FieldRow>
        <TextField name="addressLine" label="Address" />
        <FieldRow>
          <TextField name="city" label="City" />
          <TextField name="state" label="State" />
          <TextField name="postalCode" label="PIN code" />
        </FieldRow>
        <FieldRow>
          <TextField name="joiningDate" type="date" label="Joining date" />
          <SelectField
            name="employmentType"
            label="Employment type"
            options={[
              { value: "FULL_TIME", label: "Full time" },
              { value: "PART_TIME", label: "Part time" },
              { value: "CONTRACT", label: "Contract" },
              { value: "TEMPORARY", label: "Temporary" },
              { value: "VOLUNTEER", label: "Volunteer" },
            ]}
            placeholder="—"
          />
          <TextField name="experienceYears" type="number" min={0} max={60} label="Experience (years)" />
        </FieldRow>
        <FieldRow>
          <TextField name="salaryMinor" label="Monthly salary (₹)" inputMode="decimal" hint="Optional. Becomes their salary structure; payroll picks it up." />
          <TextField name="employeeId" label="Employee ID" hint="Blank to number it automatically (STF-0001…)." />
          <TextField name="department" label="Department" />
        </FieldRow>
        <FieldRow>
          <TextField name="emergencyContactName" label="Emergency contact" />
          <PhoneField name="emergencyContactPhone" label="Emergency contact mobile" />
        </FieldRow>
        <div className="flex flex-col gap-2">
          <Label htmlFor="staff-photo">Profile photo</Label>
          <Input id="staff-photo" type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="max-w-sm" />
        </div>
        <TextareaField name="notes" label="Notes" rows={2} />
      </section>

      {/* Step 2 */}
      <section data-step="1" hidden={step !== 1} className="flex flex-col gap-4">
        <SelectField
          name="roleProfileId"
          label="Role"
          options={visibleRoles.map((row) => ({ value: row.id, label: row.name }))}
          value={roleId}
          onChange={(event) => chooseRole(event.target.value)}
          placeholder={visibleRoles.length ? "Choose a role" : "No roles in this category"}
          hint={
            role
              ? `Workspace: ${STAFF_ROLE_WORKSPACE[role.baseRole as BaseStaffRole] ?? "As assigned"}. Its default responsibilities are ticked below; change them as you like — the School Admin keeps full access either way.`
              : "Its default responsibilities are ticked below. Change them as you like — the School Admin keeps full access either way."
          }
          required
        />
        {role ? (
          <>
            <p className="text-muted-foreground text-sm">
              {granted.length} {granted.length === 1 ? "responsibility" : "responsibilities"} · {role.defaultGrants.length} are this role&apos;s defaults ·{" "}
              {granted.filter((key) => !defaults.includes(key)).length} added · {defaults.filter((key) => !granted.includes(key)).length} removed
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {STAFF_MODULES.map((module) => {
                const items = STAFF_GRANTS.filter((grant) => grant.module === module);
                return (
                  <fieldset key={module} className="rounded-lg border p-3">
                    <legend className="px-1 text-sm font-medium">{STAFF_MODULE_LABEL[module]}</legend>
                    <ul className="flex flex-col gap-2">
                      {items.map((grant) => {
                        const allowed = staffRoleMayHold(role.baseRole, grant.key);
                        return (
                          <li key={grant.key}>
                            <label className={cn("flex items-start gap-2 text-sm", !allowed && "opacity-50")}>
                              <input
                                type="checkbox"
                                name="grants"
                                value={grant.key}
                                checked={allowed && granted.includes(grant.key)}
                                disabled={!allowed}
                                onChange={() => toggle(grant.key)}
                                className="accent-primary mt-0.5 size-4"
                              />
                              <span>
                                {grant.label}
                                {defaults.includes(grant.key) ? <span className="text-muted-foreground"> · default</span> : null}
                                <span className="text-muted-foreground block text-xs">{allowed ? grant.hint : `Never for a ${role.name.toLowerCase()}.`}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
          </>
        ) : null}
      </section>

      {/* Step 3 */}
      <section data-step="2" hidden={step !== 2} className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">Optional. PDF, JPG or PNG up to 10 MB each. Kept private: only you can open them.</p>
        {docRows.map((index) => (
          <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[14rem_1fr_1fr]">
            <SelectField name={`doc.${index}.type`} label="Document" options={DOC_TYPES} defaultValue="AADHAAR" />
            <TextField name={`doc.${index}.label`} label="Name (optional)" placeholder="B.Ed. certificate" />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`doc-${index}`}>File</Label>
              <Input id={`doc-${index}`} type="file" name={`doc.${index}.file`} accept="application/pdf,image/jpeg,image/png" />
            </div>
          </div>
        ))}
        {docRows.length < 12 ? (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setDocRows((rows) => [...rows, (rows.at(-1) ?? 0) + 1])}>
              Add another document
            </Button>
          </div>
        ) : null}
      </section>

      {/* Step 4 */}
      <section data-step="3" hidden={step !== 3} className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border p-4 text-sm">
          {review.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <input type="checkbox" name="createLogin" checked={createLogin} onChange={(event) => setCreateLogin(event.target.checked)} className="accent-primary mt-0.5 size-4" />
          <span>
            Create their login and email an activation link
            <span className="text-muted-foreground block text-xs">
              They choose their own password from the link (valid 7 days, single use). No password is ever emailed. Untick to add a login later from their profile.
            </span>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        {step > 0 ? (
          <Button type="button" variant="outline" onClick={() => go(step - 1)}>
            Back
          </Button>
        ) : null}
        {step < 3 ? (
          <Button type="button" onClick={() => go(step + 1)} disabled={step === 1 && !role}>
            Next
          </Button>
        ) : (
          <SubmitButton pendingLabel="Creating…">Create staff profile</SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}
