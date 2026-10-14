import type { Metadata } from "next";
import { LayersIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ComparisonTable, type DisplayPlan, PlanCard } from "@/features/plans/plan-display";
import { CreatePlanForm, PlanBuilderForm, PlanLifecycleButtons } from "@/features/platform/plan-builder";
import { formatDateTime } from "@/lib/dates";
import { OPTIONAL_MODULES } from "@/lib/school-modules";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { moduleAdoption } from "@/server/analytics/platform";
import { listPlans, planImpact } from "@/server/platform/plans";

export const metadata: Metadata = { title: "Plans" };

/**
 * The Plan Builder: every plan with its published version, unpublished
 * draft, the rules it would break, its impact on organizations already on
 * it, and a preview of the public cards and comparison. Publishing is always
 * a separate, confirmed step; it never rewrites a campus's modules.
 */
export default async function PlansPage() {
  const user = await requireSuperAdmin();
  const [plans, adoption] = await Promise.all([listPlans(user), moduleAdoption(user)]);
  const impacts = new Map(await Promise.all(plans.filter((plan) => plan.draft || plan.status === "DRAFT").map(async (plan) => [plan.id, await planImpact(user, plan.id)] as const)));

  const preview = (which: "live" | "edited"): DisplayPlan[] =>
    plans
      .filter((plan) => plan.status !== "ARCHIVED" && (which === "edited" || (plan.status === "PUBLISHED" && plan.isActive)))
      .map((plan) => ({ ...(which === "edited" ? (plan.edited ?? plan.live) : plan.live), id: plan.id, slug: plan.slug, currency: plan.currency }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  const hasDrafts = plans.some((plan) => plan.draft || plan.status === "DRAFT");

  return (
    <>
      <PageHeader icon={LayersIcon} tone="purple" title="Plans" description="Configure plans, prices, campus allowances and module eligibility. Edits are drafts until you publish them; the homepage, registration and the Live Demo read only published plans." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Optional modules in use</CardTitle>
          <CardDescription>{`Active schools with each module switched on, out of ${adoption.activeSchools}.`}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="grid gap-2.5 text-sm md:grid-cols-2">
            {OPTIONAL_MODULES.map((module) => {
              const count = adoption.byModule[module.key] ?? 0;
              const share = adoption.activeSchools ? Math.round((count / adoption.activeSchools) * 100) : 0;
              return (
                <li key={module.key} className="flex items-center gap-3">
                  <span className="w-32 shrink-0">{module.label}</span>
                  <span className="bg-muted h-2 flex-1 overflow-hidden rounded-full" aria-hidden>
                    <span className="bg-primary block h-full rounded-full" style={{ width: `${share}%` }} />
                  </span>
                  <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">{`${count} · ${share}%`}</span>
                </li>
              );
            })}
          </ul>
          <CreatePlanForm plans={plans.filter((plan) => plan.status !== "ARCHIVED").map((plan) => ({ id: plan.id, name: plan.live.name }))} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        {plans.map((plan) => {
          const config = plan.edited ?? plan.live;
          const impact = impacts.get(plan.id);
          return (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {plan.live.name}
                  <StatusBadge status={plan.status} label={plan.status === "DRAFT" ? "Draft — never published" : plan.status === "ARCHIVED" ? "Archived" : "Published"} tone={plan.status === "PUBLISHED" ? "positive" : plan.status === "ARCHIVED" ? "neutral" : "warning"} />
                  {plan.status === "PUBLISHED" && !plan.isActive ? <StatusBadge status="CLOSED" label="Closed to new schools" tone="neutral" /> : null}
                  {plan.draft ? <StatusBadge status="DRAFT" label="Unpublished changes" tone="warning" /> : null}
                  {plan.templateDiff ? <StatusBadge status={plan.templateDiff.customized ? "CUSTOMIZED" : "TEMPLATE"} label={`${plan.templateDiff.template} template${plan.templateDiff.customized ? " · customized" : ""}`} tone={plan.templateDiff.customized ? "warning" : "neutral"} /> : null}
                </CardTitle>
                <CardDescription>{`Key: ${plan.slug} · ${plan.usage.organizationCount} organization${plan.usage.organizationCount === 1 ? "" : "s"} · ${plan.usage.campusCount} campus${plan.usage.campusCount === 1 ? "" : "es"} on this plan${plan.publishedAt ? ` · published ${formatDateTime(plan.publishedAt)}` : ""}${plan.draftUpdatedAt ? ` · draft saved ${formatDateTime(plan.draftUpdatedAt)}` : ""}`}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
                <PlanBuilderForm key={`${plan.id}-${plan.draftUpdatedAt?.getTime() ?? 0}-${plan.templateKey ?? ""}`} planId={plan.id} config={config} templateKey={plan.templateKey} disabled={plan.status === "ARCHIVED"} />
                <div className="flex flex-col gap-4">
                  <PlanLifecycleButtons planId={plan.id} name={config.name} status={plan.status} isActive={plan.isActive} hasDraft={Boolean(plan.draft)} canPublish={plan.problems.length === 0} impact={impact?.notes ?? []} />
                  {plan.problems.length ? (
                    <div className="bg-danger-soft text-danger-strong rounded-xl border p-3 text-sm">
                      <p className="font-semibold">Cannot publish yet</p>
                      <ul className="mt-1 list-disc pl-5">
                        {plan.problems.map((problem) => (
                          <li key={problem}>{problem}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {plan.changes.length ? (
                    <div className="rounded-xl border p-3 text-sm">
                      <p className="font-semibold">Changes from the published plan</p>
                      <ul className="mt-1 list-disc pl-5">
                        {plan.changes.map((change) => (
                          <li key={change}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {plan.warnings.length ? (
                    <div className="bg-warning-soft text-warning-strong rounded-xl border p-3 text-sm">
                      <p className="font-semibold">Check before publishing</p>
                      <ul className="mt-1 list-disc pl-5">
                        {plan.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {impact ? (
                    <div className="bg-muted/50 rounded-xl border p-3 text-sm">
                      <p className="font-semibold">Impact of publishing</p>
                      {impact.notes.length ? (
                        <ul className="mt-1 list-disc pl-5">
                          {impact.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground mt-1">No change for organizations on this plan.</p>
                      )}
                      {impact.grandfathered.length ? (
                        <ul className="text-muted-foreground mt-2 text-xs">
                          {impact.grandfathered.slice(0, 10).map((row) => (
                            <li key={`${row.organization}-${row.campus}`}>{`${row.organization} · ${row.campus}: keeps ${row.modules.join(", ")}`}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {plan.usage.organizations.length ? (
                    <details className="rounded-xl border p-3 text-sm">
                      <summary className="cursor-pointer font-semibold">Organizations on this plan</summary>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {plan.usage.organizations.slice(0, 50).map((org) => (
                          <li key={org.id}>
                            <span className="font-medium">{org.name}</span>
                            <span className="text-muted-foreground">{` — ${org.campuses.map((campus) => `${campus.name} (${campus.modules.length ? campus.modules.join(", ") : "core only"})`).join("; ")}`}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <div>
                    <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">{plan.draft || plan.status === "DRAFT" ? "Preview (unpublished)" : "Public card"}</p>
                    <PlanCard plan={{ ...config, id: plan.id, slug: plan.slug, currency: plan.currency }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="mt-8 mb-3 text-lg font-bold">{hasDrafts ? "Comparison preview — with unpublished changes" : "Public comparison"}</h2>
      <ComparisonTable plans={preview(hasDrafts ? "edited" : "live")} />
    </>
  );
}
