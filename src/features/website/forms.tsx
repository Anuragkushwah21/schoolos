"use client";

import { ActionForm } from "@/components/forms/action-form";
import {
  CheckboxField,
  FieldRow,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";

import { addMediaAction, savePageAction, updateWebsiteProfileAction } from "./actions";

const FORMAT_HINT = "Blank line for a new paragraph. # Heading, - list item, **bold**, [link](https://…).";

type Profile = {
  name: string;
  shortName: string | null;
  about: string | null;
  principalName: string | null;
  principalMessage: string | null;
  establishedYear: number | null;
  affiliationBoard: string | null;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-5 rounded-xl border p-5">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function WebsiteProfileForm({ profile }: { profile: Profile }) {
  return (
    <ActionForm action={updateWebsiteProfileAction}>
      <Group title="School">
        <FieldRow>
          <TextField name="name" label="School name" defaultValue={profile.name} required />
          <TextField name="shortName" label="Short name" defaultValue={profile.shortName ?? ""} />
        </FieldRow>
        <FieldRow>
          <TextField name="affiliationBoard" label="Board" defaultValue={profile.affiliationBoard ?? ""} />
          <TextField name="establishedYear" label="Established" inputMode="numeric" defaultValue={profile.establishedYear ?? ""} />
        </FieldRow>
        <TextareaField name="about" label="About the school" defaultValue={profile.about ?? ""} rows={5} hint={FORMAT_HINT} />
      </Group>

      <Group title="Principal">
        <TextField name="principalName" label="Principal's name" defaultValue={profile.principalName ?? ""} />
        <TextareaField name="principalMessage" label="Message" defaultValue={profile.principalMessage ?? ""} rows={4} />
      </Group>

      <Group title="Public contact details">
        <FieldRow>
          <TextField name="email" label="Email" type="email" defaultValue={profile.email ?? ""} />
          <TextField name="phone" label="Phone" type="tel" defaultValue={profile.phone ?? ""} />
        </FieldRow>
        <TextField name="addressLine" label="Address" defaultValue={profile.addressLine ?? ""} />
        <FieldRow>
          <TextField name="city" label="City" defaultValue={profile.city ?? ""} />
          <TextField name="state" label="State" defaultValue={profile.state ?? ""} />
        </FieldRow>
        <FieldRow>
          <TextField name="postalCode" label="PIN code" defaultValue={profile.postalCode ?? ""} />
          <div />
        </FieldRow>
      </Group>

      <Group title="Branding">
        <FieldRow>
          <TextField name="logoUrl" label="Logo image link" placeholder="https://…" defaultValue={profile.logoUrl ?? ""} />
          <TextField name="bannerUrl" label="Banner image link" placeholder="https://…" defaultValue={profile.bannerUrl ?? ""} />
        </FieldRow>
        <FieldRow>
          <TextField name="primaryColor" label="Main colour" type="color" defaultValue={profile.primaryColor} className="[&_input]:h-10 [&_input]:w-24 [&_input]:p-1" required />
          <TextField name="secondaryColor" label="Accent colour" type="color" defaultValue={profile.secondaryColor} className="[&_input]:h-10 [&_input]:w-24 [&_input]:p-1" required />
        </FieldRow>
      </Group>

      <div>
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PageForm({
  page,
}: {
  page?: { id: string; title: string; slug: string; body: string; sortOrder: number; isPublished: boolean };
}) {
  return (
    <ActionForm action={savePageAction} className="max-w-3xl">
      {page ? <input type="hidden" name="pageId" value={page.id} /> : null}
      <FieldRow>
        <TextField name="title" label="Title" defaultValue={page?.title} required />
        <TextField name="slug" label="Web address" placeholder="fee-structure" defaultValue={page?.slug} hint="Appears after your school's address." required />
      </FieldRow>
      <TextareaField name="body" label="Content" defaultValue={page?.body} rows={14} hint={FORMAT_HINT} required />
      <FieldRow>
        <TextField name="sortOrder" label="Menu order" inputMode="numeric" defaultValue={page?.sortOrder ?? 0} />
        <div />
      </FieldRow>
      <CheckboxField name="isPublished" label="Published" hint="Published pages appear in the website menu." defaultChecked={page?.isPublished ?? true} />
      <div>
        <SubmitButton>Save page</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function MediaForm() {
  return (
    <ActionForm action={addMediaAction} resetOnSuccess className="gap-3">
      <FieldRow>
        <TextField name="url" label="Image link" placeholder="https://…" required />
        <TextField name="caption" label="Caption" />
      </FieldRow>
      <div>
        <SubmitButton variant="outline">Add photo</SubmitButton>
      </div>
    </ActionForm>
  );
}
