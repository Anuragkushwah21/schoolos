"use client";

import { useState } from "react";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, SelectField, SubmitButton, TextareaField, TextField, type SelectOption } from "@/components/forms/fields";
import { type StaffModule, grantDef } from "@/lib/staff-access";

import { markTripAction, reportRouteIssueAction, saveRoleProfileAction, saveSubstitutionAction, setStaffGrantsAction } from "./access-actions";
import { PermissionChecklist } from "./permission-checklist";

/** A role's name, description and the permissions new staff in it start with. */
export function RoleProfileForm({
  role,
  baseRoles,
  modulesFirst,
}: {
  role?: { id: string; name: string; baseRole: string; isCustom: boolean; description: string | null; defaultGrants: string[]; staffCount: number };
  baseRoles: SelectOption[];
  modulesFirst?: StaffModule[];
}) {
  const [baseRole, setBaseRole] = useState(role?.baseRole ?? "OTHER");
  const editableName = !role || role.isCustom;
  return (
    <ActionForm action={saveRoleProfileAction} className="gap-4">
      {role ? <input type="hidden" name="roleId" value={role.id} /> : null}
      {editableName ? (
        <FieldRow>
          <TextField name="name" label="Role name" defaultValue={role?.name} placeholder="Hostel warden" required />
          <SelectField
            name="baseRole"
            label="Works like"
            options={baseRoles}
            defaultValue={baseRole}
            onChange={(event) => setBaseRole(event.target.value)}
            hint="Decides what this role can never be given."
          />
        </FieldRow>
      ) : (
        <>
          <input type="hidden" name="name" value={role.name} />
          <input type="hidden" name="baseRole" value={role.baseRole} />
        </>
      )}
      <TextareaField name="description" label="What this role does" rows={2} defaultValue={role?.description ?? ""} />
      <div>
        <p className="mb-2 text-sm font-medium">Permissions new staff in this role start with</p>
        <PermissionChecklist key={baseRole} name="defaultGrants" baseRole={baseRole} roleName={role?.name ?? "role"} defaultValue={role?.defaultGrants ?? []} modulesFirst={modulesFirst} />
      </div>
      {role && role.staffCount ? (
        <CheckboxField name="applyToStaff" label={`Also give the ${role.staffCount} staff already in this role exactly these permissions`} />
      ) : null}
      <div>
        <SubmitButton>{role ? "Save role" : "Add role"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Exactly what one staff member may do. */
export function StaffGrantsForm({ staffId, baseRole, roleName, grants, modulesFirst }: { staffId: string; baseRole: string; roleName: string; grants: string[]; modulesFirst?: StaffModule[] }) {
  return (
    <ActionForm action={setStaffGrantsAction} className="gap-4">
      <input type="hidden" name="staffId" value={staffId} />
      <PermissionChecklist baseRole={baseRole} roleName={roleName} defaultValue={grants} modulesFirst={modulesFirst} />
      <div>
        <SubmitButton>Save permissions</SubmitButton>
      </div>
    </ActionForm>
  );
}

type Candidate = { id: string; name: string; role: string; sameRole: boolean; cannotHold: string[] };

/**
 * Assign a substitute: who, from when to when, why, and the temporary access
 * (pre-ticked with the original's permissions). A substitute whose role
 * could never hold some of them is flagged before saving.
 */
export function SubstitutionForm({
  originalStaffId,
  originalGrants,
  candidates,
  today,
  hasRoutes,
}: {
  originalStaffId: string;
  originalGrants: string[];
  candidates: Candidate[];
  today: string;
  hasRoutes: boolean;
}) {
  const [substituteId, setSubstituteId] = useState("");
  const [grants, setGrants] = useState<string[]>(originalGrants);
  const chosen = candidates.find((row) => row.id === substituteId);
  const sameRole = candidates.filter((row) => row.sameRole);
  const others = candidates.filter((row) => !row.sameRole);
  const options: SelectOption[] = [
    ...sameRole.map((row) => ({ value: row.id, label: `${row.name} · ${row.role}` })),
    ...others.map((row) => ({ value: row.id, label: `${row.name} · ${row.role} (different role)` })),
  ];
  return (
    <ActionForm action={saveSubstitutionAction} resetOnSuccess className="gap-4">
      <input type="hidden" name="originalStaffId" value={originalStaffId} />
      <SelectField name="substituteStaffId" label="Substitute" options={options} placeholder="Choose a colleague" value={substituteId} onChange={(event) => setSubstituteId(event.target.value)} required />
      {chosen?.cannotHold.length ? (
        <p className="bg-warning-soft text-warning-strong rounded-lg px-3 py-2 text-xs">
          A {chosen.role.toLowerCase()} can never have: {chosen.cannotHold.map((key) => grantDef(key)?.label ?? key).join(", ")}. Those are left out below.
        </p>
      ) : null}
      <FieldRow>
        <TextField name="startDate" label="From" type="date" defaultValue={today} required />
        <TextField name="endDate" label="To" type="date" defaultValue={today} required hint="Access ends by itself after this day." />
      </FieldRow>
      <TextField name="reason" label="Reason" placeholder="On sick leave" required />
      <TextareaField name="notes" label="Notes for the substitute" rows={2} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Temporary access</legend>
        <input type="hidden" name="grants" value="" />
        {originalGrants.length ? (
          originalGrants.map((key) => {
            const def = grantDef(key);
            // The server worked out what each candidate's role can never hold; it checks again on save.
            const allowed = !chosen || !chosen.cannotHold.includes(key);
            return (
              <label key={key} className={`flex items-start gap-2 text-sm ${allowed ? "" : "opacity-60"}`}>
                <input
                  type="checkbox"
                  name="grants"
                  value={key}
                  disabled={!allowed}
                  checked={allowed && grants.includes(key)}
                  onChange={(event) => setGrants((current) => (event.target.checked ? [...current, key] : current.filter((item) => item !== key)))}
                  className="accent-primary mt-0.5 size-4 shrink-0"
                />
                <span>
                  {def?.label ?? key}
                  <span className="text-muted-foreground block text-xs">{def?.hint}</span>
                </span>
              </label>
            );
          })
        ) : (
          <p className="text-muted-foreground text-xs">This person has no module permissions to lend.</p>
        )}
        {hasRoutes ? <CheckboxField name="coverRoutes" label="Also take over their route(s) for these days" defaultChecked /> : <input type="hidden" name="coverRoutes" value="" />}
      </fieldset>
      <div>
        <SubmitButton>Assign substitute</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One student's pickup or drop, as buttons. Marking again replaces today's mark. */
export function TripButtons({ routeId, studentId, trip, current }: { routeId: string; studentId: string; trip: "PICKUP" | "DROP"; current: string | null }) {
  const choices = trip === "PICKUP" ? (["PICKED_UP", "NOT_PRESENT"] as const) : (["DROPPED", "NOT_PRESENT"] as const);
  const label = { PICKED_UP: "Picked up", DROPPED: "Dropped", NOT_PRESENT: "Not present" } as const;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {choices.map((status) => (
        <ActionButton key={status} action={markTripAction} fields={{ routeId, studentId, trip, status }} size="xs" variant={current === status ? "default" : "outline"}>
          {label[status]}
        </ActionButton>
      ))}
      <details className="text-xs">
        <summary className={`cursor-pointer ${current === "ISSUE" ? "text-danger-strong font-semibold" : "text-muted-foreground"}`}>Issue</summary>
        <ActionForm action={markTripAction} className="mt-2 gap-2">
          <input type="hidden" name="routeId" value={routeId} />
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="trip" value={trip} />
          <input type="hidden" name="status" value="ISSUE" />
          <TextField name="note" label="What happened" required />
          <div>
            <SubmitButton size="xs">Save issue</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}

/** Report something wrong on the route today. */
export function RouteIssueForm({ routeId }: { routeId: string }) {
  return (
    <ActionForm action={reportRouteIssueAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="routeId" value={routeId} />
      <TextareaField name="note" label="What happened" rows={2} placeholder="Bus breakdown near the temple; 20 minutes late." required />
      <div>
        <SubmitButton size="sm" variant="outline">
          Report issue
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

