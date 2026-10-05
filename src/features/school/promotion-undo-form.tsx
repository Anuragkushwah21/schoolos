"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";

import { reversePromotionAction } from "./promotion-actions";

export function PromotionUndoForm({ runId, count }: { runId: string; count: number }) {
  return (
    <ActionForm action={reversePromotionAction}>
      <input type="hidden" name="runId" value={runId} />
      <TextField name="reason" label="Why is this promotion being undone?" placeholder="Promoted to the wrong class" maxLength={300} required />
      <div>
        <SubmitButton variant="destructive" pendingLabel="Undoing…">
          Undo for {count} student{count === 1 ? "" : "s"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
