"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField } from "@/components/forms/fields";

import { saveAttentionSettingsAction, saveSignalSettingsAction } from "./actions";

/** School Admin: the Needs Attention threshold and how many of the last three tests count. */
export function AttentionSettingsForm({ percent, repeat }: { percent: number; repeat: number }) {
  return (
    <ActionForm action={saveAttentionSettingsAction}>
      <FieldRow>
        <TextField name="percent" label="Needs attention below (%)" type="number" min={1} max={99} defaultValue={String(percent)} required />
        <SelectField
          name="repeat"
          label="…or when this many of the last 3 tests are below it"
          defaultValue={String(repeat)}
          options={[
            { value: "2", label: "2 of the last 3" },
            { value: "3", label: "All 3" },
            { value: "1", label: "Latest test only" },
          ]}
          required
        />
      </FieldRow>
      <div>
        <SubmitButton variant="outline">Save rule</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** School Admin: the attendance threshold and the window it is measured over. */
export function SignalSettingsForm({ percent, days }: { percent: number; days: number }) {
  return (
    <ActionForm action={saveSignalSettingsAction}>
      <FieldRow>
        <TextField name="percent" label="Attendance needs attention below (%)" type="number" min={1} max={99} defaultValue={String(percent)} required />
        <TextField name="days" label="Over the last (days)" type="number" min={7} max={120} defaultValue={String(days)} required />
      </FieldRow>
      <div>
        <SubmitButton variant="outline">Save attendance rule</SubmitButton>
      </div>
    </ActionForm>
  );
}
