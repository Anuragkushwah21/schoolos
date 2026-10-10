"use client";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SubmitButton, TextField } from "@/components/forms/fields";
import { cn } from "@/lib/utils";

import { registerSchoolAction } from "./registration-actions";

export type PlanOption = { slug: string; name: string; price: string; campuses: string };

/**
 * The registration form. The chosen plan is a controlled value owned by the
 * page (so choosing a plan card above never resets what was typed), sent as
 * `plan` and checked again on the server against the published plans.
 */
export function RegisterForm({ plans, plan, onPlanChange }: { plans: PlanOption[]; plan: string; onPlanChange: (slug: string) => void }) {
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
        <TextField
          name="udiseCode"
          label="UDISE code (optional)"
          inputMode="numeric"
          placeholder="23260100101"
          hint="The 11-digit code from UDISE+, if your school has one."
        />
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
          <PhoneField name="contactPhone" label="Phone" required />
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

      {plans.length ? <PlanChoice plans={plans} plan={plan} onPlanChange={onPlanChange} /> : null}

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

function PlanChoice({ plans, plan, onPlanChange }: { plans: PlanOption[]; plan: string; onPlanChange: (slug: string) => void }) {
  const { fieldErrors } = useFormContext();
  const error = fieldErrors?.plan?.[0];
  const options = [...plans, { slug: "", name: "Not sure yet", price: "Decide later with SchoolOS", campuses: "" }];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">Plan you are interested in</legend>
      <p className="text-muted-foreground -mt-1 text-xs">Nothing is charged now. SchoolOS confirms the plan and price when approving your school.</p>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.slug || "none"} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm", plan === option.slug ? "border-primary bg-primary-soft/40 ring-primary ring-1" : "hover:bg-muted/50")}>
            <input type="radio" name="plan" value={option.slug} checked={plan === option.slug} onChange={() => onPlanChange(option.slug)} className="mt-0.5 size-4" />
            <span>
              <span className="block font-semibold">{option.name}</span>
              <span className="text-muted-foreground block text-xs">{[option.price, option.campuses].filter(Boolean).join(" · ")}</span>
            </span>
          </label>
        ))}
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </fieldset>
  );
}
