"use client";

import { useState } from "react";
import { LockIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { LimitFields } from "@/features/campuses/forms";
import { ESSENTIAL_MODULES, MODULE_CAPABILITIES, PLAN_FEATURE_KEYS, PLAN_FEATURES, PLAN_TEMPLATE_KEYS, PLAN_TEMPLATES, type PlanConfig, featureLabel, isPlanTemplateKey, planWarnings, templateDiff, templateSelection } from "@/lib/plan-catalog";
import { CORE_MODULES, OPTIONAL_MODULE_KEYS, OPTIONAL_MODULES, moduleLabel } from "@/lib/school-modules";
import { OPTIONAL_ROLE_KEYS, OPTIONAL_ROLES } from "@/lib/school-roles";
import { cn } from "@/lib/utils";

import { archivePlanAction, createPlanAction, discardPlanDraftAction, publishPlanAction, restorePlanAction, savePlanDraftAction, setPlanActiveAction } from "./actions";

const PERIODS = [
  { value: "YEARLY", label: "per year" },
  { value: "QUARTERLY", label: "per quarter" },
  { value: "MONTHLY", label: "per month" },
];

type TemplateKey = "starter" | "growth" | "pro";

/**
 * The Plan Builder form: every setting of one plan, saved as a draft.
 *
 * It opens on the plan's saved configuration (or its draft) — never reset to
 * a template by itself. "Load template" and "Restore defaults" change only
 * this form, after a confirmation; nothing is saved until "Save draft", and
 * nothing reaches schools until the plan is published. Essential modules are
 * required on every plan and cannot be unticked.
 */
export function PlanBuilderForm({ planId, config, templateKey, disabled }: { planId: string; config: PlanConfig; templateKey: string | null; disabled: boolean }) {
  const [modules, setModules] = useState<string[]>(config.optionalModules);
  const [features, setFeatures] = useState<string[]>(config.features);
  const [roles, setRoles] = useState<string[]>(config.availableRoles);
  const [campuses, setCampuses] = useState(String(config.campusLimit));
  const [template, setTemplate] = useState<TemplateKey | "">(isPlanTemplateKey(templateKey) ? templateKey : "");
  const [onRequest, setOnRequest] = useState(config.priceOnRequest);
  const [extra, setExtra] = useState(config.extraCampusAllowed);
  const [pending, setPending] = useState<{ key: TemplateKey; restore: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const selection = { optionalModules: OPTIONAL_MODULE_KEYS.filter((key) => (ESSENTIAL_MODULES as readonly string[]).includes(key) || modules.includes(key)), features: PLAN_FEATURE_KEYS.filter((key) => features.includes(key)), availableRoles: OPTIONAL_ROLE_KEYS.filter((key) => roles.includes(key)), campusLimit: Number(campuses) || 1 };
  const diff = template ? templateDiff(selection, template) : null;
  const warnings = planWarnings(selection);
  const toggle = (list: string[], set: (next: string[]) => void, key: string, on: boolean) => set(on ? [...list, key] : list.filter((row) => row !== key));

  const apply = (key: TemplateKey) => {
    const next = templateSelection(key);
    setModules(next.optionalModules);
    setFeatures(next.features);
    setRoles(next.availableRoles);
    setCampuses(String(next.campusLimit));
    setTemplate(key);
    setPending(null);
  };

  return (
    <ActionForm action={savePlanDraftAction} className="gap-5">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="templateKey" value={template} />
      <fieldset disabled={disabled} className="flex flex-col gap-5">
        <div className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-semibold">Template: </span>
              {template ? PLAN_TEMPLATES[template].label : "None"}
              {diff ? <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs font-semibold", diff.customized ? "bg-warning-soft text-warning-strong" : "bg-success-soft text-success-strong")}>{diff.customized ? "Customized" : "Matches template"}</span> : null}
            </p>
            <p className="text-muted-foreground text-xs">{`${selection.optionalModules.length} of ${OPTIONAL_MODULE_KEYS.length} optional modules · ${selection.features.length} of ${PLAN_FEATURE_KEYS.length} features · ${selection.availableRoles.length} roles`}</p>
          </div>
          {diff?.customized ? (
            <p className="text-muted-foreground text-xs">
              {[
                diff.modules.added.length ? `added ${diff.modules.added.map(moduleLabel).join(", ")}` : "",
                diff.modules.removed.length ? `removed ${diff.modules.removed.map(moduleLabel).join(", ")}` : "",
                diff.features.added.length ? `added ${diff.features.added.map(featureLabel).join(", ")}` : "",
                diff.features.removed.length ? `removed ${diff.features.removed.map(featureLabel).join(", ")}` : "",
                diff.roles.added.length ? `${diff.roles.added.length} more role(s)` : "",
                diff.roles.removed.length ? `${diff.roles.removed.length} role(s) fewer` : "",
                diff.campuses ? `campuses ${diff.campuses.from} → ${diff.campuses.to}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Load template
              <select className="border-input bg-background h-9 rounded-lg border px-2 text-sm" value="" onChange={(event) => event.target.value && setPending({ key: event.target.value as TemplateKey, restore: false })} aria-label="Load template">
                <option value="">Choose…</option>
                {PLAN_TEMPLATE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {PLAN_TEMPLATES[key].label}
                  </option>
                ))}
              </select>
            </label>
            {template && diff?.customized ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setPending({ key: template, restore: true })}>
                Restore defaults
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setModules([...OPTIONAL_MODULE_KEYS])}>
              Select all modules
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setModules([...ESSENTIAL_MODULES])}>
              Clear optional modules
            </Button>
          </div>
          {pending ? (
            <div role="alertdialog" aria-label="Confirm template" className="bg-warning-soft text-warning-strong flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <p>{`${pending.restore ? "Restore" : "Load"} the ${PLAN_TEMPLATES[pending.key].label} template? Modules, features, roles and included campuses in this form are replaced. Nothing is saved until you press "Save draft", and schools are not affected until the plan is published.`}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => apply(pending.key)}>
                  {pending.restore ? "Restore defaults" : "Load template"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <FieldRow>
          <TextField name="name" label="Plan name" defaultValue={config.name} required />
          <TextField name="displayOrder" label="Display order" inputMode="numeric" defaultValue={config.displayOrder} hint="Lower first. Higher plans must include everything below them." required />
        </FieldRow>
        <TextareaField name="description" label="Description" defaultValue={config.description ?? ""} rows={2} />
        <TextareaField name="highlights" label="Highlights (one per line, up to 8)" defaultValue={config.highlights.join("\n")} rows={3} hint="Shown on the public plan card. Only say what the product really does." />

        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-sm font-semibold">Price</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="priceOnRequest" checked={onRequest} onChange={(event) => setOnRequest(event.target.checked)} className="size-4" />
            Price on request (no price is shown publicly)
          </label>
          {!onRequest ? (
            <FieldRow>
              <TextField name="priceRupees" label="Organization fee (₹)" inputMode="decimal" defaultValue={config.priceMinor / 100} required />
              <SelectField name="billingPeriod" label="Billed" options={PERIODS} defaultValue={config.billingPeriod} />
            </FieldRow>
          ) : (
            <>
              <input type="hidden" name="priceRupees" value={config.priceMinor / 100} />
              <input type="hidden" name="billingPeriod" value={config.billingPeriod} />
            </>
          )}
          <p className="text-muted-foreground text-xs">Discounts are run as Offers. A price change applies to new sign-ups and requests; existing customers&apos; billing is changed by SchoolOS by hand.</p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-sm font-semibold">Campuses</p>
          <TextField name="campusLimit" label="Campuses included in the fee" inputMode="numeric" value={campuses} onChange={(event) => setCampuses(event.target.value)} required />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="extraCampusAllowed" checked={extra} onChange={(event) => setExtra(event.target.checked)} className="size-4" />
            Allow more campuses at an extra charge
          </label>
          {extra ? (
            <>
              <FieldRow>
                <TextField name="extraCampusRupees" label="Price per extra campus (₹)" inputMode="decimal" defaultValue={config.extraCampusPriceMinor === null ? "" : config.extraCampusPriceMinor / 100} required />
                <SelectField name="extraCampusPeriod" label="Billed" options={PERIODS} defaultValue={config.extraCampusPeriod} />
              </FieldRow>
              <TextField name="maxCampuses" label="Most campuses in all (blank = no cap)" inputMode="numeric" defaultValue={config.maxCampuses ?? ""} />
            </>
          ) : (
            <>
              {/* Kept while extra campuses are off, so switching them back on later brings the saved price and cap back. */}
              <input type="hidden" name="extraCampusPeriod" value={config.extraCampusPeriod} />
              <input type="hidden" name="extraCampusRupees" value={config.extraCampusPriceMinor === null ? "" : config.extraCampusPriceMinor / 100} />
              <input type="hidden" name="maxCampuses" value={config.maxCampuses ?? ""} />
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Modules</p>
          <p className="text-muted-foreground text-xs">Core modules are in every plan. Ticked modules become <em>eligible</em>: each campus switches them on itself. Publishing never changes a campus&apos;s modules.</p>
          <details className="rounded-lg border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">{`Core — always included (${CORE_MODULES.length})`}</summary>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {CORE_MODULES.map((module) => (
                <li key={module.key} className="text-muted-foreground flex items-start gap-2" title={module.hint}>
                  <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    <span className="text-foreground">{module.label}</span> — {module.hint}
                  </span>
                </li>
              ))}
            </ul>
          </details>
          <ul className="mt-1 grid gap-2 sm:grid-cols-2">
            {OPTIONAL_MODULES.map((module) => {
              const essential = (ESSENTIAL_MODULES as readonly string[]).includes(module.key);
              const on = essential || modules.includes(module.key);
              const expanded = open === module.key;
              return (
                <li key={module.key} className={cn("flex h-full flex-col rounded-lg border p-2.5 text-sm", on ? "border-success/40 bg-success-soft/50" : "bg-muted/30")}>
                  <label className={cn("flex items-start gap-2.5", essential ? "cursor-default" : "cursor-pointer")}>
                    <input type="checkbox" checked={on} disabled={essential} onChange={(event) => toggle(modules, setModules, module.key, event.target.checked)} className="mt-0.5 size-4" />
                    {on ? <input type="hidden" name="optionalModules" value={module.key} /> : null}
                    <span className="flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {module.label}
                        <span className={cn("rounded-full px-1.5 text-[11px]", on ? "bg-success-soft text-success-strong" : "bg-muted text-muted-foreground")}>{on ? "Included" : "Not included"}</span>
                      </span>
                      <span className="text-muted-foreground block text-xs">{essential ? "Essential — required on every plan." : module.hint}</span>
                    </span>
                  </label>
                  <button type="button" className="text-primary mt-1 self-start text-xs underline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : module.key)}>
                    {expanded ? "Hide what's inside" : "What's inside"}
                  </button>
                  {expanded ? (
                    <ul className="text-muted-foreground mt-1 list-disc pl-5 text-xs">
                      {MODULE_CAPABILITIES[module.key].map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                      <li>Comes as one module — its parts are not switched separately.</li>
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Organization features</p>
          <p className="text-muted-foreground text-xs">For the owner&apos;s whole organization, not one campus.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {PLAN_FEATURES.map((feature) => {
              const on = features.includes(feature.key);
              return (
                <li key={feature.key}>
                  <label className={cn("flex h-full cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm", on ? "border-success/40 bg-success-soft/50" : "bg-muted/30")}>
                    <input type="checkbox" name="features" value={feature.key} checked={on} onChange={(event) => toggle(features, setFeatures, feature.key, event.target.checked)} className="mt-0.5 size-4" />
                    <span>
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {feature.label}
                        <span className={cn("rounded-full px-1.5 text-[11px]", on ? "bg-success-soft text-success-strong" : "bg-muted text-muted-foreground")}>{on ? "Included" : "Not included"}</span>
                      </span>
                      <span className="text-muted-foreground block text-xs">{feature.hint}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Staff roles</p>
          <p className="text-muted-foreground text-xs">School Admin, Teacher, Parent and Student are always available. Roles the plan adds are offered to campuses that follow the plan&apos;s roles; nobody loses a role on publish.</p>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {OPTIONAL_ROLES.map((role) => (
              <li key={role.key}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="availableRoles" value={role.key} checked={roles.includes(role.key)} onChange={(event) => toggle(roles, setRoles, role.key, event.target.checked)} className="size-4" />
                  {role.label}
                </label>
              </li>
            ))}
          </ul>
          {warnings.length ? (
            <ul className="text-warning-strong flex flex-col gap-1 text-xs">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-semibold">Usage limits (per campus)</summary>
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-muted-foreground text-xs">Leave a limit blank for unlimited.</p>
            <FieldRow>
              <TextField name="maxStudents" label="Max students" inputMode="numeric" defaultValue={config.maxStudents ?? ""} />
              <TextField name="maxTeachers" label="Max teachers" inputMode="numeric" defaultValue={config.maxTeachers ?? ""} />
            </FieldRow>
            <FieldRow>
              <TextField name="maxAdmins" label="Max admins" inputMode="numeric" defaultValue={config.maxAdmins ?? ""} />
              <TextField name="storageMb" label="Storage (MB)" inputMode="numeric" defaultValue={config.storageMb ?? ""} />
            </FieldRow>
            <LimitFields initial={config.roleLimits} keys={["STAFF", "PRINCIPAL", "ACCOUNTANT", "RECEPTIONIST", "LIBRARIAN", "DRIVER", "SECURITY"]} />
          </div>
        </details>
      </fieldset>
      {!disabled ? (
        <div>
          <SubmitButton variant="outline" pendingLabel="Saving…">
            Save draft
          </SubmitButton>
        </div>
      ) : null}
    </ActionForm>
  );
}

/** Publish / discard / open-close / archive-restore for one plan. */
export function PlanLifecycleButtons({ planId, name, status, isActive, hasDraft, canPublish, impact }: { planId: string; name: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; isActive: boolean; hasDraft: boolean; canPublish: boolean; impact: string[] }) {
  const publishable = status === "DRAFT" || hasDraft;
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "ARCHIVED" && publishable ? (
        <ActionButton
          action={publishPlanAction}
          fields={{ planId }}
          disabled={!canPublish}
          size="default"
          confirm={{ title: `Publish ${name}?`, description: `${impact.length ? impact.join(" ") : "No organization is on this plan yet."} Campus modules and existing billing are not changed. The homepage, registration and the Live Demo show the new version straight away.`, confirmLabel: "Publish" }}
        >
          Publish
        </ActionButton>
      ) : null}
      {hasDraft ? (
        <ActionButton action={discardPlanDraftAction} fields={{ planId }} variant="outline" confirm={{ title: "Discard unpublished changes?", description: "The plan goes back to its published version." }}>
          Discard draft
        </ActionButton>
      ) : null}
      {status === "PUBLISHED" ? (
        <ActionButton action={setPlanActiveAction} fields={{ planId, active: isActive ? "false" : "true" }} variant="outline" confirm={isActive ? { title: `Close ${name} to new schools?`, description: "It disappears from the homepage, registration and plan requests. Organizations already on it are not affected." } : undefined}>
          {isActive ? "Close to new schools" : "Open to new schools"}
        </ActionButton>
      ) : null}
      {status === "ARCHIVED" ? (
        <ActionButton action={restorePlanAction} fields={{ planId }} variant="outline">
          Restore
        </ActionButton>
      ) : (
        <ActionButton action={archivePlanAction} fields={{ planId }} variant="outline" confirm={{ title: `Archive ${name}?`, description: "Hidden from everyone new. Organizations on it stay on it until SchoolOS moves them." }}>
          Archive
        </ActionButton>
      )}
    </div>
  );
}

/** A new draft plan from a template, a copy of one plan (its published settings), or the highest plan. */
export function CreatePlanForm({ plans = [] }: { plans?: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={createPlanAction} className="flex-row flex-wrap items-end gap-3" resetOnSuccess>
      <TextField name="name" label="New plan name" placeholder="e.g. Pro Plus" required className="min-w-56" />
      <SelectField
        name="templateKey"
        label="Start from"
        defaultValue="growth"
        options={[
          ...PLAN_TEMPLATE_KEYS.map((key) => ({ value: key, label: `${PLAN_TEMPLATES[key].label} template` })),
          { value: "", label: "Copy of the highest plan" },
          ...plans.map((plan) => ({ value: "copy:" + plan.id, label: `Copy of ${plan.name}` })),
        ]}
      />
      <SubmitButton variant="outline" pendingLabel="Creating…">
        Create draft plan
      </SubmitButton>
    </ActionForm>
  );
}
