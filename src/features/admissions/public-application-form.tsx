"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SelectField, SubmitButton, TextField, TextareaField, type SelectOption } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { streamRuleForLevel } from "@/lib/stream-rules";

import { submitApplicationAction } from "./actions";
import { type ClassOption, StreamChoice } from "./enquiry-form";

type ApplicantDraft = { key: string; classId: string; streamId: string };
export type PublicCustomField = { key: string; label: string; kind: "TEXT" | "TEXTAREA" | "DATE" | "SELECT"; options: string[]; required: boolean };

const GENDERS: SelectOption[] = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "OTHER", label: "Other" },
];

let counter = 0;
const newApplicant = (): ApplicantDraft => ({ key: `a${(counter += 1)}`, classId: "", streamId: "" });

function ChildrenError() {
  const { fieldErrors } = useFormContext();
  return fieldErrors?.children?.length ? <p className="text-danger-strong text-sm">{fieldErrors.children[0]}</p> : null;
}

/**
 * The public admission form. One parent can apply for several children at
 * once; each child gets their own application number. Streams follow the
 * class: none up to Class 8, optional for 9–10, required for 11–12 — and the
 * server checks the same.
 *
 * `preview` shows the same form with every control switched off, for the
 * School Admin's Website → Admission form page: nothing can be submitted.
 */
export function PublicApplicationForm({
  slug,
  classes,
  streams,
  customFields,
  today,
  preview = false,
}: {
  slug: string;
  classes: ClassOption[];
  streams: SelectOption[];
  customFields: PublicCustomField[];
  today: string;
  preview?: boolean;
}) {
  const [children, setChildren] = useState<ApplicantDraft[]>(() => [newApplicant()]);
  const update = (key: string, patch: Partial<ApplicantDraft>) => setChildren((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <ActionForm action={submitApplicationAction}>
      <input type="hidden" name="slug" value={slug} />
      {/* A disabled fieldset switches off every control inside it, the submit button included. */}
      <fieldset disabled={preview} className="contents">

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-sm font-semibold">
          {children.length === 1 ? "About the child" : `About the children (${children.length})`}
        </legend>
        <ChildrenError />
        {children.map((child, index) => {
          const klass = classes.find((row) => row.value === child.classId);
          const n = (field: string) => `children.${index}.${field}`;
          return (
            <div key={child.key} className="border-primary/20 flex flex-col gap-4 rounded-2xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">Child {index + 1}</p>
                {children.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setChildren((rows) => rows.filter((row) => row.key !== child.key))}>
                    <Trash2Icon aria-hidden />
                    Remove
                  </Button>
                ) : null}
              </div>
              <FieldRow>
                <TextField name={n("firstName")} label="First name" required />
                <TextField name={n("lastName")} label="Last name" required />
              </FieldRow>
              <FieldRow>
                <TextField name={n("dateOfBirth")} label="Date of birth" type="date" max={today} />
                <SelectField name={n("gender")} label="Gender" placeholder="Prefer not to say" options={GENDERS} />
              </FieldRow>
              <FieldRow>
                <SelectField name={n("classId")} label="Applying for class" options={classes} placeholder="Select…" required value={child.classId} onChange={(event) => update(child.key, { classId: event.target.value, streamId: "" })} />
                <StreamChoice name={n("streamId")} rule={klass ? streamRuleForLevel(klass.level) : null} streams={streams} value={child.streamId} onChange={(streamId) => update(child.key, { streamId })} />
              </FieldRow>
              <TextField name={n("previousSchool")} label="Previous school" />
            </div>
          );
        })}
        <div>
          <Button type="button" variant="outline" onClick={() => setChildren((rows) => [...rows, newApplicant()])}>
            <PlusIcon aria-hidden />
            Add another child
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-sm font-semibold">Parent or guardian</legend>
        <FieldRow>
          <TextField name="parentName" label="Your full name" required autoComplete="name" />
          <SelectField
            name="parentRelationship"
            label="Relationship"
            defaultValue="FATHER"
            options={[
              { value: "FATHER", label: "Father" },
              { value: "MOTHER", label: "Mother" },
              { value: "GUARDIAN", label: "Guardian" },
            ]}
            required
          />
        </FieldRow>
        <FieldRow>
          <PhoneField name="parentPhone" label="Mobile number" required />
          <TextField name="parentEmail" label="Email" type="email" autoComplete="email" />
        </FieldRow>
        <TextField name="addressLine" label="Address" autoComplete="street-address" />
        <FieldRow>
          <TextField name="city" label="City" autoComplete="address-level2" />
          <TextField name="state" label="State" autoComplete="address-level1" />
        </FieldRow>
        <TextareaField name="notes" label="Anything the school should know" rows={3} />
      </fieldset>

      {customFields.length ? (
        <fieldset className="flex flex-col gap-5">
          <legend className="mb-4 text-sm font-semibold">A few more questions</legend>
          {customFields.map((field) =>
            field.kind === "TEXTAREA" ? (
              <TextareaField key={field.key} name={`custom.${field.key}`} label={field.label} rows={3} required={field.required} />
            ) : field.kind === "SELECT" ? (
              <SelectField key={field.key} name={`custom.${field.key}`} label={field.label} options={field.options.map((option) => ({ value: option, label: option }))} placeholder="Select…" required={field.required} />
            ) : (
              <TextField key={field.key} name={`custom.${field.key}`} label={field.label} type={field.kind === "DATE" ? "date" : "text"} required={field.required} />
            ),
          )}
        </fieldset>
      ) : null}

      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div>
        <SubmitButton pendingLabel="Submitting…" className="h-10 px-6">
          {preview ? "Submit (preview only)" : children.length === 1 ? "Submit application" : `Submit ${children.length} applications`}
        </SubmitButton>
      </div>
      </fieldset>
    </ActionForm>
  );
}
