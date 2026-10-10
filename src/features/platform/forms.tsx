"use client";

import { ActionForm } from "@/components/forms/action-form";
import { LimitFields, RoleChecks } from "@/features/campuses/forms";
import { CheckboxField, FieldRow, PhoneField, SelectField, SubmitButton, TextField, TextareaField, type SelectOption } from "@/components/forms/fields";

import {
  createSchoolAdminAction,
  reasonTransitionAction,
  resetAdminPasswordAction,
  saveOfferAction,
  renameSchoolAction,
  setSchoolRolesAction,
  setSubscriptionAction,
} from "./actions";

export function ReasonForm({
  schoolId,
  transition,
  label,
  hint,
}: {
  schoolId: string;
  transition: "reject" | "suspend";
  label: string;
  hint: string;
}) {
  return (
    <ActionForm action={reasonTransitionAction} className="gap-3" resetOnSuccess>
      <input type="hidden" name="schoolId" value={schoolId} />
      <input type="hidden" name="transition" value={transition} />
      <TextareaField name="reason" label="Reason" hint={hint} required rows={2} />
      <div>
        <SubmitButton variant="destructive" pendingLabel="Saving…">
          {label}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CreateAdminForm({ schoolId }: { schoolId: string }) {
  return (
    <ActionForm action={createSchoolAdminAction} resetOnSuccess>
      <input type="hidden" name="schoolId" value={schoolId} />
      <FieldRow>
        <TextField name="firstName" label="First name" required />
        <TextField name="lastName" label="Last name" required />
      </FieldRow>
      <FieldRow>
        <TextField name="email" label="Email" type="email" required />
        <PhoneField name="phone" label="Phone" />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Creating…">Create administrator</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  return (
    <ActionForm action={resetAdminPasswordAction} className="gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div>
        <SubmitButton variant="outline" size="sm" pendingLabel="Issuing…">
          Reset password
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SubscriptionForm({
  schoolId,
  plans,
  statuses,
  defaults,
}: {
  schoolId: string;
  plans: SelectOption[];
  statuses: SelectOption[];
  defaults: { planId?: string; status?: string; startsAt?: string; endsAt?: string; notes?: string };
}) {
  return (
    <ActionForm action={setSubscriptionAction}>
      <input type="hidden" name="schoolId" value={schoolId} />
      <FieldRow>
        <SelectField name="planId" label="Plan" options={plans} defaultValue={defaults.planId} required />
        <SelectField name="status" label="Status" options={statuses} defaultValue={defaults.status ?? "ACTIVE"} required />
      </FieldRow>
      <FieldRow>
        <TextField name="startsAt" label="Starts" type="date" defaultValue={defaults.startsAt} required />
        <TextField name="endsAt" label="Ends" type="date" defaultValue={defaults.endsAt} hint="Leave blank for no end date." />
      </FieldRow>
      <TextareaField name="notes" label="Notes" defaultValue={defaults.notes} rows={2} />
      <div>
        <SubmitButton>Save subscription</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function OfferForm({
  offer,
}: {
  offer?: {
    id: string;
    title: string;
    description: string | null;
    priceLabel: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    startsAt: string;
    endsAt: string | null;
    sortOrder: number;
    isActive: boolean;
  };
}) {
  return (
    <ActionForm action={saveOfferAction} className="max-w-2xl">
      {offer ? <input type="hidden" name="offerId" value={offer.id} /> : null}
      <TextField name="title" label="Title" defaultValue={offer?.title} required />
      <TextareaField name="description" label="Description" defaultValue={offer?.description ?? ""} rows={2} />
      <FieldRow>
        <TextField name="priceLabel" label="Price label" placeholder="Rs 35,000/year" defaultValue={offer?.priceLabel ?? ""} />
        <TextField name="sortOrder" label="Display order" inputMode="numeric" defaultValue={offer?.sortOrder ?? 0} />
      </FieldRow>
      <FieldRow>
        <TextField name="ctaLabel" label="Button text" placeholder="Get started" defaultValue={offer?.ctaLabel ?? ""} />
        <TextField name="ctaHref" label="Button link" placeholder="/register" defaultValue={offer?.ctaHref ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="startsAt" label="Show from" type="date" defaultValue={offer?.startsAt} required />
        <TextField name="endsAt" label="Show until" type="date" defaultValue={offer?.endsAt ?? ""} hint="Leave blank to show indefinitely." />
      </FieldRow>
      <CheckboxField
        name="isActive"
        label="Active"
        hint="Inactive offers never show, whatever their dates."
        defaultChecked={offer?.isActive ?? true}
      />
      <div>
        <SubmitButton>Save offer</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Super Admin: which roles one school may use, and its own limits (blank = the plan's). */
export function SchoolRolesForm({ schoolId, roles, followPlan, limits }: { schoolId: string; roles: string[]; followPlan: boolean; limits: Record<string, number | undefined> }) {
  return (
    <ActionForm action={setSchoolRolesAction} className="gap-4">
      <input type="hidden" name="schoolId" value={schoolId} />
      <CheckboxField name="followPlan" label="Follow the plan's roles" hint="Untick to choose this school's own set." defaultChecked={followPlan} />
      <RoleChecks initial={roles} />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Limits for this school</p>
        <p className="text-muted-foreground text-xs">Blank: the plan&apos;s limit applies.</p>
        <LimitFields initial={limits} />
      </div>
      <div>
        <SubmitButton variant="outline">Save roles & limits</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Super Admin: correct the school's name (the campus shows it everywhere). */
export function RenameSchoolForm({ schoolId, name }: { schoolId: string; name: string }) {
  return (
    <ActionForm action={renameSchoolAction} className="gap-2">
      <input type="hidden" name="schoolId" value={schoolId} />
      <TextField name="name" label="School / campus name" defaultValue={name} required />
      <div>
        <SubmitButton size="sm" variant="outline">
          Save name
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
