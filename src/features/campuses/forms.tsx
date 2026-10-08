"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { OPTIONAL_MODULES } from "@/lib/school-modules";
import { LIMIT_KEYS, OPTIONAL_ROLES } from "@/lib/school-roles";
import { cn } from "@/lib/utils";

import { approveCampusRequestAction, rejectCampusRequestAction, setCampusLimitAction, submitCampusRequestAction, switchCampusAction, updateCampusRequestAction } from "./actions";

/**
 * The campus switcher in the sidebar, for an Owner with more than one live
 * campus. The choice is sent to the server, which checks the campus is theirs;
 * the page then reloads in that campus. "All Campuses" opens the summary.
 */
export function CampusSwitcher({ campuses, currentId }: { campuses: Array<{ id: string; name: string }>; currentId: string | null }) {
  const [pending, start] = useTransition();
  return (
    <label className="mt-1 block">
      <span className="sr-only">Switch school</span>
      <select
        aria-label="Switch school"
        disabled={pending}
        defaultValue={currentId ?? ""}
        className="w-full cursor-pointer rounded-lg border border-white/30 bg-white/15 px-2 py-1 text-xs font-medium text-white outline-none [&>option]:text-black"
        onChange={(event) => {
          const value = event.target.value;
          if (value === "ALL") {
            window.location.assign("/school-admin/campuses");
            return;
          }
          start(async () => {
            const formData = new FormData();
            formData.set("schoolId", value);
            const result = await switchCampusAction({ status: "idle" }, formData);
            if (result.status === "error") {
              toast.error(result.message);
              return;
            }
            window.location.assign("/school-admin/dashboard");
          });
        }}
      >
        {campuses.map((campus) => (
          <option key={campus.id} value={campus.id}>
            {campus.name}
          </option>
        ))}
        <option value="ALL">All Campuses (summary)</option>
      </select>
    </label>
  );
}

/** A plain "Open" button that switches to a campus, for the All Campuses cards. */
export function OpenCampusButton({ schoolId, label = "Open" }: { schoolId: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium disabled:opacity-60"
      onClick={() =>
        start(async () => {
          const formData = new FormData();
          formData.set("schoolId", schoolId);
          const result = await switchCampusAction({ status: "idle" }, formData);
          if (result.status === "error") toast.error(result.message);
          else window.location.assign("/school-admin/dashboard");
        })
      }
    >
      {pending ? "Opening…" : label}
    </button>
  );
}

