"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SubmitButton, TextField } from "@/components/forms/fields";

import { createPrincipalAction, savePrincipalProfileAction } from "./actions";

export function PrincipalForm() {
  return (
    <ActionForm action={createPrincipalAction} className="gap-3" resetOnSuccess>
      <FieldRow>
        <TextField name="firstName" label="First name" required />
        <TextField name="lastName" label="Last name" required />
      </FieldRow>
      <FieldRow>
        <TextField name="email" label="Email (their sign-in)" type="email" required />
        <PhoneField name="phone" label="Mobile" />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Creating…">Create Principal login</SubmitButton>
      </div>
    </ActionForm>
  );
}

type ProfileValues = { employeeId: string; designation: string; qualification: string; experience: string; appointmentDate: string; joiningDate: string; exitDate: string; dateOfBirth: string; addressLine: string; city: string; state: string; postalCode: string };

/** The Principal's employment record: what their ID card and letters print. Every value is entered here — none is guessed. */
export function PrincipalProfileForm({ userId, values }: { userId: string; values: ProfileValues }) {
  return (
    <ActionForm action={savePrincipalProfileAction} className="gap-4">
      <input type="hidden" name="userId" value={userId} />
      <FieldRow>
        <TextField name="employeeId" label="Employee ID" defaultValue={values.employeeId} placeholder="PRN-001" />
        <TextField name="designation" label="Designation" defaultValue={values.designation} placeholder="Principal" />
      </FieldRow>
      <FieldRow>
        <TextField name="appointmentDate" label="Date of appointment" type="date" defaultValue={values.appointmentDate} />
        <TextField name="joiningDate" label="Date of joining" type="date" defaultValue={values.joiningDate} />
      </FieldRow>
      <FieldRow>
        <TextField name="qualification" label="Qualifications" defaultValue={values.qualification} placeholder="M.A., B.Ed." />
        <TextField name="experience" label="Experience" defaultValue={values.experience} placeholder="18 years in CBSE schools" />
      </FieldRow>
      <FieldRow>
        <TextField name="dateOfBirth" label="Date of birth" type="date" defaultValue={values.dateOfBirth} />
        <TextField name="exitDate" label="Last working day (only once they have left)" type="date" defaultValue={values.exitDate} />
      </FieldRow>
      <TextField name="addressLine" label="Address" defaultValue={values.addressLine} />
      <FieldRow>
        <TextField name="city" label="City" defaultValue={values.city} />
        <TextField name="state" label="State" defaultValue={values.state} />
        <TextField name="postalCode" label="PIN code" defaultValue={values.postalCode} />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Saving…">Save employment record</SubmitButton>
      </div>
    </ActionForm>
  );
}
