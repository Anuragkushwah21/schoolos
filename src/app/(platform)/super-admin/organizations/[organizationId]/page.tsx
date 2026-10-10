import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2Icon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CampusLimitForm } from "@/features/campuses/forms";
import { ChangeOrganizationPlanForm } from "@/features/platform/organization-forms";
import { formatDate, formatDateTime, toDateInput, today } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatMoney, humanize } from "@/lib/format";
import { featureLabel, periodLabel } from "@/lib/plan-catalog";
import { moduleLabel } from "@/lib/school-modules";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { organizationDetail, planChangeOptions } from "@/server/platform/organizations";

export const metadata: Metadata = { title: "Organization" };

/**
 * One customer: its plan and subscription, campus allowance, every campus
 * (with its modules), the plan change with a comparison, and the history.
 * The plan is the organization's — saving it moves every campus together.
 */
export default async function OrganizationPage(props: PageProps<"/super-admin/organizations/[organizationId]">) {
  const user = await requireSuperAdmin();
  const { organizationId } = await props.params;
  const [detail, options] = await Promise.all([organizationDetail(user, organizationId), planChangeOptions(user, organizationId)]).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { organization, plan, subscription, allowance, quote, campuses } = detail;

  return (
    <>
      <PageHeader
        icon={Building2Icon}
        tone="blue"
        title={organization.name}
        description={`${organization.owner ? `Owner ${organization.owner.firstName} ${organization.owner.lastName} (${organization.owner.email})` : "No owner yet"} · customer since ${formatDate(organization.createdAt)}`}
        actions={
          <Link href="/super-admin/organizations" className="text-primary text-sm font-medium hover:underline">
            All organizations
          </Link>
        }
      />

      {detail.mixedPlans ? (
        <p className="bg-warning-soft text-warning-strong mb-6 rounded-xl border px-4 py-3 text-sm">
          {`Some campuses are not on the organization's plan (${plan?.name ?? "none"}) — this can be left over from before plans were kept in step. Save the plan below to put every campus on it.`}
        </p>
      ) : null}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
            <CardDescription>{subscription ? `${humanize(subscription.status)} · from ${formatDate(subscription.startsAt)}${subscription.endsAt ? ` to ${formatDate(subscription.endsAt)}` : ""}` : "No subscription yet"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <p className="text-2xl font-bold">{plan?.name ?? "No plan"}</p>
            {quote ? <p>{quote.onRequest ? "Price on request" : `${formatMoney(quote.planFeeMinor ?? 0)} / ${periodLabel(quote.billingPeriod)}${quote.extraCampuses && quote.extraTotalMinor !== null ? ` + ${formatMoney(quote.extraTotalMinor)} for ${quote.extraCampuses} extra campus${quote.extraCampuses === 1 ? "" : "es"}` : ""}`}</p> : null}
            {subscription?.notes ? <p className="text-muted-foreground">{subscription.notes}</p> : null}
            <p className="text-muted-foreground text-xs">Billing is arranged by SchoolOS by hand — nothing is charged online.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Campuses</CardTitle>
            <CardDescription>{`${allowance.live} in use · ${allowance.text}${allowance.overridden ? ` · limit set to ${allowance.cap} for this organization` : ""}`}</CardDescription>
          </CardHeader>
          <CardContent>
            <CampusLimitForm organizationId={organization.id} current={organization.campusLimitOverride} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What the plan includes</CardTitle>
            <CardDescription>Core modules are always on. These can be switched on at each campus.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>{detail.eligible.length ? detail.eligible.map(moduleLabel).join(", ") : "Core modules only"}</p>
            {detail.features.length ? <p className="text-muted-foreground">{`Also: ${detail.features.map(featureLabel).join(", ")}`}</p> : null}
            {plan ? <p className="text-muted-foreground text-xs">{`Students per campus: ${plan.maxStudents ?? "no limit"} · teachers per campus: ${plan.maxTeachers ?? "no limit"}`}</p> : null}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-base font-semibold">Campuses</h2>
      <div className="bg-card shadow-card mb-8 overflow-x-auto rounded-2xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campus</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Modules on</TableHead>
              <TableHead>In plan, not on</TableHead>
              <TableHead className="text-right">Students</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campuses.map((campus) => (
              <TableRow key={campus.id}>
                <TableCell>
                  <Link href={`/super-admin/schools/${campus.id}`} className="font-medium hover:underline">
                    {campus.name}
                  </Link>
                  <span className="text-muted-foreground block text-xs">{campus.place || "—"}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={campus.status} label={humanize(campus.status)} />
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {campus.plan?.name ?? "No plan"}
                    {campus.differs ? <StatusBadge status="DIFFERS" label="Different plan" tone="warning" /> : null}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {campus.enabled.length ? campus.enabled.map((key) => `${moduleLabel(key)}${campus.kept.includes(key) ? " (kept, not in plan)" : ""}`).join(", ") : "Core only"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{campus.available.length ? campus.available.map(moduleLabel).join(", ") : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{campus.students}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Change plan</CardTitle>
            <CardDescription>Applies to every campus of this organization. Campus modules are not changed: newly included ones are offered to the school to switch on.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangeOrganizationPlanForm
              organizationId={organization.id}
              currentPlanId={plan?.id ?? null}
              currentStatus={subscription?.status ?? null}
              startsAt={toDateInput(subscription?.startsAt ?? today())}
              endsAt={subscription?.endsAt ? toDateInput(subscription.endsAt) : ""}
              options={options}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Plan, subscription and module changes for this organization&apos;s campuses.</CardDescription>
          </CardHeader>
          <CardContent>
            {detail.history.length ? (
              <ol className="flex flex-col gap-3 text-sm">
                {detail.history.map((row) => (
                  <li key={row.id} className="border-l-2 pl-3">
                    <p className="text-muted-foreground text-xs">{`${formatDateTime(row.createdAt)} · ${row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : "System"}`}</p>
                    <p>{row.summary}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">No changes recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
