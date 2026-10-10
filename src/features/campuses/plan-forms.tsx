"use client";

import { useState } from "react";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextareaField, TextField } from "@/components/forms/fields";

import { cn } from "@/lib/utils";

import { approvePlanChangeAction, rejectPlanChangeAction, requestPlanChangeAction, setCampusModulesAction } from "./plan-actions";

/** "Request this plan" on a plan card. */
export function RequestPlanForm({ planId, planName }: { planId: string; planName: string }) {
  return (
    <ActionForm action={requestPlanChangeAction} className="gap-2">
      <input type="hidden" name="planId" value={planId} />
      <TextField name="note" label="Note for SchoolOS (optional)" placeholder="e.g. opening a second campus in April" />
      <div>
        <SubmitButton size="sm" pendingLabel="Sending…">{`Request ${planName}`}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Super Admin: approve (the plan changes now) or reject with a reason. */
export function PlanDecisionForms({ requestId }: { requestId: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ActionForm action={approvePlanChangeAction} className="gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <TextField name="reviewNote" label="Note (optional)" />
        <div>
          <SubmitButton size="sm" pendingLabel="Approving…">Approve & change plan</SubmitButton>
        </div>
      </ActionForm>
      <ActionForm action={rejectPlanChangeAction} className="gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <TextareaField name="reason" label="Reason for rejecting" rows={1} required />
        <div>
          <SubmitButton size="sm" variant="outline" pendingLabel="Rejecting…">
            Reject
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

/**
 * One campus's modules: eligible ones can be switched on or off; a module the
 * plan no longer includes but the campus still has is shown as kept, and
 * can be switched off (not back on). Saving asks for confirmation.
 */
export function CampusModulesForm({ schoolId, campusName, eligible, enabled, labels }: { schoolId: string; campusName: string; eligible: string[]; enabled: string[]; labels: Record<string, { label: string; hint: string }> }) {
  const [selected, setSelected] = useState<string[]>(enabled);
  const shown = [...eligible, ...enabled.filter((key) => !eligible.includes(key))];
  const added = selected.filter((key) => !enabled.includes(key));
  const removed = enabled.filter((key) => !selected.includes(key));
  const fields: Record<string, string | string[]> = { schoolId, modules: selected };
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((key) => {
          const kept = !eligible.includes(key);
          const on = selected.includes(key);
          return (
            <li key={key}>
              <label className={cn("flex h-full items-start gap-2.5 rounded-lg border p-2.5 text-sm", on ? "border-success/40 bg-success-soft/50" : "bg-muted/30", kept && !on ? "opacity-60" : "cursor-pointer")}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={kept && !on}
                  onChange={(event) => setSelected(event.target.checked ? [...selected, key] : selected.filter((row) => row !== key))}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="block font-medium">{labels[key]?.label ?? key}</span>
                  <span className="text-muted-foreground block text-xs">{kept ? "Not in your current plan — kept for now; once switched off it needs the plan again." : enabled.includes(key) ? `On · ${labels[key]?.hint ?? ""}` : "Included in your plan — off for this campus. Tick to switch it on."}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!shown.length ? <p className="text-muted-foreground text-sm">Your plan has no optional modules. Core modules are always on.</p> : null}
      <div>
        <ActionButton
          action={setCampusModulesAction}
          fields={fields}
          disabled={!added.length && !removed.length}
          confirm={{
            title: `Change modules for ${campusName}?`,
            description: `${added.length ? `Switch on: ${added.map((key) => labels[key]?.label ?? key).join(", ")}. ` : ""}${removed.length ? `Switch off: ${removed.map((key) => labels[key]?.label ?? key).join(", ")} — its pages close for everyone at this campus; records are kept. ` : ""}This does not change your plan or your bill.`,
            confirmLabel: "Save modules",
          }}
        >
          Save modules
        </ActionButton>
      </div>
    </div>
  );
}
