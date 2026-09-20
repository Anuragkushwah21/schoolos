"use client";

import { ActionForm } from "@/components/forms/action-form";
import {
  CheckboxField,
  FieldRow,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";

import { saveEventAction, saveNoticeAction } from "./actions";

const FORMAT_HINT = "Blank line for a new paragraph. Start lines with - for a list, **bold**, [link](https://…).";

export function NoticeForm({
  notice,
}: {
  notice?: {
    id: string;
    title: string;
    body: string;
    audience: string;
    status: string;
    isPublic: boolean;
    publishAt: string;
    expiresAt: string;
  };
}) {
  return (
    <ActionForm action={saveNoticeAction} className="max-w-3xl">
      {notice ? <input type="hidden" name="noticeId" value={notice.id} /> : null}
      <TextField name="title" label="Title" defaultValue={notice?.title} required />
      <TextareaField name="body" label="Notice" defaultValue={notice?.body} rows={8} hint={FORMAT_HINT} required />
      <FieldRow>
        <SelectField
          name="audience"
          label="Who sees it after signing in"
          defaultValue={notice?.audience ?? "ALL"}
          options={[
            { value: "ALL", label: "Everyone" },
            { value: "TEACHERS", label: "Teachers" },
            { value: "STUDENTS", label: "Students" },
            { value: "PARENTS", label: "Parents" },
          ]}
          required
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={notice?.status ?? "PUBLISHED"}
          options={[
            { value: "DRAFT", label: "Draft — not visible" },
            { value: "PUBLISHED", label: "Published" },
            { value: "ARCHIVED", label: "Archived — hidden" },
          ]}
          required
        />
      </FieldRow>
      <FieldRow>
        <TextField name="publishAt" label="Publish on" type="date" defaultValue={notice?.publishAt} hint="Leave blank to publish immediately." />
        <TextField name="expiresAt" label="Hide after" type="date" defaultValue={notice?.expiresAt} hint="Leave blank to keep it up." />
      </FieldRow>
      <CheckboxField
        name="isPublic"
        label="Also show on the school website"
        hint="Anyone on the internet can read public notices. Never include personal details."
        defaultChecked={notice?.isPublic}
      />
      <div>
        <SubmitButton>Save notice</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EventForm({
  event,
}: {
  event?: {
    id: string;
    title: string;
    description: string | null;
    date: string;
    startMinute: string;
    endMinute: string;
    location: string | null;
    imageUrl: string | null;
    isPublished: boolean;
  };
}) {
  return (
    <ActionForm action={saveEventAction} className="max-w-3xl">
      {event ? <input type="hidden" name="eventId" value={event.id} /> : null}
      <TextField name="title" label="Title" defaultValue={event?.title} required />
      <TextareaField name="description" label="Description" defaultValue={event?.description ?? ""} rows={4} hint={FORMAT_HINT} />
      <FieldRow>
        <TextField name="date" label="Date" type="date" defaultValue={event?.date} required />
        <TextField name="location" label="Location" defaultValue={event?.location ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="startMinute" label="Starts" type="time" defaultValue={event?.startMinute} />
        <TextField name="endMinute" label="Ends" type="time" defaultValue={event?.endMinute} />
      </FieldRow>
      <TextField name="imageUrl" label="Image link" placeholder="https://…" defaultValue={event?.imageUrl ?? ""} />
      <CheckboxField
        name="isPublished"
        label="Published"
        hint="Published events appear on dashboards and the school website."
        defaultChecked={event?.isPublished ?? true}
      />
      <div>
        <SubmitButton>Save event</SubmitButton>
      </div>
    </ActionForm>
  );
}
