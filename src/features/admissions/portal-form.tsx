"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { ActionForm } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, type SelectOption, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

import { savePortalAction } from "./enquiry-actions";

type FieldDraft = { key: string; label: string; kind: string; options: string; required: boolean };

const KINDS: SelectOption[] = [
  { value: "TEXT", label: "Short answer" },
  { value: "TEXTAREA", label: "Long answer" },
  { value: "DATE", label: "Date" },
  { value: "SELECT", label: "Choice from a list" },
];

let counter = 0;

/**
 * The public admission page's settings. The school's name, logo, address,
 * about and principal's message come from Website; the system questions
 * (child, class, stream, parent, mobile) are always asked — only extra
 * questions are added here.
 */
export function PortalForm({
  classes,
  defaults,
}: {
  classes: SelectOption[];
  defaults: {
    opensOn: string;
    closesOn: string;
    instructions: string;
    mapUrl: string;
    websiteUrl: string;
    highlights: string;
    classIds: string[];
    fields: Array<{ label: string; kind: string; options: string[]; required: boolean }>;
  };
}) {
  const [fields, setFields] = useState<FieldDraft[]>(() => defaults.fields.map((field) => ({ ...field, options: field.options.join("\n"), key: `f${(counter += 1)}` })));
  const update = (key: string, patch: Partial<FieldDraft>) => setFields((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <ActionForm action={savePortalAction} className="max-w-3xl gap-6">
      <section className="flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="font-semibold">When applications are open</h2>
        <FieldRow>
          <TextField name="opensOn" label="Opening date" type="date" defaultValue={defaults.opensOn} hint="Blank: open now." />
          <TextField name="closesOn" label="Closing date" type="date" defaultValue={defaults.closesOn} hint="Blank: no closing date." />
        </FieldRow>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Classes open for admission</legend>
          <p className="text-muted-foreground text-xs">None ticked: every active class.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {classes.map((klass) => (
              <label key={klass.value} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input type="checkbox" name="classIds" value={klass.value} defaultChecked={defaults.classIds.includes(klass.value)} className="accent-primary size-4" />
                {klass.label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border p-5">
        <h2 className="font-semibold">What families see</h2>
        <TextareaField name="instructions" label="Admission instructions" rows={4} defaultValue={defaults.instructions} hint="Documents to bring, age rules, the process." />
        <TextareaField name="highlights" label="Facilities and highlights" rows={4} defaultValue={defaults.highlights} hint="One per line, e.g. Smart classrooms." />
        <FieldRow>
          <TextField name="mapUrl" label="Map link" type="url" placeholder="https://maps.google.com/…" defaultValue={defaults.mapUrl} />
          <TextField name="websiteUrl" label="School website" type="url" placeholder="https://…" defaultValue={defaults.websiteUrl} />
        </FieldRow>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border p-5">
        <div>
          <h2 className="font-semibold">Extra questions</h2>
          <p className="text-muted-foreground text-sm">Up to 10, asked once per application. The standard questions cannot be removed.</p>
        </div>
        {fields.map((field, index) => (
          <div key={field.key} className="flex flex-col gap-3 rounded-xl border p-4">
            <FieldRow>
              <TextField name={`fields.${index}.label`} label="Question" required value={field.label} onChange={(event) => update(field.key, { label: event.target.value })} />
              <SelectField name={`fields.${index}.kind`} label="Answer type" options={KINDS} value={field.kind} onChange={(event) => update(field.key, { kind: event.target.value })} />
            </FieldRow>
            {field.kind === "SELECT" ? <TextareaField name={`fields.${index}.options`} label="Choices (one per line)" rows={3} required value={field.options} onChange={(event) => update(field.key, { options: event.target.value })} /> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CheckboxField key={`${field.key}-required`} name={`fields.${index}.required`} label="Families must answer" defaultChecked={field.required} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setFields((rows) => rows.filter((row) => row.key !== field.key))}>
                <Trash2Icon aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        ))}
        {fields.length < 10 ? (
          <div>
            <Button type="button" variant="outline" onClick={() => setFields((rows) => [...rows, { key: `f${(counter += 1)}`, label: "", kind: "TEXT", options: "", required: false }])}>
              <PlusIcon aria-hidden />
              Add a question
            </Button>
          </div>
        ) : null}
      </section>

      <div>
        <SubmitButton>Save admission page</SubmitButton>
      </div>
    </ActionForm>
  );
}
