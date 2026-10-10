"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { formatMoney } from "@/lib/format";
import { periodLabel, type BillingPeriodKey } from "@/lib/plan-catalog";

import { changeOrganizationPlanAction } from "./actions";

type Quote = { onRequest: boolean; planFeeMinor: number | null; billingPeriod: BillingPeriodKey; extraCampuses: number; extraTotalMinor: number | null; extraPeriod: BillingPeriodKey } | null;

export type PlanOption = {
  plan: { id: string; name: string };
  same: boolean;
  newlyEligible: string[];
  noLongerIncluded: string[];
  keptOn: Array<{ campus: string; module: string }>;
  featuresGained: string[];
  featuresLost: string[];
  quoteBefore: Quote;
  quoteAfter: Quote;
  allowanceBefore: string;
  allowanceAfter: string;
  limits: { studentsBefore: number | null; studentsAfter: number | null; teachersBefore: number | null; teachersAfter: number | null };
  overCap: { live: number; cap: number } | null;
  notOffered: boolean;
};

const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "TRIALING", label: "Trial" },
  { value: "PAST_DUE", label: "Payment overdue" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
];

function price(quote: Quote): string {
  if (!quote) return "No plan";
  if (quote.onRequest) return "Price on request";
  const fee = `${formatMoney(quote.planFeeMinor ?? 0)} / ${periodLabel(quote.billingPeriod)}`;
  return quote.extraCampuses && quote.extraTotalMinor !== null ? `${fee} + ${formatMoney(quote.extraTotalMinor)} / ${periodLabel(quote.extraPeriod)} for ${quote.extraCampuses} extra campus${quote.extraCampuses === 1 ? "" : "es"}` : fee;
}

const limit = (value: number | null) => (value === null ? "No limit" : value.toLocaleString("en-IN"));

/**
 * Change the organization's plan: pick a plan, read what changes, confirm.
 * Every campus moves together; no module is switched on by this.
 */
export function ChangeOrganizationPlanForm({ organizationId, currentPlanId, currentStatus, startsAt, endsAt, options }: { organizationId: string; currentPlanId: string | null; currentStatus: string | null; startsAt: string; endsAt: string; options: PlanOption[] }) {
  const [planId, setPlanId] = useState(currentPlanId ?? options[0]?.plan.id ?? "");
  const chosen = options.find((option) => option.plan.id === planId) ?? null;

  if (!options.length) return <p className="text-muted-foreground text-sm">No plan is published yet. Publish one under Plans &amp; Features first.</p>;

  return (
    <ActionForm action={changeOrganizationPlanAction} className="gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <FieldRow>
        <SelectField name="planId" label="Plan" options={options.map((option) => ({ value: option.plan.id, label: `${option.plan.name}${option.same ? " (current)" : ""}${option.notOffered ? " — closed to new schools" : ""}` }))} value={planId} onChange={(event) => setPlanId(event.target.value)} required />
        <SelectField name="status" label="Subscription status" options={STATUSES} defaultValue={currentStatus ?? "ACTIVE"} required />
      </FieldRow>
      <FieldRow>
        <TextField name="startsAt" label="Starts on" type="date" defaultValue={startsAt} required />
        <TextField name="endsAt" label="Ends on (optional)" type="date" defaultValue={endsAt} />
      </FieldRow>

      {chosen ? (
        <div className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-4 text-sm" aria-live="polite">
          <p className="font-semibold">{chosen.same ? "This is the current plan." : `What changes when moving to ${chosen.plan.name}`}</p>
          <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr_1fr]">
            <dt className="text-muted-foreground" />
            <dd className="text-muted-foreground text-xs font-semibold uppercase">Now</dd>
            <dd className="text-muted-foreground text-xs font-semibold uppercase">After</dd>
            <dt className="font-medium">Price</dt>
            <dd>{price(chosen.quoteBefore)}</dd>
            <dd>{price(chosen.quoteAfter)}</dd>
            <dt className="font-medium">Campuses</dt>
            <dd>{chosen.allowanceBefore}</dd>
            <dd>{chosen.allowanceAfter}</dd>
            <dt className="font-medium">Students per campus</dt>
            <dd>{limit(chosen.limits.studentsBefore)}</dd>
            <dd>{limit(chosen.limits.studentsAfter)}</dd>
            <dt className="font-medium">Teachers per campus</dt>
            <dd>{limit(chosen.limits.teachersBefore)}</dd>
            <dd>{limit(chosen.limits.teachersAfter)}</dd>
          </dl>
          {chosen.newlyEligible.length ? <p>{`Newly included: ${chosen.newlyEligible.join(", ")}. Not switched on by this — the school switches them on in Plan & billing.`}</p> : null}
          {chosen.noLongerIncluded.length ? <p>{`No longer included: ${chosen.noLongerIncluded.join(", ")}.${chosen.keptOn.length ? ` Kept on (until switched off): ${chosen.keptOn.map((row) => `${row.module} at ${row.campus}`).join("; ")}.` : ""}`}</p> : null}
          {chosen.featuresGained.length ? <p>{`Gains: ${chosen.featuresGained.join(", ")}.`}</p> : null}
          {chosen.featuresLost.length ? <p className="text-warning-strong">{`Loses: ${chosen.featuresLost.join(", ")}.`}</p> : null}
          {chosen.overCap ? (
            <label className="bg-warning-soft text-warning-strong flex items-start gap-2 rounded-lg border p-3">
              <input type="checkbox" name="confirmOverCap" required className="mt-0.5 size-4" />
              <span>{`This organization runs ${chosen.overCap.live} campuses; ${chosen.plan.name} allows ${chosen.overCap.cap}. Existing campuses stay, but no more can be added. Tick to confirm.`}</span>
            </label>
          ) : null}
        </div>
      ) : null}

      <TextareaField name="notes" label="Note (optional)" rows={2} placeholder="e.g. Paid by bank transfer on 10 Oct" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="checked" required className="mt-0.5 size-4" />
        <span>I have checked the comparison. Save the plan for every campus of this organization.</span>
      </label>
      <div>
        <SubmitButton pendingLabel="Saving…">Save plan</SubmitButton>
      </div>
    </ActionForm>
  );
}
