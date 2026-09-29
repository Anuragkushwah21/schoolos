"use client";

import { ActionForm } from "@/components/forms/action-form";
import {
  FieldRow,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "@/components/forms/fields";

import { sendInquiryAction } from "./contact-actions";
import { INQUIRY_TOPIC_OPTIONS } from "./topics";


/** The public enquiry form. Needs no account; the server rate-limits it. */
export function ContactForm({ defaultTopic }: { defaultTopic?: string }) {
  return (
    <ActionForm action={sendInquiryAction} resetOnSuccess className="gap-4">
      {/* Honeypot: hidden from people and screen readers, filled in by bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <FieldRow>
        <TextField name="name" label="Your name" autoComplete="name" required />
        <TextField name="schoolName" label="School name" autoComplete="organization" />
      </FieldRow>
      <FieldRow>
        <TextField name="email" label="Email" type="email" autoComplete="email" required />
        <TextField name="phone" label="Phone / WhatsApp" type="tel" autoComplete="tel" />
      </FieldRow>
      <FieldRow>
        <TextField name="city" label="City" autoComplete="address-level2" />
        <SelectField
          name="topic"
          label="What is this about?"
          options={INQUIRY_TOPIC_OPTIONS}
          defaultValue={defaultTopic ?? "DEMO"}
          required
        />
      </FieldRow>
      <TextareaField
        name="message"
        label="Message"
        rows={5}
        placeholder="Tell us about your school — number of students, what you want to manage, any questions."
        required
      />
      <div>
        <SubmitButton pendingLabel="Sending…">Send message</SubmitButton>
      </div>
    </ActionForm>
  );
}
