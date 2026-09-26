"use client";

import { ActionForm } from "@/components/forms/action-form";
import {
  FieldRow,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/forms/fields";

import { registerSchoolAction } from "./registration-actions";

export function RegisterForm({
  plans,
  defaultPlan,
}: {
  plans: { value: string; label: string }[];
  defaultPlan?: string;
}) {
  return (
    <ActionForm action={registerSchoolAction}>
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-sm font-semibold">About the school</legend>
        <TextField name="name" label="School name" required autoComplete="organization" />
        <FieldRow>
          <TextField name="city" label="City" required autoComplete="address-level2" />
          <TextField name="state" label="State" required autoComplete="address-level1" />
        </FieldRow>
        <FieldRow>
          <TextField name="affiliationBoard" label="Board" placeholder="CBSE, ICSE, State Board…" />
          <TextField
            name="establishedYear"
            label="Year established"
            inputMode="numeric"
            placeholder="1998"
          />
        </FieldRow>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-sm font-semibold">Contact person</legend>
        <TextField name="contactName" label="Your name" required autoComplete="name" />
        <FieldRow>
          <TextField
            name="contactEmail"
            label="Email"
            type="email"
            required
            autoComplete="email"
            hint="Your administrator sign-in will use this address."
          />
          <TextField
            name="contactPhone"
            label="Phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="+91 98765 43210"
          />
        </FieldRow>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-sm font-semibold">Your sign-in</legend>
        <p className="text-muted-foreground -mt-2 text-sm">
          You will sign in with the email above and the password you choose
          here, once your school is approved.
        </p>
        <FieldRow>
          <TextField
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters, with a letter and a number."
            required
          />
          <TextField
            name="confirmPassword"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
          />
        </FieldRow>
      </fieldset>

      {plans.length ? (
        <SelectField
          name="plan"
          label="Plan you are interested in"
          options={plans}
          placeholder="Not sure yet"
          defaultValue={defaultPlan ?? ""}
        />
      ) : null}

      {/* Honeypot: invisible to people, irresistible to form-filling bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <SubmitButton pendingLabel="Submitting…" className="h-10 w-full sm:w-auto sm:px-6">
        Submit registration
      </SubmitButton>
    </ActionForm>
  );
}
