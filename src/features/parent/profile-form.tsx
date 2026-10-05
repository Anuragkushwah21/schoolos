"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SubmitButton, TextField } from "@/components/forms/fields";

import { updateMyProfileAction } from "./profile-actions";

export type MyDetails = {
  firstName: string;
  lastName: string;
  phone: string;
  alternatePhone: string | null;
  occupation: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

/** One settings row: what it is on the left, its fields on the right. */
function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[13rem_1fr] lg:gap-8">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{hint}</p> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** The parent's own details, in three short groups. Saved together. */
export function MyProfileForm({ details }: { details: MyDetails }) {
  return (
    <ActionForm action={updateMyProfileAction} className="gap-6">
      <Group title="About you" hint="Your name as the school and teachers see it.">
        <FieldRow>
          <TextField name="firstName" label="First name" defaultValue={details.firstName} required autoComplete="given-name" />
          <TextField name="lastName" label="Last name" defaultValue={details.lastName} required autoComplete="family-name" />
        </FieldRow>
        <TextField name="occupation" label="Occupation" defaultValue={details.occupation ?? ""} placeholder="e.g. Teacher, Business, Engineer" />
      </Group>

      <Group title="How the school reaches you" hint="The school calls and messages this mobile number about your children.">
        <FieldRow>
          <PhoneField name="phone" label="Mobile number" defaultValue={details.phone} required />
          <PhoneField name="alternatePhone" label="Alternate number" defaultValue={details.alternatePhone ?? ""} hint="Optional — another parent, or a second phone." />
        </FieldRow>
      </Group>

      <Group title="Home address" hint="Used for school letters and records.">
        <TextField name="addressLine" label="House, street, area" defaultValue={details.addressLine ?? ""} autoComplete="street-address" />
        <FieldRow>
          <TextField name="city" label="City" defaultValue={details.city ?? ""} autoComplete="address-level2" />
          <TextField name="state" label="State" defaultValue={details.state ?? ""} autoComplete="address-level1" />
        </FieldRow>
        <FieldRow>
          <TextField name="postalCode" label="PIN code" inputMode="numeric" maxLength={6} defaultValue={details.postalCode ?? ""} autoComplete="postal-code" />
        </FieldRow>
      </Group>

      <div className="flex justify-end border-t pt-5">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </ActionForm>
  );
}
