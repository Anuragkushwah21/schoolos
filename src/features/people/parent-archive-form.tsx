"use client";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";
import { setParentArchivedAction } from "@/features/school/people-actions";

/** Archive a parent whose children have all left (record kept, login closed), or restore one. */
export function ParentArchiveForm({ parentId, archived, blocked }: { parentId: string; archived: boolean; blocked: string | null }) {
  if (!archived && blocked) return <p className="text-muted-foreground text-sm">{blocked}</p>;
  return (
    <ActionForm action={setParentArchivedAction} className="gap-3">
      <input type="hidden" name="parentId" value={parentId} />
      <input type="hidden" name="archived" value={archived ? "false" : "true"} />
      {!archived ? <TextField name="reason" label="Reason (optional)" placeholder="All children have left" maxLength={300} /> : null}
      <div>
        <SubmitButton variant={archived ? "outline" : "destructive"}>{archived ? "Restore parent" : "Archive parent"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
