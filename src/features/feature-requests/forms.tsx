"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";

import { commentFeatureRequestAction, decideFeatureRequestAction, submitFeatureRequestAction } from "./actions";

const PRIORITIES = [
  { value: "LOW", label: "Low — nice to have" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High — affects daily work" },
  { value: "CRITICAL", label: "Critical — blocks us" },
];

export function FeatureRequestForm({ campuses, modules }: { campuses: Array<{ value: string; label: string }>; modules: Array<{ value: string; label: string }> }) {
  return (
    <ActionForm action={submitFeatureRequestAction} className="gap-4" resetOnSuccess>
      <TextField name="title" label="Feature title" required placeholder="e.g. Bus pass printing" />
      <TextareaField name="problem" label="What problem are you trying to solve?" rows={3} required />
      <TextareaField name="description" label="Describe what you would like" rows={4} required />
      <TextareaField name="expectedOutcome" label="What would a good result look like? (optional)" rows={2} />
      <FieldRow>
        <SelectField name="schoolId" label="Campus" options={campuses} placeholder="All campuses" />
        <SelectField name="moduleKey" label="Related module" options={modules} placeholder="Not sure" />
      </FieldRow>
      <SelectField name="priority" label="How important is it?" options={PRIORITIES} defaultValue="MEDIUM" />
      <TextareaField name="examples" label="Examples (optional)" rows={2} hint="Describe an example, or paste a link to a sample document. File uploads are not supported here yet." />
      <p className="text-muted-foreground text-xs">Your plan lets you request and track custom features. SchoolOS reviews each request; cost, scope and timeline are agreed with you before any work starts.</p>
      <div>
        <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FeatureReplyForm({ requestId, waiting }: { requestId: string; waiting: boolean }) {
  return (
    <ActionForm action={commentFeatureRequestAction} className="gap-3" resetOnSuccess>
      <input type="hidden" name="requestId" value={requestId} />
      <TextareaField name="body" label={waiting ? "Answer SchoolOS's question" : "Add a note for SchoolOS"} rows={3} required />
      <div>
        <SubmitButton size="sm" pendingLabel="Sending…">
          Send
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

const SCOPES = [
  { value: "CUSTOMER_SPECIFIC", label: "Customer-specific customization (this organization only)" },
  { value: "OPTIONAL_MODULE", label: "Optional module for selected organizations or plans" },
  { value: "STANDARD_FEATURE", label: "Standard feature for chosen plans" },
  { value: "PREMIUM_ADDON", label: "Premium add-on (priced separately)" },
];

export function FeatureDecisionForm({
  request,
  statuses,
  plans,
  organizations,
}: {
  request: { id: string; status: string; estimatedTimeline: string | null; estimatedCostMinor: number | null; costAgreed: boolean; potentialStandard: boolean; releaseScope: string | null; eligiblePlanIds: string[]; eligibleOrgIds: string[]; releaseNote: string | null; developedBy: string | null; testedBy: string | null };
  statuses: Array<{ value: string; label: string }>;
  plans: Array<{ value: string; label: string }>;
  organizations: Array<{ value: string; label: string }>;
}) {
  const [status, setStatus] = useState(request.status);
  return (
    <ActionForm action={decideFeatureRequestAction} className="gap-4">
      <input type="hidden" name="requestId" value={request.id} />
      <SelectField name="status" label="Status" options={statuses} value={status} onChange={(event) => setStatus(event.target.value)} />
      <TextareaField name="note" label={status === "NEEDS_INFO" ? "Question for the school" : status === "DECLINED" ? "Reason (the school sees it)" : "Note (optional)"} rows={2} />
      <CheckboxField name="internal" label="Internal note — not shown to the school" hint="Only when the status is not changing." />
      <FieldRow>
        <TextField name="estimatedTimeline" label="Estimated timeline" defaultValue={request.estimatedTimeline ?? ""} placeholder="e.g. 3–4 weeks" />
        <TextField name="estimatedCostRupees" label="Development cost (₹)" inputMode="decimal" defaultValue={request.estimatedCostMinor === null ? "" : request.estimatedCostMinor / 100} />
      </FieldRow>
      <CheckboxField name="costAgreed" label="Cost, scope and timeline agreed with the school" hint="Required before development starts." defaultChecked={request.costAgreed} />
      <CheckboxField name="potentialStandard" label="Could become a standard product feature" defaultChecked={request.potentialStandard} />
      <FieldRow>
        <TextField name="developedBy" label="Developed by" defaultValue={request.developedBy ?? ""} />
        <TextField name="testedBy" label="Tested by" defaultValue={request.testedBy ?? ""} />
      </FieldRow>
      <div className="flex flex-col gap-3 rounded-xl border p-4">
        <p className="text-sm font-semibold">After release</p>
        <p className="text-muted-foreground text-xs">Nobody gets a released feature because of the requester&apos;s plan. Decide what it becomes; for a standard feature, also add it to those plans in the Plan Builder.</p>
        <SelectField name="releaseScope" label="Released as" options={SCOPES} placeholder="Not decided" defaultValue={request.releaseScope ?? ""} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">Plans that get it</legend>
          <div className="flex flex-wrap gap-3">
            {plans.map((plan) => (
              <label key={plan.value} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="eligiblePlanIds" value={plan.value} defaultChecked={request.eligiblePlanIds.includes(plan.value)} className="size-4" />
                {plan.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">Organizations that get it</legend>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {organizations.map((org) => (
              <label key={org.value} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="eligibleOrgIds" value={org.value} defaultChecked={request.eligibleOrgIds.includes(org.value)} className="size-4" />
                {org.label}
              </label>
            ))}
          </div>
        </fieldset>
        <TextareaField name="releaseNote" label="Release note" defaultValue={request.releaseNote ?? ""} rows={2} />
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
