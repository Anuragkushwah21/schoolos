import type { Metadata, Route } from "next";
import Link from "next/link";
import { Building2Icon, CalendarOffIcon, GraduationCapIcon, LayersIcon, SparklesIcon, UsersIcon, WalletIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenCampusButton } from "@/features/campuses/forms";
import { rupees } from "@/features/finance/money";
import { requireTenant } from "@/server/auth/current-user";
import { campusRequestOverview } from "@/server/campuses/requests";
import { allCampusesSummary, myOrganization } from "@/server/platform/campuses";

export const metadata: Metadata = { title: "My Schools" };


const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

/**
 * My Schools: the Owner's campuses with a high-level summary across them
 * (All Campuses), switching, and requests for a new campus. Summary figures
 * only — each campus's records stay inside that campus.
 */
export default async function CampusesPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const organization = await myOrganization(ctx.user);
  const [overview, summary] = await Promise.all([campusRequestOverview(ctx), organization.isOwner && organization.schools.length > 1 ? allCampusesSummary(ctx.user) : Promise.resolve(null)]);
  const openRequests = overview.requests.filter((request) => request.status === "PENDING" || request.status === "UNDER_REVIEW").length;

  return (
    <>
      <PageHeader
        icon={Building2Icon}
        tone="blue"
        title="My Schools"
        description={`${organization.name} · your schools, campus requests and plan`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={"/school-admin/plan" as Route}>Upgrade Plan</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={"/school-admin/campuses/requests" as Route}>{overview.requests.length ? `My Campus Requests (${overview.requests.length})` : "My Campus Requests"}</Link>
            </Button>
            <Button asChild>
              <Link href="/school-admin/campuses/request">Add New Campus Request</Link>
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard tone="blue" icon={Building2Icon} label="Current school" value={ctx.schoolName} hint={organization.schools.length > 1 ? `${organization.schools.length} schools in ${organization.name}` : "your only school"} />
        <StatCard tone="purple" icon={SparklesIcon} label="Current plan" value={overview.plan.planName ?? "Not set"} hint={`${overview.plan.modules.length} optional modules · ${overview.plan.roles.length} optional roles`} href={"/school-admin/plan" as Route} />
        <StatCard tone={overview.withinEntitlement ? "green" : "amber"} icon={LayersIcon} label="Campus entitlement" value={`${organization.count} / ${organization.limit}`} hint={overview.pending ? `${overview.pending} request${overview.pending === 1 ? "" : "s"} waiting` : organization.limit > 1 ? "multi-campus on" : "single school plan"} />
      </div>

      {overview.entitlement ? <p className="bg-info-soft text-info-strong mb-6 rounded-xl border px-4 py-3 text-sm">{overview.entitlement}</p> : null}

      {summary ? (
        <>
          <h2 className="mb-3 text-base font-semibold">All Campuses</h2>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <StatCard tone="blue" icon={Building2Icon} label="Campuses" value={summary.totals.campuses} />
            <StatCard tone="purple" icon={GraduationCapIcon} label="Students" value={summary.totals.students} hint="active, all campuses" />
            <StatCard tone="cyan" icon={UsersIcon} label="Teachers" value={summary.totals.teachers} hint={`${summary.totals.staff} other staff`} />
            <StatCard tone="green" icon={WalletIcon} label="Fees collected" value={rupees(summary.totals.collectedMinor)} hint={`${rupees(summary.totals.pendingMinor)} pending · this session`} />
            <StatCard tone="amber" icon={CalendarOffIcon} label="Leave waiting" value={summary.totals.pendingLeave} hint="for a decision" />
          </div>
          <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {summary.campuses.map((campus) => {
              const current = campus.id === ctx.schoolId;
              return (
                <Card key={campus.id} className={current ? "ring-primary ring-2" : undefined}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {campus.name}
                      {campus.status !== "ACTIVE" ? <StatusBadge status={campus.status} /> : null}
                      {current ? <StatusBadge status="CURRENT" label="You are here" tone="info" /> : null}
                    </CardTitle>
                    <CardDescription>{campus.city ?? ""}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-muted-foreground text-xs">Students</dt>
                        <dd className="font-semibold tabular-nums">{campus.students}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">Teachers · staff</dt>
                        <dd className="font-semibold tabular-nums">{`${campus.teachers} · ${campus.staff}`}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">Attendance today</dt>
                        <dd className="font-semibold tabular-nums">{pct(campus.attendance)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">Fees (session)</dt>
                        <dd className="font-semibold tabular-nums">{campus.finance ? `${rupees(campus.collectedMinor)} · ${rupees(campus.pendingMinor)} due` : "Not in plan"}</dd>
                      </div>
                    </dl>
                    {campus.pendingLeave ? <p className="text-warning-strong text-xs">{`${campus.pendingLeave} leave request${campus.pendingLeave === 1 ? "" : "s"} waiting`}</p> : null}
                    {campus.status === "ACTIVE" && !current ? (
                      <div>
                        <OpenCampusButton schoolId={campus.id} />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      ) : (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{ctx.schoolName}</CardTitle>
            <CardDescription>
              {organization.schools.length > 1 || !organization.isOwner
                ? `Part of ${organization.name}. The owner${organization.owner ? `, ${organization.owner.firstName} ${organization.owner.lastName},` : ""} sees all campuses.`
                : "Your school. When SchoolOS enables more campuses for your plan, you can request another school here and switch between them."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Campus requests</CardTitle>
            <CardDescription>{overview.requests.length ? `${overview.requests.length} sent · ${openRequests} waiting for SchoolOS` : "No requests yet."}</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={"/school-admin/campuses/requests" as Route}>Open My Campus Requests</Link>
          </Button>
        </CardHeader>
      </Card>
    </>
  );
}
