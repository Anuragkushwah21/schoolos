"use client";

import { CheckIcon, LockIcon } from "lucide-react";
import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/fields";
import { CORE_MODULES, OPTIONAL_MODULES, moduleLabel } from "@/lib/school-modules";
import { cn } from "@/lib/utils";

import { approveSchoolAction, setSchoolModulesAction } from "./actions";

/** The core modules: always on, shown with a lock — there is no switch for them. */
export function CoreModuleList({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={cn("grid gap-1.5 text-sm", compact ? "grid-cols-2" : "sm:grid-cols-2")}>
      {CORE_MODULES.map((module) => (
        <li key={module.key} className="flex items-center gap-2" title={module.hint}>
          <CheckIcon className="text-success size-4 shrink-0" aria-hidden />
          {module.label}
          <LockIcon className="text-muted-foreground size-3" aria-label="Always included" />
        </li>
      ))}
    </ul>
  );
}

/** Optional modules as checkboxes named `optionalModules`; read-only when `disabled`. */
/** `inPlan`, when given, labels each module "In plan" or "Not in plan" — apart from whether it is ticked (on). */
export function OptionalModuleChecks({ selected, onChange, disabled = false, inPlan }: { selected: readonly string[]; onChange?: (next: string[]) => void; disabled?: boolean; inPlan?: readonly string[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {OPTIONAL_MODULES.map((module) => {
        const on = selected.includes(module.key);
        return (
          <li key={module.key}>
            <label className={cn("flex h-full items-start gap-2.5 rounded-lg border p-2.5 text-sm", on ? "border-success/40 bg-success-soft/50" : "bg-muted/30", disabled ? "cursor-default" : "cursor-pointer")}>
              <input
                type="checkbox"
                name="optionalModules"
                value={module.key}
                checked={on}
                disabled={disabled}
                onChange={(event) => onChange?.(event.target.checked ? [...selected, module.key] : selected.filter((key) => key !== module.key))}
                className="mt-0.5 size-4"
              />
              {/* A disabled checkbox is not submitted: the ticked set travels as hidden fields instead. */}
              {disabled && on ? <input type="hidden" name="optionalModules" value={module.key} /> : null}
              <span>
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {module.label}
                  {inPlan ? <span className={cn("rounded-full px-1.5 text-[11px]", inPlan.includes(module.key) ? "bg-success-soft text-success-strong" : "bg-muted text-muted-foreground")}>{inPlan.includes(module.key) ? "In plan" : "Not in plan"}</span> : null}
                </span>
                <span className="text-muted-foreground block text-xs">{module.hint}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export type PlanChoice = { value: string; label: string; modules: string[] };

/**
 * Approve a school: choose the plan, see the modules it brings, adjust them
 * for this school if needed, then approve. The form stays mounted after
 * approval — it carries the one-time password, which cannot be shown again.
 */
export function ApproveWithPlanForm({ schoolId, plans, defaultPlanId, canApprove }: { schoolId: string; plans: PlanChoice[]; defaultPlanId: string | null; canApprove: boolean }) {
  const [planId, setPlanId] = useState(defaultPlanId ?? plans[0]?.value ?? "");
  const plan = plans.find((row) => row.value === planId);
  const [custom, setCustom] = useState(false);
  const [modules, setModules] = useState<string[]>(plan?.modules ?? []);
  const shown = custom ? modules : (plan?.modules ?? []);

  return (
    <ActionForm action={approveSchoolAction} className="gap-4">
      <input type="hidden" name="schoolId" value={schoolId} />
      {canApprove ? (
        <>
          <ol className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
            <li>1. Review the school</li>
            <li>2. Choose a plan</li>
            <li>3. Check the features</li>
            <li>4. Approve</li>
          </ol>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Plan
            <select
              name="planId"
              value={planId}
              onChange={(event) => {
                setPlanId(event.target.value);
                setModules(plans.find((row) => row.value === event.target.value)?.modules ?? []);
              }}
              className="border-input bg-background h-10 rounded-lg border px-3"
            >
              {plans.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Core — always included</p>
            <CoreModuleList compact />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{custom ? "Optional — adjusted for this school" : `Optional — from the ${plan?.label ?? ""} plan`}</p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={custom}
                  onChange={(event) => {
                    setCustom(event.target.checked);
                    setModules(plan?.modules ?? []);
                  }}
                  className="size-4"
                />
                Adjust for this school
              </label>
            </div>
            <input type="hidden" name="moduleChoice" value={custom ? "custom" : "plan"} />
            <OptionalModuleChecks selected={shown} onChange={setModules} disabled={!custom} />
          </div>
          <p className="text-muted-foreground text-sm">
            Approving activates the school, sets up classes Nursery–12, streams, subjects and the current session, creates an administrator from the registration contact,
            and emails them the sign-in.
          </p>
          <div>
            <SubmitButton pendingLabel="Approving…">Approve school</SubmitButton>
          </div>
        </>
      ) : null}
    </ActionForm>
  );
}

/** Manage one school's optional modules: follow the plan, or choose them for this school. */
export function SchoolModulesForm({ schoolId, planName, planModules, current, customized }: { schoolId: string; planName: string | null; planModules: string[]; current: string[]; customized: boolean }) {
  // Ticked only when the campus really has exactly the plan's modules: a plan
  // change leaves `customized` false but the campus's modules as they were,
  // and showing the plan's set here would claim modules that are switched off.
  const matchesPlan = current.length === planModules.length && current.every((key) => planModules.includes(key));
  const [follow, setFollow] = useState(!customized && planName !== null && matchesPlan);
  const [modules, setModules] = useState<string[]>(current);
  const inPlanOff = planModules.filter((key) => !current.includes(key));
  const onOutsidePlan = current.filter((key) => !planModules.includes(key));
  return (
    <ActionForm action={setSchoolModulesAction} className="gap-4">
      <input type="hidden" name="schoolId" value={schoolId} />
      {planName ? (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="followPlan"
            checked={follow}
            onChange={(event) => {
              setFollow(event.target.checked);
              if (event.target.checked) setModules(planModules);
            }}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="block font-medium">{`Switch on everything in the ${planName} plan`}</span>
            <span className="text-muted-foreground block text-xs">Untick to choose this campus&apos;s modules yourself. A module outside the plan is an exception for this campus only. Only this campus changes.</span>
          </span>
        </label>
      ) : null}
      {planName ? (
        <p className="text-muted-foreground text-xs">
          {[
            `In the ${planName} plan: ${planModules.length ? planModules.map(moduleLabel).join(", ") : "core only"}.`,
            `On for this campus: ${current.length ? current.map(moduleLabel).join(", ") : "core only"}.`,
            inPlanOff.length ? `In the plan but off here: ${inPlanOff.map(moduleLabel).join(", ")}.` : "",
            onOutsidePlan.length ? `On here but not in the plan (kept, or an exception): ${onOutsidePlan.map(moduleLabel).join(", ")}.` : "",
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
      <OptionalModuleChecks selected={follow ? planModules : modules} onChange={setModules} disabled={follow} inPlan={planName ? planModules : undefined} />
      <div>
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </ActionForm>
  );
}
