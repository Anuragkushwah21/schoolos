import type { Metadata } from "next";
import { LayersIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanForm } from "@/features/platform/forms";
import { CoreModuleList } from "@/features/platform/module-forms";
import { formatMoney, pluralize } from "@/lib/format";
import { OPTIONAL_MODULES, cleanModules } from "@/lib/school-modules";
import { cleanLimits, cleanRoles } from "@/lib/school-roles";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { moduleAdoption } from "@/server/analytics/platform";
import { listPlans } from "@/server/platform/plans";

export const metadata: Metadata = { title: "Features & plans" };

/**
 * Features & Plans: the core modules every school has, and each plan's
 * optional modules, prices and limits. A change to a plan's modules reaches
 * the schools that follow it; a school adjusted by hand keeps its own.
 */
export default async function PlansPage() {
  const user = await requireSuperAdmin();
  const [plans, adoption] = await Promise.all([listPlans(user), moduleAdoption(user)]);

  return (
    <>
      <PageHeader icon={LayersIcon} tone="purple" title="Features & plans" description="What every school gets, and what each plan adds. Prices and limits are shown on the homepage and at registration." />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Core modules</CardTitle>
            <CardDescription>SchoolOS itself — in every plan, for every active school. There is no switch for these.</CardDescription>
          </CardHeader>
          <CardContent>
            <CoreModuleList />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Optional modules in use</CardTitle>
            <CardDescription>{`Active schools with each module, out of ${adoption.activeSchools}.`}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2.5 text-sm">
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
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-bold">Plans</h2>
      <div className="grid gap-6 xl:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {plan.name}
                {plan.isActive ? null : <StatusBadge status="INACTIVE" label="Hidden" />}
              </CardTitle>
              <CardDescription>
                {formatMoney(plan.priceMinor, plan.currency)} / year · {pluralize(plan._count.subscriptions, "school")} subscribed · {plan.campusLimit > 1 ? `up to ${plan.campusLimit} campuses` : "single school"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlanForm
                plan={{
                  id: plan.id,
                  name: plan.name,
                  description: plan.description,
                  priceRupees: plan.priceMinor / 100,
                  maxStudents: plan.maxStudents,
                  maxTeachers: plan.maxTeachers,
                  maxAdmins: plan.maxAdmins,
                  storageMb: plan.storageMb,
                  isActive: plan.isActive,
                  optionalModules: cleanModules(plan.optionalModules),
                  campusLimit: plan.campusLimit,
                  availableRoles: cleanRoles(plan.availableRoles),
                  roleLimits: cleanLimits(plan.roleLimits),
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-sm">
        Need a different mix for one school? Open the school and use Manage features — that is a custom set for that school only.
      </p>
    </>
  );
}
