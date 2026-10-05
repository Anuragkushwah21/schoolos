"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField } from "@/components/forms/fields";

import { markCopyConditionAction } from "./actions";

/** Report one copy lost or damaged. On loan, its loan closes (with an optional replacement charge). */
export function CopyConditionForm({ copyId, onLoan }: { copyId: string; onLoan: boolean }) {
  return (
    <details className="text-xs">
      <summary className="text-muted-foreground cursor-pointer">Report lost or damaged</summary>
      <ActionForm action={markCopyConditionAction} className="mt-2 gap-3">
        <input type="hidden" name="copyId" value={copyId} />
        <FieldRow>
          <SelectField
            name="condition"
            label="What happened"
            options={[
              { value: "LOST", label: "Lost" },
              { value: "DAMAGED", label: "Damaged" },
            ]}
            required
          />
          <TextField name="note" label="Note" placeholder="Water damage, cover torn" maxLength={300} required />
        </FieldRow>
        {onLoan ? <TextField name="chargeRupees" label="Replacement charge (₹, optional)" type="number" min={0} hint="Added to the borrower's loan as a fine." /> : null}
        <div>
          <SubmitButton variant="destructive" pendingLabel="Saving…">
            Take out of stock
          </SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
