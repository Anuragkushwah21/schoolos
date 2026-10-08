"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon, UserRoundIcon } from "lucide-react";

import { ActionForm, useFormContext } from "@/components/forms/action-form";
import { FieldRow, PhoneField, SelectField, SubmitButton, TextField, TextareaField, type SelectOption } from "@/components/forms/fields";
import { FormSteps } from "@/components/forms/form-steps";
import { Button } from "@/components/ui/button";
import { rupees } from "@/features/finance/money";
import { DISCOUNT_REASONS, type DiscountKind, discountMinorFor, discountProblem, familyTotals, rupeesToMinor } from "@/lib/fee-discussion";
import { type StreamRule, streamRuleForLevel } from "@/lib/stream-rules";
import { cn } from "@/lib/utils";

import { createEnquiryAction, updateEnquiryAction } from "./enquiry-actions";
import { ClassBadge, StreamBadge } from "./enquiry-bits";

export type ClassOption = SelectOption & { level: number };

type ChildDraft = {
  key: string;
  id?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  classId: string;
  streamId: string;
  previousSchool: string;
  notes: string;
  feeOriginal: string;
  discountKind: DiscountKind;
  discountValue: string;
  discountReason: string;
};

export type EnquiryDefaults = {
  enquiryId: string;
  source: string;
  parentName: string;
  relationship: string;
  phone: string;
  alternatePhone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  notes: string | null;
  children: Array<Omit<ChildDraft, "key" | "feeOriginal" | "discountKind" | "discountValue" | "discountReason">>;
  /** Already admitted: shown, not editable, never removed. */
  admitted: Array<{ id: string; name: string; className: string }>;
};

const SOURCES: SelectOption[] = [
  { value: "WALK_IN", label: "Walk-in" },
  { value: "PHONE", label: "Phone" },
  { value: "WEBSITE", label: "Website" },
  { value: "REFERRAL", label: "Referral" },
  { value: "OTHER", label: "Other" },
];
const RELATIONSHIPS: SelectOption[] = [
  { value: "FATHER", label: "Father" },
  { value: "MOTHER", label: "Mother" },
  { value: "GUARDIAN", label: "Guardian" },
];
const GENDERS: SelectOption[] = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "OTHER", label: "Other" },
];
const DISCOUNT_OPTIONS: SelectOption[] = [
  { value: "NONE", label: "No discount" },
  { value: "FIXED", label: "Fixed amount (₹)" },
  { value: "PERCENT", label: "Percentage (%)" },
];

let counter = 0;
const newKey = () => `child-${Date.now()}-${(counter += 1)}`;
const emptyChild = (): ChildDraft => ({ key: newKey(), firstName: "", lastName: "", dateOfBirth: "", gender: "", classId: "", streamId: "", previousSchool: "", notes: "", feeOriginal: "", discountKind: "NONE", discountValue: "", discountReason: "" });

/** A child's figures from what is typed: paise, and any problem with the discount. */
function childFigures(child: Pick<ChildDraft, "feeOriginal" | "discountKind" | "discountValue">) {
  const original = rupeesToMinor(child.feeOriginal);
  const value = Math.round(Number(child.discountValue || 0) * 100);
  if (original === null) return { original: null, discount: 0, final: null, problem: child.discountKind !== "NONE" ? "Enter the discussed fee first" : null };
  const problem = discountProblem(original, child.discountKind, value);
  const discount = problem ? 0 : discountMinorFor(original, child.discountKind, value);
  return { original, discount, final: original - discount, problem };
}

/**
 * The stream choice for one class, following the rule: nothing for Nursery–8,
 * an optional choice for 9–10, a required one for 11–12 — from the school's
 * own streams. The server checks the same rule.
 */
