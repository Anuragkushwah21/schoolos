"use client";

import { ActionForm } from "@/components/forms/action-form";
import {
  CheckboxField,
  FieldRow,
  type SelectOption,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";

import {
  approveSchoolAction,
  createSchoolAdminAction,
  reasonTransitionAction,
  resetAdminPasswordAction,
  saveOfferAction,
  setSubscriptionAction,
  updatePlanAction,
} from "./actions";

/**
 * Approval, and the one-time password it issues.
 *
 * The form stays mounted after the school turns ACTIVE — `canApprove` only
 * hides the button. Unmounting it would take the just-issued password with it,
 * and that password cannot be shown again.
 */
export function ApproveSchoolForm({
  schoolId,
  canApprove,
}: {
  schoolId: string;
  canApprove: boolean;
}) {
  return (
    <ActionForm action={approveSchoolAction} className="gap-3">
      <input type="hidden" name="schoolId" value={schoolId} />
      {canApprove ? (
        <>
          <p className="text-muted-foreground text-sm">
            Approving activates the school, sets up classes Nursery–12, streams,
            subjects and the current session, creates an administrator from the
            registration contact, and emails them the sign-in.
          </p>
          <div>
            <SubmitButton pendingLabel="Approving…">Approve school</SubmitButton>
          </div>
        </>
      ) : null}
    </ActionForm>
  );
}

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
        <TextField name="phone" label="Phone" type="tel" />
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

export function PlanForm({
  plan,
}: {
  plan: {
    id: string;
    name: string;
    description: string | null;
    priceRupees: number;
    maxStudents: number | null;
    maxTeachers: number | null;
    maxAdmins: number | null;
    storageMb: number | null;
    isActive: boolean;
  };
}) {
  return (
    <ActionForm action={updatePlanAction}>
      <input type="hidden" name="planId" value={plan.id} />
      <FieldRow>
        <TextField name="name" label="Name" defaultValue={plan.name} required />
        <TextField name="priceRupees" label="Price per year (₹)" inputMode="decimal" defaultValue={plan.priceRupees} required />
      </FieldRow>
      <TextareaField name="description" label="Description" defaultValue={plan.description ?? ""} rows={2} />
      <p className="text-muted-foreground text-xs">Leave a limit blank for unlimited.</p>
      <FieldRow>
        <TextField name="maxStudents" label="Max students" inputMode="numeric" defaultValue={plan.maxStudents ?? ""} />
        <TextField name="maxTeachers" label="Max teachers" inputMode="numeric" defaultValue={plan.maxTeachers ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="maxAdmins" label="Max admins" inputMode="numeric" defaultValue={plan.maxAdmins ?? ""} />
        <TextField name="storageMb" label="Storage (MB)" inputMode="numeric" defaultValue={plan.storageMb ?? ""} />
      </FieldRow>
      <CheckboxField
        name="isActive"
        label="Offered to new schools"
        hint="Hiding a plan does not affect schools already on it."
        defaultChecked={plan.isActive}
      />
      <div>
        <SubmitButton>Save plan</SubmitButton>
      </div>
    </ActionForm>
  );
}
