"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton } from "@/components/forms/fields";

import { carryForwardAllAction } from "./family-actions";

/** Carry forward every listed balance — for one section, or the whole school. */
export function CarryForwardAllForm({ sections }: { sections: Array<{ value: string; label: string }> }) {
  return (
    <ActionForm action={carryForwardAllAction} className="gap-3">
      <SelectField name="sectionId" label="Section" options={sections} placeholder="Every section" />
      <div>
        <SubmitButton variant="outline" pendingLabel="Carrying forward…">
          Carry forward all listed balances
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
