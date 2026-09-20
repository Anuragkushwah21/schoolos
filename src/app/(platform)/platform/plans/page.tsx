import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanForm } from "@/features/platform/forms";
import { formatMoney, pluralize } from "@/lib/format";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listPlans } from "@/server/platform/plans";

export const metadata: Metadata = { title: "Plans" };

export default async function PlansPage() {
  const user = await requireSuperAdmin();
  const plans = await listPlans(user);

  return (
    <>
      <PageHeader
        title="Plans"
        description="Prices and limits shown on the homepage and at registration."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {plan.name}
                {plan.isActive ? null : <StatusBadge status="INACTIVE" label="Hidden" />}
              </CardTitle>
              <CardDescription>
                {formatMoney(plan.priceMinor, plan.currency)} / year ·{" "}
                {pluralize(plan._count.subscriptions, "school")} subscribed
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
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