export function StreamChoice({ name, rule, streams, value, onChange }: { name: string; rule: StreamRule | null; streams: SelectOption[]; value: string; onChange: (value: string) => void }) {
  const { fieldErrors } = useFormContext();
  if (rule === null) return <p className="text-muted-foreground self-end pb-2 text-sm">Choose a class to see if a stream applies.</p>;
  if (rule === "NONE" || (rule === "OPTIONAL" && !streams.length)) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Stream</span>
        <p className="text-muted-foreground flex min-h-9 items-center text-sm">Not applicable for this class</p>
        {fieldErrors?.[name] ? <p className="text-danger-strong text-xs">{fieldErrors[name]![0]}</p> : null}
      </div>
    );
  }
  if (rule === "REQUIRED" && !streams.length) {
    return <p className="text-danger-strong self-end pb-2 text-sm">Classes 11–12 need a stream, and none is set up. Add streams under Academics first.</p>;
  }
  return (
    <SelectField
      name={name}
      label={rule === "REQUIRED" ? "Stream" : "Stream (optional)"}
      options={streams}
      placeholder={rule === "REQUIRED" ? "Choose a stream…" : "No stream"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={rule === "REQUIRED"}
      hint={rule === "REQUIRED" ? "Required for Class 11 and 12" : "Optional for Class 9 and 10"}
    />
  );
}

function ChildDetails({ child, index, classes, streams, onChange, onRemove, canRemove }: { child: ChildDraft; index: number; classes: ClassOption[]; streams: SelectOption[]; onChange: (patch: Partial<ChildDraft>) => void; onRemove: () => void; canRemove: boolean }) {
  const klass = classes.find((row) => row.value === child.classId);
  const rule = klass ? streamRuleForLevel(klass.level) : null;
  const n = (field: string) => `children.${index}.${field}`;
  return (
    <div className="border-primary/20 from-primary-soft/40 flex flex-col gap-4 rounded-2xl border bg-gradient-to-br to-transparent p-4 sm:p-5">
      {child.id ? <input type="hidden" name={n("id")} value={child.id} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-full text-xs">{index + 1}</span>
          {child.firstName ? `${child.firstName} ${child.lastName}`.trim() : `Child ${index + 1}`}
          {klass ? <ClassBadge>{klass.label}</ClassBadge> : null}
        </p>
        {canRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2Icon aria-hidden />
            Remove child
          </Button>
        ) : null}
      </div>
      <FieldRow>
        <TextField name={n("firstName")} label="First name" required value={child.firstName} onChange={(event) => onChange({ firstName: event.target.value })} />
        <TextField name={n("lastName")} label="Last name" value={child.lastName} onChange={(event) => onChange({ lastName: event.target.value })} />
      </FieldRow>
      <FieldRow>
        <SelectField
          name={n("classId")}
          label="Class"
          options={classes}
          placeholder="Select…"
          required
          value={child.classId}
          onChange={(event) => onChange({ classId: event.target.value, streamId: "" })}
        />
        <StreamChoice name={n("streamId")} rule={rule} streams={streams} value={child.streamId} onChange={(streamId) => onChange({ streamId })} />
      </FieldRow>
      <FieldRow>
        <TextField name={n("dateOfBirth")} label="Date of birth (optional)" type="date" value={child.dateOfBirth} onChange={(event) => onChange({ dateOfBirth: event.target.value })} />
        <SelectField name={n("gender")} label="Gender (optional)" options={GENDERS} placeholder="Not given" value={child.gender} onChange={(event) => onChange({ gender: event.target.value })} />
      </FieldRow>
      <FieldRow>
        <TextField name={n("previousSchool")} label="Previous school (optional)" value={child.previousSchool} onChange={(event) => onChange({ previousSchool: event.target.value })} />
        <TextField name={n("notes")} label="Note (optional)" value={child.notes} onChange={(event) => onChange({ notes: event.target.value })} />
      </FieldRow>
    </div>
  );
}

