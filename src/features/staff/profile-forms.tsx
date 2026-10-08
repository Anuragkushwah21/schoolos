"use client";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, type SelectOption, SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { addStaffDocumentAction, changeStaffRoleAction, setDocumentVerificationAction } from "./profile-actions";

/** Change role, choosing whether the admin's own permission changes carry over. */
export function RoleChangeForm({ staffId, roles, currentRoleId }: { staffId: string; roles: SelectOption[]; currentRoleId: string | null }) {
  return (
    <ActionForm action={changeStaffRoleAction} className="gap-3">
      <input type="hidden" name="staffId" value={staffId} />
      <SelectField name="roleProfileId" label="New role" options={roles.filter((role) => role.value !== currentRoleId)} placeholder="Choose" required />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="keepCustom" defaultChecked className="accent-primary mt-0.5 size-4" />
        <span>
          Keep my custom changes
          <span className="text-muted-foreground block text-xs">
            Ticked: the new role&apos;s defaults, plus what you added for this person, minus what you removed. Unticked: exactly the new role&apos;s defaults.
          </span>
        </span>
      </label>
      <div>
        <SubmitButton variant="outline">Change role</SubmitButton>
      </div>
    </ActionForm>
  );
}

const DOC_TYPES: SelectOption[] = [
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "PAN", label: "PAN" },
  { value: "QUALIFICATION", label: "Qualification certificate" },
  { value: "EXPERIENCE", label: "Experience certificate" },
  { value: "PREVIOUS_EMPLOYMENT", label: "Previous employment certificate" },
  { value: "APPOINTMENT_LETTER", label: "Appointment letter" },
  { value: "JOINING", label: "Joining document" },
  { value: "OTHER", label: "Other document" },
];

export function StaffDocumentForm({ staffId }: { staffId: string }) {
  return (
    <ActionForm action={addStaffDocumentAction} className="gap-3" resetOnSuccess>
      <input type="hidden" name="staffId" value={staffId} />
      <FieldRow>
        <SelectField name="type" label="Document" options={DOC_TYPES} defaultValue="AADHAAR" required />
        <TextField name="label" label="Name (optional)" placeholder="B.Ed. certificate" />
      </FieldRow>
      <div className="flex flex-col gap-2">
        <Label htmlFor="staff-doc-file">File (PDF, JPG or PNG, up to 10 MB)</Label>
        <Input id="staff-doc-file" type="file" name="file" accept="application/pdf,image/jpeg,image/png" required />
      </div>
      <TextField name="notes" label="Notes" />
      <div>
        <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DocumentVerificationForm({ documentId, verification }: { documentId: string; verification: string }) {
  return (
    <ActionForm action={setDocumentVerificationAction} className="flex-row flex-wrap items-end gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <SelectField
        name="verification"
        label="Status"
        defaultValue={verification}
        options={[
          { value: "PENDING", label: "Not checked" },
          { value: "VERIFIED", label: "Verified" },
          { value: "REJECTED", label: "Rejected" },
        ]}
        className="w-40"
      />
      <SubmitButton size="sm" variant="outline">
        Save
      </SubmitButton>
    </ActionForm>
  );
}
