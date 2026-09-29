"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextareaField, TextField } from "@/components/forms/fields";
import { useT, useTranslateDynamic } from "@/components/i18n/i18n-provider";
import { humanize } from "@/lib/format";
import { CONCERN_REASONS, SUPPORT_ACTIONS, SUPPORT_PRIORITIES, SUPPORT_REASONS, SUPPORT_STATUSES } from "@/lib/validation/support";

import { createSupportAction, followUpSupportAction, raiseConcernAction, reviewConcernAction } from "./actions";

type Option = { value: string; label: string };

function useLabels() {
  const translate = useTranslateDynamic();
  return {
    reason: (value: string) => translate(`support.reason.${value}`, humanize(value)),
    action: (value: string) => translate(`support.action.${value}`, humanize(value)),
    status: (value: string) => translate(`status.${value}`, humanize(value)),
  };
}

/**
 * Add support: student → subject → reason → what will be done → save. The
 * less common details (topic, notes, priority) are there but optional.
 */
export function SupportForm({
  students,
  subjects,
  teachers,
  defaults = {},
}: {
  students: Option[];
  subjects: Option[];
  /** Only for the School Admin, who may name the teacher. */
  teachers?: Option[];
  defaults?: { studentId?: string; subjectId?: string | null; concernId?: string; reason?: string };
}) {
  const t = useT();
  const label = useLabels();
  const [reason, setReason] = useState(defaults.reason ?? "NEEDS_PRACTICE");

  return (
    <ActionForm action={createSupportAction} className="max-w-2xl">
      {defaults.concernId ? <input type="hidden" name="concernId" value={defaults.concernId} /> : null}
      <SelectField name="studentId" label={t("support.student")} options={students} defaultValue={defaults.studentId} placeholder="—" required />
      <FieldRow>
        <SelectField name="subjectId" label={t("support.subject")} options={subjects} defaultValue={defaults.subjectId ?? ""} placeholder={t("support.general")} />
        <TextField name="topic" label={t("support.topic")} placeholder={t("support.topicPlaceholder")} />
      </FieldRow>
      <FieldRow>
        <SelectField
          name="reason"
          label={t("support.reasonLabel")}
          options={SUPPORT_REASONS.map((value) => ({ value, label: label.reason(value) }))}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
        <SelectField
          name="action"
          label={t("support.actionLabel")}
          options={SUPPORT_ACTIONS.map((value) => ({ value, label: label.action(value) }))}
          defaultValue="EXTRA_PRACTICE"
          required
        />
      </FieldRow>
      {reason === "OTHER" ? <TextField name="reasonNote" label={t("support.reasonNote")} required /> : null}
      <FieldRow>
        <SelectField
          name="priority"
          label={t("support.priorityLabel")}
          options={SUPPORT_PRIORITIES.map((value) => ({ value, label: label.status(value) }))}
          defaultValue="MEDIUM"
        />
        {teachers?.length ? <SelectField name="teacherId" label={t("support.teacher")} options={teachers} placeholder="—" /> : <div />}
      </FieldRow>
      <TextareaField name="actionNote" label={`${t("support.actionNote")} (${t("common.optional")})`} rows={2} />
      <div>
        <SubmitButton size="lg" pendingLabel={t("support.saving")}>
          {t("support.save")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** A follow-up: what happened, and optionally a new status. */
export function FollowUpForm({ supportId, current }: { supportId: string; current: string }) {
  const t = useT();
  const label = useLabels();
  return (
    <ActionForm action={followUpSupportAction} resetOnSuccess className="gap-4">
      <input type="hidden" name="supportId" value={supportId} />
      <TextareaField name="note" label={t("support.followUp")} placeholder={t("support.notePlaceholder")} rows={3} />
      <SelectField
        name="status"
        label={t("support.changeStatus")}
        options={SUPPORT_STATUSES.filter((value) => value !== current).map((value) => ({ value, label: label.status(value) }))}
        placeholder={t("support.keepStatus")}
      />
      <div>
        <SubmitButton pendingLabel={t("support.saving")}>{t("support.saveFollowUp")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * "Raise a concern": child → subject → what you noticed → optional message →
 * send. A concern asks the school to look; it labels nobody.
 */
export function ConcernForm({ childOptions, subjectsByChild }: { childOptions: Option[]; subjectsByChild: Record<string, Option[]> }) {
  const t = useT();
  const label = useLabels();
  const [child, setChild] = useState(childOptions[0]?.value ?? "");
  const subjects = subjectsByChild[child] ?? [];
  return (
    <ActionForm action={raiseConcernAction} resetOnSuccess className="gap-4">
      <SelectField name="studentId" label={t("support.child")} options={childOptions} value={child} onChange={(event) => setChild(event.target.value)} required />
      <SelectField key={child} name="subjectId" label={t("support.subject")} options={subjects} placeholder={t("support.general")} />
      <SelectField
        name="reason"
        label={t("support.reasonLabel")}
        options={CONCERN_REASONS.map((value) => ({ value, label: label.reason(value) }))}
        defaultValue="DIFFICULTY_UNDERSTANDING"
        required
      />
      <TextareaField name="message" label={t("support.message")} placeholder={t("support.messagePlaceholder")} rows={3} />
      <div>
        <SubmitButton size="lg" pendingLabel={t("support.saving")}>
          {t("support.raiseConcern")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Reply to a parent's concern and say where it stands. */
export function ConcernReviewForm({ concernId, status }: { concernId: string; status: string }) {
  const t = useT();
  return (
    <ActionForm action={reviewConcernAction} className="gap-3">
      <input type="hidden" name="concernId" value={concernId} />
      <TextareaField name="response" label={t("support.reply")} placeholder={t("support.replyPlaceholder")} rows={2} />
      <div className="flex flex-wrap gap-2">
        {status === "NEW" ? (
          <SubmitButton variant="outline" name="status" value="REVIEWING" pendingLabel={t("support.saving")}>
            {t("support.markReviewing")}
          </SubmitButton>
        ) : null}
        <SubmitButton variant="outline" name="status" value="ACTION_TAKEN" pendingLabel={t("support.saving")}>
          {t("support.markActionTaken")}
        </SubmitButton>
        <SubmitButton variant="outline" name="status" value="RESOLVED" pendingLabel={t("support.saving")}>
          {t("support.markResolved")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