function ChildFee({ child, index, classes, streams, onChange }: { child: ChildDraft; index: number; classes: ClassOption[]; streams: SelectOption[]; onChange: (patch: Partial<ChildDraft>) => void }) {
  const klass = classes.find((row) => row.value === child.classId);
  const stream = streams.find((row) => row.value === child.streamId);
  const figures = childFigures(child);
  const n = (field: string) => `children.${index}.${field}`;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {child.firstName || `Child ${index + 1}`} {child.lastName}
        {klass ? <ClassBadge>{klass.label}</ClassBadge> : null}
        {klass ? <StreamBadge rule={streamRuleForLevel(klass.level)} name={stream?.label} /> : null}
      </p>
      <FieldRow>
        <TextField name={n("feeOriginal")} label="Discussed fee (₹)" inputMode="decimal" placeholder="e.g. 40000" value={child.feeOriginal} onChange={(event) => onChange({ feeOriginal: event.target.value })} hint="Annual / admission fee as discussed. Leave blank if not discussed yet." />
        <SelectField name={n("discountKind")} label="Discount" options={DISCOUNT_OPTIONS} value={child.discountKind} onChange={(event) => onChange({ discountKind: event.target.value as DiscountKind, discountValue: "" })} />
      </FieldRow>
      {child.discountKind !== "NONE" ? (
        <FieldRow>
          <TextField name={n("discountValue")} label={child.discountKind === "PERCENT" ? "Discount (%)" : "Discount (₹)"} inputMode="decimal" required value={child.discountValue} onChange={(event) => onChange({ discountValue: event.target.value })} />
          <TextField name={n("discountReason")} label="Reason" list="discount-reasons" value={child.discountReason} onChange={(event) => onChange({ discountReason: event.target.value })} />
        </FieldRow>
      ) : null}
      {figures.problem ? <p className="text-danger-strong text-sm">{figures.problem}</p> : null}
      {figures.original !== null ? (
        <p className="bg-success-soft/60 text-sm rounded-lg px-3 py-2 tabular-nums">
          {rupees(figures.original)} − {rupees(figures.discount)} = <strong>{rupees(figures.final ?? 0)}</strong> final discussed
        </p>
      ) : null}
    </div>
  );
}

/**
 * Take (or correct) a family enquiry, step by step: the parent, the children
 * (add as many as the family has), the fee discussion, the follow-up, and a
 * review. Editing skips the fee and follow-up steps — those are changed on
 * the enquiry page, where every change is kept.
 */
