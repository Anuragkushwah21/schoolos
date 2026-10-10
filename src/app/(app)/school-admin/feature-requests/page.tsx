import type { Metadata } from "next";
import Link from "next/link";
import { LightbulbIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureRequestForm } from "@/features/feature-requests/forms";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { CORE_MODULES, OPTIONAL_MODULES } from "@/lib/school-modules";
import { requireTenant } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { ensureOrganization } from "@/server/platform/campuses";
import { hasPlanFeature } from "@/server/platform/entitlements";
import { FEATURE_STATUS_LABELS, myFeatureRequests } from "@/server/platform/feature-requests";

export const metadata: Metadata = { title: "Feature requests" };

/**
 * Custom feature requests for the owner: ask for something SchoolOS does not
 * do yet, and follow it. Available when the plan includes custom feature
 * requests; cost and scope are always agreed separately.
 */
export default async function FeatureRequestsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const organizationId = await ensureOrganization(ctx.user.homeSchoolId ?? ctx.schoolId);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ownerId: true, schools: { where: { status: { in: ["ACTIVE", "SUSPENDED"] } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } } } });
  const header = <PageHeader icon={LightbulbIcon} tone="amber" title="Feature requests" description="Ask SchoolOS for something it does not do yet, and follow its progress." />;

  if (organization.ownerId !== ctx.user.id) {
    return (
      <>
        {header}
        <EmptyState icon={LightbulbIcon} tone="neutral" title="Only the school owner can request features">
          Ask your school&apos;s owner to send the request.
        </EmptyState>
      </>
    );
  }
  const [allowed, requests] = await Promise.all([hasPlanFeature(organizationId, "FEATURE_REQUESTS"), myFeatureRequests(ctx)]);
  const plans = allowed ? [] : await prisma.plan.findMany({ where: { status: "PUBLISHED", isActive: true, features: { has: "FEATURE_REQUESTS" } }, orderBy: { displayOrder: "asc" }, select: { name: true } });

  return (
    <>
      {header}
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>New request</CardTitle>
            <CardDescription>{allowed ? "Tell us the problem first — it helps us find the right solution." : "Custom feature requests are not part of your plan."}</CardDescription>
          </CardHeader>
          <CardContent>
            {allowed ? (
              <FeatureRequestForm
                campuses={organization.schools.map((school) => ({ value: school.id, label: school.name }))}
                modules={[...CORE_MODULES, ...OPTIONAL_MODULES].map((module) => ({ value: module.key, label: module.label }))}
              />
            ) : (
              <p className="text-sm">
                {plans.length ? `They come with ${plans.map((plan) => plan.name).join(" and ")}. ` : ""}
                <Link href="/school-admin/plan" className="text-primary font-medium underline">
                  Compare plans
                </Link>
                {" — or tell SchoolOS what you need through "}
                <Link href="/contact" className="text-primary font-medium underline">
                  Contact us
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Your requests</h2>
          {requests.length ? (
            requests.map((request) => (
              <Link key={request.id} href={`/school-admin/feature-requests/${request.id}`} className="bg-card hover:bg-muted/40 flex flex-col gap-1 rounded-xl border p-4">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{request.title}</span>
                  <StatusBadge status={request.status} label={FEATURE_STATUS_LABELS[request.status]} />
                </span>
                <span className="text-muted-foreground text-xs">{`${formatDate(request.createdAt)} · ${request.school?.name ?? "All campuses"} · ${request.priority.toLowerCase()} priority${request.estimatedTimeline ? ` · ${request.estimatedTimeline}` : ""}${request.estimatedCostMinor !== null ? ` · estimate ${formatMoney(request.estimatedCostMinor)}` : ""}`}</span>
              </Link>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">No requests yet.</p>
          )}
        </div>
      </div>
    </>
  );
}