function Checks({ name, options, initial, allowed, inPlan }: { name: string; options: ReadonlyArray<{ key: string; label: string }>; initial: readonly string[]; allowed?: readonly string[]; inPlan?: readonly string[] }) {
  const [selected, setSelected] = useState<string[]>([...initial]);
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((option) => {
        const available = !allowed || allowed.includes(option.key);
        const on = selected.includes(option.key);
        return (
          <li key={option.key}>
            <label className={cn("flex items-center gap-2 rounded-lg border p-2.5 text-sm", on ? "border-success/40 bg-success-soft/50" : "bg-muted/30", available ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
              <input
                type="checkbox"
                name={name}
                value={option.key}
                checked={on}
                disabled={!available}
                onChange={(event) => setSelected(event.target.checked ? [...selected, option.key] : selected.filter((key) => key !== option.key))}
                className="size-4"
              />
              <span>
                {option.label}
                {available ? null : <span className="text-muted-foreground block text-xs">Not in your plan</span>}
                {inPlan && !inPlan.includes(option.key) ? <span className="text-warning-strong block text-xs">Not in your plan — needs upgrade/approval</span> : null}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function ModuleChecks(props: { name?: string; initial: readonly string[]; allowed?: readonly string[] }) {
  return <Checks name={props.name ?? "modules"} options={OPTIONAL_MODULES} initial={props.initial} allowed={props.allowed} />;
}

export function RoleChecks(props: { name?: string; initial: readonly string[]; allowed?: readonly string[] }) {
  return <Checks name={props.name ?? "roles"} options={OPTIONAL_ROLES} initial={props.initial} allowed={props.allowed} />;
}

/** One number field per limit key, named `limit.<KEY>`; blank means "no limit" (or "the plan's"). */
export function LimitFields({ initial, max, keys }: { initial: Record<string, number | undefined>; max?: Record<string, number | undefined>; keys?: readonly string[] }) {
  const shown = LIMIT_KEYS.filter((limit) => !keys || keys.includes(limit.key));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {shown.map((limit) => (
        <TextField
          key={limit.key}
          name={`limit.${limit.key}`}
          label={limit.label}
          type="number"
          min={0}
          step={1}
          defaultValue={initial[limit.key] ?? ""}
          hint={max?.[limit.key] !== undefined ? `Plan max ${max[limit.key]}` : undefined}
        />
      ))}
    </div>
  );
}

/** Asking SchoolOS for a new school/campus. Only what the plan includes can be ticked. */
export type CampusRequestDraft = {
  id: string;
  name: string;
  addressLine: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  affiliationBoard: string | null;
  expectedStudents: number | null;
  expectedTeachers: number | null;
  expectedStaff: number | null;
  notes: string | null;
  modules: string[];
  roles: string[];
  limits: Record<string, number | undefined>;
};

/** Limits a requester may ask for: people counts and the plan's switchable roles. */
const REQUEST_LIMIT_KEYS = ["STUDENTS", "TEACHERS", "STAFF", "PRINCIPAL", "ACCOUNTANT", "RECEPTIONIST", "LIBRARIAN", "DRIVER", "SECURITY"];

/**
 * Asking SchoolOS for a new school/campus — or correcting one still pending
 * (`existing`). Only what the plan includes can be ticked; the server checks
 * the same again.
 */
export function CampusRequestForm({ modules, roles, limits, existing }: { modules: readonly string[]; roles: readonly string[]; limits: Record<string, number | undefined>; existing?: CampusRequestDraft }) {
  const shownLimits = REQUEST_LIMIT_KEYS;
  return (
    <ActionForm action={existing ? updateCampusRequestAction : submitCampusRequestAction} className="gap-5">
      {existing ? <input type="hidden" name="requestId" value={existing.id} /> : null}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">School details</h3>
        <TextField name="name" label="School/Campus name" placeholder="XYZ Public School" defaultValue={existing?.name} minLength={2} maxLength={150} required />
        <TextField name="addressLine" label="Address" defaultValue={existing?.addressLine ?? ""} />
        <FieldRow>
          <TextField name="city" label="City" defaultValue={existing?.city} required />
          <TextField name="state" label="State" defaultValue={existing?.state} required />
        </FieldRow>
        <FieldRow>
          <TextField name="postalCode" label="PIN code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" title="6-digit PIN code" defaultValue={existing?.postalCode ?? ""} />
          <TextField name="affiliationBoard" label="Board" placeholder="CBSE, ICSE, State board…" defaultValue={existing?.affiliationBoard ?? ""} />
        </FieldRow>
        <FieldRow>
          <TextField name="contactName" label="Contact person" defaultValue={existing?.contactName} required />
          <TextField name="contactEmail" label="Contact email" type="email" defaultValue={existing?.contactEmail} required />
        </FieldRow>
        <PhoneField name="contactPhone" label="Contact mobile" defaultValue={existing?.contactPhone} required />
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Expected size</h3>
        <FieldRow>
          <TextField name="expectedStudents" type="number" min={0} step={1} label="Expected students" inputMode="numeric" defaultValue={existing?.expectedStudents ?? ""} />
          <TextField name="expectedTeachers" type="number" min={0} step={1} label="Expected teachers" inputMode="numeric" defaultValue={existing?.expectedTeachers ?? ""} />
        </FieldRow>
        <TextField name="expectedStaff" type="number" min={0} step={1} label="Expected non-teaching staff" inputMode="numeric" defaultValue={existing?.expectedStaff ?? ""} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Optional modules</h3>
        <p className="text-muted-foreground text-xs">Students, teachers, academics, attendance, homework, exams, communication, calendar, leave and reports are always included. You may ask for modules outside your plan; SchoolOS decides when reviewing.</p>
        <Checks name="modules" options={OPTIONAL_MODULES} inPlan={modules} initial={existing?.modules ?? modules} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Roles</h3>
        <p className="text-muted-foreground text-xs">School Admin, Teacher, Parent and Student are always included. Roles outside your plan need SchoolOS approval.</p>
        <Checks name="roles" options={OPTIONAL_ROLES} inPlan={roles} initial={existing?.roles ?? roles} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Requested limits</h3>
        <p className="text-muted-foreground text-xs">Leave blank for none. Asking above your plan is allowed; SchoolOS decides.</p>
        <LimitFields initial={existing?.limits ?? {}} max={limits} keys={shownLimits} />
      </section>
      <TextareaField name="notes" label="Message / business justification" placeholder="Why the new school, when it opens, anything SchoolOS should know" rows={3} defaultValue={existing?.notes ?? ""} />
      <div>
        <SubmitButton pendingLabel={existing ? "Saving…" : "Sending…"}>{existing ? "Save changes" : "Send request for review"}</SubmitButton>
      </div>
    </ActionForm>
  );
}


/** Super Admin: approve as asked, or change the modules, roles and limits first. */
export function ApproveCampusForm({ requestId, modules, roles, limits }: { requestId: string; modules: readonly string[]; roles: readonly string[]; limits: Record<string, number | undefined> }) {
  return (
    <ActionForm action={approveCampusRequestAction} className="gap-4">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Modules to switch on</p>
        <ModuleChecks initial={modules} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Roles to allow</p>
        <RoleChecks initial={roles} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Limits for this campus</p>
        <p className="text-muted-foreground text-xs">Blank: the plan&apos;s limit applies.</p>
        <LimitFields initial={limits} />
      </div>
      <TextareaField name="reviewNote" label="Note (optional)" rows={2} />
      <p className="text-muted-foreground text-xs">Changing anything approves it as “Modified”. The original request is kept. The campus is created and goes live on approval.</p>
      <div>
        <SubmitButton pendingLabel="Approving…">Approve & create campus</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RejectCampusForm({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={rejectCampusRequestAction} className="gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <TextareaField name="reason" label="Reason for rejecting" rows={2} required />
      <div>
        <SubmitButton variant="destructive" pendingLabel="Rejecting…">
          Reject request
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CampusLimitForm({ organizationId, current }: { organizationId: string; current: number | null }) {
  return (
    <ActionForm action={setCampusLimitAction} className="gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <TextField name="campusLimit" label="Campus limit for this organization" inputMode="numeric" defaultValue={current ?? ""} hint="Blank: follow the plan." />
      <div>
        <SubmitButton variant="outline">Save campus limit</SubmitButton>
      </div>
    </ActionForm>
  );
}