export function EnquiryForm({
  classes,
  streams,
  assignees = [],
  today,
  defaults,
  allowFees = true,
}: {
  classes: ClassOption[];
  streams: SelectOption[];
  assignees?: SelectOption[];
  today: string;
  defaults?: EnquiryDefaults;
  /** Off for staff without "Discuss fees & discounts": no fee step (the server drops fee figures anyway). */
  allowFees?: boolean;
}) {
  const editing = Boolean(defaults);
  const [parent, setParent] = useState({ parentName: defaults?.parentName ?? "", phone: defaults?.phone ?? "" });
  const [children, setChildren] = useState<ChildDraft[]>(() =>
    defaults ? defaults.children.map((child) => ({ ...emptyChild(), ...child })) : [emptyChild()],
  );
  const [family, setFamily] = useState<{ kind: DiscountKind; value: string }>({ kind: "NONE", value: "" });
  const [followUp, setFollowUp] = useState({ date: "", action: "" });

  const update = (key: string, patch: Partial<ChildDraft>) => setChildren((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => setChildren((rows) => rows.filter((row) => row.key !== key));
  const figures = children.map(childFigures);
  const totals = familyTotals(
    figures.map((row) => ({ feeOriginalMinor: row.original, discountMinor: row.discount, finalMinor: row.final })),
    { kind: family.kind, value: Math.round(Number(family.value || 0) * 100) },
  );
  const childCount = children.length + (defaults?.admitted.length ?? 0);

  const parentStep = {
    title: "Parent details",
    description: "One responsible parent, guardian or contact is enough.",
    content: (
      <>
        <FieldRow>
          <TextField name="parentName" label="Parent / guardian name" required autoComplete="off" value={parent.parentName} onChange={(event) => setParent({ ...parent, parentName: event.target.value })} />
          <SelectField name="relationship" label="Relationship" options={RELATIONSHIPS} defaultValue={defaults?.relationship ?? "FATHER"} required />
        </FieldRow>
        <FieldRow>
          <PhoneField name="phone" label="Mobile number" required value={parent.phone} onChange={(value) => setParent({ ...parent, phone: value })} />
          <TextField name="email" label="Email (optional)" type="email" defaultValue={defaults?.email ?? ""} />
        </FieldRow>
        <FieldRow>
          <PhoneField name="alternatePhone" label="Alternate contact (optional)" defaultValue={defaults?.alternatePhone ?? ""} />
          <SelectField name="source" label="Source" options={SOURCES} defaultValue={defaults?.source ?? "WALK_IN"} required />
        </FieldRow>
        <TextField name="addressLine" label="Address (optional)" defaultValue={defaults?.addressLine ?? ""} />
        <FieldRow>
          <TextField name="city" label="City" defaultValue={defaults?.city ?? ""} />
          <TextField name="state" label="State" defaultValue={defaults?.state ?? ""} />
        </FieldRow>
        <TextareaField name="notes" label="Enquiry notes (internal)" rows={2} defaultValue={defaults?.notes ?? ""} hint="Only the school office sees this." />
      </>
    ),
  };

  const childrenStep = {
    title: "Children",
    description: "Each child has their own class, stream and fee discussion. Nursery–8: no stream. Class 9–10: optional. Class 11–12: required.",
    content: (
      <>
        {defaults?.admitted.length ? (
          <div className="flex flex-col gap-2">
            {defaults.admitted.map((child) => (
              <p key={child.id} className="bg-success-soft/60 flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                <UserRoundIcon className="size-4" aria-hidden /> {child.name} · {child.className} — admitted (not editable here)
              </p>
            ))}
          </div>
        ) : null}
        <ChildrenErrors />
        {children.map((child, index) => (
          <ChildDetails key={child.key} child={child} index={index} classes={classes} streams={streams} onChange={(patch) => update(child.key, patch)} onRemove={() => remove(child.key)} canRemove={children.length + (defaults?.admitted.length ?? 0) > 1} />
        ))}
        <div>
          <Button type="button" variant="outline" onClick={() => setChildren((rows) => [...rows, emptyChild()])}>
            <PlusIcon aria-hidden />
            Add another child
          </Button>
        </div>
      </>
    ),
  };

  const feeStep = {
    title: "Fee discussion",
    description: "A discussion record only — no fee is charged and no invoice is made. Leave it blank if fees have not been discussed yet.",
    content: (
      <>
        <datalist id="discount-reasons">
          {DISCOUNT_REASONS.map((reason) => (
            <option key={reason} value={reason} />
          ))}
        </datalist>
        {children.map((child, index) => (
          <ChildFee key={child.key} child={child} index={index} classes={classes} streams={streams} onChange={(patch) => update(child.key, patch)} />
        ))}
        <div className="bg-muted/40 flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
          <p className="font-semibold">Family / sibling discount (optional)</p>
          <FieldRow>
            <SelectField name="familyDiscountKind" label="Family discount" options={DISCOUNT_OPTIONS} value={family.kind} onChange={(event) => setFamily({ kind: event.target.value as DiscountKind, value: "" })} />
            {family.kind !== "NONE" ? (
              <TextField name="familyDiscountValue" label={family.kind === "PERCENT" ? "Family discount (%)" : "Family discount (₹)"} inputMode="decimal" required value={family.value} onChange={(event) => setFamily({ ...family, value: event.target.value })} />
            ) : (
              <div />
            )}
          </FieldRow>
          {family.kind !== "NONE" ? <TextField name="familyDiscountReason" label="Reason" list="discount-reasons" defaultValue="Sibling admission" /> : null}
          <TextareaField name="discussionNotes" label="Discussion notes (internal)" rows={2} hint="Never shown publicly." />
          <FamilySummary totals={totals} count={childCount} />
        </div>
      </>
    ),
  };

  const followUpStep = {
    title: "Follow-up",
    description: "Optional. When to get back to the family, and what happens next.",
    content: (
      <>
        <FieldRow>
          <TextField name="nextFollowUpOn" label="Next follow-up" type="date" min={today} value={followUp.date} onChange={(event) => setFollowUp({ ...followUp, date: event.target.value })} />
          {assignees.length ? <SelectField name="assignedToId" label="Assigned to" options={assignees} placeholder="Nobody yet" /> : <div />}
        </FieldRow>
        <TextField name="nextAction" label="Next action" placeholder="e.g. Parent will visit with documents" value={followUp.action} onChange={(event) => setFollowUp({ ...followUp, action: event.target.value })} />
      </>
    ),
  };

  const reviewStep = {
    title: "Review & save",
    content: (
      <div className="flex flex-col gap-4 text-sm">
        <p>
          <strong>{parent.parentName || "—"}</strong> · {parent.phone || "no mobile"} · {childCount} {childCount === 1 ? "child" : "children"}
        </p>
        <ul className="flex flex-col gap-2">
          {children.map((child, index) => {
            const klass = classes.find((row) => row.value === child.classId);
            const stream = streams.find((row) => row.value === child.streamId);
            const fee = figures[index]!;
            return (
              <li key={child.key} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
                <span className="font-medium">{`${child.firstName} ${child.lastName}`.trim() || `Child ${index + 1}`}</span>
                {klass ? <ClassBadge>{klass.label}</ClassBadge> : <span className="text-danger-strong">No class chosen</span>}
                {klass ? <StreamBadge rule={streamRuleForLevel(klass.level)} name={stream?.label} /> : null}
                {!editing && fee.final !== null ? (
                  <span className="ml-auto tabular-nums">
                    {rupees(fee.original ?? 0)} − {rupees(fee.discount)} = <strong>{rupees(fee.final)}</strong>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!editing && totals.discussedChildren ? <FamilySummary totals={totals} count={childCount} /> : null}
        {!editing && followUp.date ? (
          <p className="text-muted-foreground">
            Next follow-up {followUp.date}
            {followUp.action ? ` — ${followUp.action}` : ""}
          </p>
        ) : null}
      </div>
    ),
  };

  return (
    <ActionForm action={editing ? updateEnquiryAction : createEnquiryAction} className="max-w-4xl">
      {defaults ? <input type="hidden" name="enquiryId" value={defaults.enquiryId} /> : null}
      <FormSteps
        steps={editing ? [parentStep, childrenStep, reviewStep] : allowFees ? [parentStep, childrenStep, feeStep, followUpStep, reviewStep] : [parentStep, childrenStep, followUpStep, reviewStep]}
        submit={
          <SubmitButton pendingLabel="Saving…" size="lg">
            {editing ? "Save changes" : "Save enquiry"}
          </SubmitButton>
        }
      />
    </ActionForm>
  );
}

function ChildrenErrors() {
  const { fieldErrors } = useFormContext();
  const messages = fieldErrors?.children;
  return messages?.length ? <p className="text-danger-strong text-sm" aria-invalid="true">{messages[0]}</p> : null;
}

export function FamilySummary({ totals, count, className }: { totals: ReturnType<typeof familyTotals>; count: number; className?: string }) {
  return (
    <dl className={cn("ring-primary/25 bg-card grid grid-cols-2 gap-3 rounded-xl p-4 text-sm ring-2 sm:grid-cols-4", className)}>
      <div>
        <dt className="text-muted-foreground text-xs">Children</dt>
        <dd className="font-semibold">{count}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">Family discussed total</dt>
        <dd className="font-semibold tabular-nums">{rupees(totals.originalMinor)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">Total discount</dt>
        <dd className="text-success-strong font-semibold tabular-nums">
          {rupees(totals.totalDiscountMinor)}
          {totals.familyDiscountMinor ? <span className="text-muted-foreground block text-xs font-normal">incl. family {rupees(totals.familyDiscountMinor)}</span> : null}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">Final family discussion</dt>
        <dd className="text-primary-strong text-lg font-extrabold tabular-nums">{rupees(totals.finalMinor)}</dd>
      </div>
    </dl>
  );
}
