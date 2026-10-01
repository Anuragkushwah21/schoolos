"use client";

import { InfoIcon, SendIcon, UserCheckIcon } from "lucide-react";
import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton, TextareaField } from "@/components/forms/fields";
import { useT } from "@/components/i18n/i18n-provider";

import { assignConcernAction, raiseParentConcernAction, raiseTeacherConcernAction, replyConcernAction, requestConcernUpdateAction } from "./actions";

type Option = { value: string; label: string };

/**
 * Parent: child → subject → concern → submit. There is no teacher to choose:
 * the form says who will receive it, or that it goes to the School Admin
 * because nobody teaches that subject to the child's class.
 */
export function ParentConcernForm({
  childOptions: children,
  defaultChildId,
}: {
  childOptions: Array<{ id: string; name: string; group: string; subjects: Array<{ value: string; label: string; teacher: string | null }> }>;
  defaultChildId?: string;
}) {
  const t = useT();
  const [childId, setChildId] = useState(defaultChildId && children.some((c) => c.id === defaultChildId) ? defaultChildId : (children[0]?.id ?? ""));
  const child = children.find((row) => row.id === childId);
  const [subjectId, setSubjectId] = useState("");
  const subject = child?.subjects.find((row) => row.value === subjectId);

  return (
    <ActionForm action={raiseParentConcernAction} className="gap-4">
      <SelectField
        name="studentId"
        label={t("concerns.child")}
        options={children.map((row) => ({ value: row.id, label: `${row.name} · ${row.group}` }))}
        value={childId}
        onChange={(event) => {
          setChildId(event.target.value);
          setSubjectId("");
        }}
        required
      />
      <SelectField
        key={childId}
        name="subjectId"
        label={t("concerns.subject")}
        options={(child?.subjects ?? []).map((row) => ({ value: row.value, label: row.label }))}
        placeholder="—"
        value={subjectId}
        onChange={(event) => setSubjectId(event.target.value)}
        required
      />
      {subject && child ? (
        subject.teacher ? (
          <p className="bg-info-soft text-info-strong flex items-start gap-2 rounded-lg px-3 py-2 text-sm" role="status">
            <UserCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("concerns.goesTo", { teacher: subject.teacher, subject: subject.label, child: child.name.split(" ")[0] ?? child.name })}
          </p>
        ) : (
          <p className="bg-warning-soft text-warning-strong flex items-start gap-2 rounded-lg px-3 py-2 text-sm" role="status">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("concerns.noTeacher")}
          </p>
        )
      ) : null}
      <TextareaField name="message" label={t("concerns.concern")} placeholder={t("concerns.messagePlaceholder")} rows={4} required />
      <div>
        <SubmitButton size="lg" pendingLabel={t("concerns.sending")}>
          <SendIcon aria-hidden />
          {t("concerns.submit")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * Teacher: one list of the students they teach, each with the subject they
 * teach them — so the subject comes from the assignment, never a free choice.
 * The server checks the same again.
 */
export function TeacherConcernForm({ students }: { students: Array<{ value: string; label: string; subjects: Option[] }> }) {
  const t = useT();
  const pairs = students.flatMap((student) =>
    student.subjects.map((subject) => ({ value: `${student.value}|${subject.value}`, label: `${student.label} — ${subject.label}`, studentId: student.value, subjectId: subject.value, subject: subject.label })),
  );
  const [choice, setChoice] = useState(pairs[0]?.value ?? "");
  const picked = pairs.find((pair) => pair.value === choice);
  return (
    <ActionForm action={raiseTeacherConcernAction} className="gap-4">
      <input type="hidden" name="studentId" value={picked?.studentId ?? ""} />
      <input type="hidden" name="subjectId" value={picked?.subjectId ?? ""} />
      <SelectField name="pair" label={t("concerns.studentAndSubject")} options={pairs} value={choice} onChange={(event) => setChoice(event.target.value)} required />
      {picked ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{t("concerns.subject")}: </span>
          <span className="font-medium">{picked.subject}</span>
        </p>
      ) : null}
      <TextareaField name="message" label={t("concerns.concern")} placeholder={t("concerns.messagePlaceholder")} rows={4} required />
      <div>
        <SubmitButton size="lg" pendingLabel={t("concerns.sending")}>
          <SendIcon aria-hidden />
          {t("concerns.submit")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** [Mark In Progress] [Mark Resolved] — or [Reopen] once resolved. */
export function ConcernStatusButtons({ concernId, status, withNote = false }: { concernId: string; status: string; withNote?: boolean }) {
  const t = useT();
  return (
    <ActionForm action={replyConcernAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="concernId" value={concernId} />
      {withNote ? <TextareaField name="message" label={t("concerns.noteOptional")} rows={2} /> : null}
      <div className="flex flex-wrap gap-2">
        {status === "OPEN" ? (
          <SubmitButton variant="outline" size="sm" name="status" value="IN_PROGRESS" pendingLabel={t("concerns.sending")}>
            {t("concerns.markInProgress")}
          </SubmitButton>
        ) : null}
        {status === "OPEN" || status === "IN_PROGRESS" ? (
          <SubmitButton size="sm" name="status" value="RESOLVED" pendingLabel={t("concerns.sending")}>
            {t("concerns.markResolved")}
          </SubmitButton>
        ) : null}
        {status === "RESOLVED" ? (
          <SubmitButton variant="outline" size="sm" name="status" value="IN_PROGRESS" pendingLabel={t("concerns.sending")}>
            {t("concerns.reopen")}
          </SubmitButton>
        ) : null}
      </div>
    </ActionForm>
  );
}

/** School Admin: "Request Action" — the teacher is notified. */
export function RequestUpdateForm({ concernId }: { concernId: string }) {
  const t = useT();
  return (
    <ActionForm action={requestConcernUpdateAction} className="gap-2">
      <input type="hidden" name="concernId" value={concernId} />
      <p className="text-muted-foreground text-sm">{t("concerns.requestUpdateHint")}</p>
      <div>
        <SubmitButton pendingLabel={t("concerns.sending")}>{t("concerns.requestUpdate")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** School Admin: hand the concern to a teacher (e.g. one that came to the office). */
export function AssignConcernForm({ concernId, teachers, current }: { concernId: string; teachers: Option[]; current: string | null }) {
  const t = useT();
  return (
    <ActionForm action={assignConcernAction} className="gap-3">
      <input type="hidden" name="concernId" value={concernId} />
      <SelectField name="teacherId" label={t("concerns.assignTeacher")} options={teachers} defaultValue={current ?? undefined} placeholder="—" required />
      <div>
        <SubmitButton variant="outline" pendingLabel={t("concerns.sending")}>
          {t("concerns.assign")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
