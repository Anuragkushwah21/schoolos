import type { Metadata, Route } from "next";
import Link from "next/link";
import { BriefcaseIcon, BusIcon, CalendarCheckIcon, CalendarDaysIcon, FingerprintIcon, KeyRoundIcon, ListChecksIcon, PencilIcon, PhoneIcon, RepeatIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { HeroAction, MetricTile, Panel, ProfileHero, ProfileTabs, SoftRow, TileChip } from "@/features/people/profile-ui";
import { DocumentShortcuts } from "@/features/documents/person-documents";
import { attendedDays } from "@/lib/attendance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AssignCrewForm, MoveCrewForm, RouteForm, StaffForm, StaffLoginForm, StopForm } from "@/features/operations/forms";
import { removeRouteCrewAction, removeStopAction } from "@/features/operations/actions";
import { Button } from "@/components/ui/button";
import { listRoutes, listVehicles } from "@/server/operations/transport";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { ActivationEmailNote, ResetPortalPasswordForm } from "@/features/school/people-forms";
import { endSubstitutionAction } from "@/features/staff/access-actions";
import { StaffGrantsForm, SubstitutionForm } from "@/features/staff/access-forms";
import { PermissionMatrix } from "@/features/staff/permission-matrix";
import { removeSalaryAction } from "@/features/finance/actions";
import { SalaryForm } from "@/features/finance/forms";
import { rupees, toRupeeInput } from "@/features/finance/money";
import { addDays, formatDate, formatDateTime, formatDayShort, formatMinutes, formatMonth, minutesToTime, parseDateInput, today, toDateInput } from "@/lib/dates";
import { fullName, humanize, pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { type BaseStaffRole, STAFF_ROLE_WORKSPACE, STAFF_MODULE_LABEL, STAFF_MODULES, STAFF_ROLE_MODULES, STAFF_ROLE_NAMES, allowedGrants, grantDef } from "@/lib/staff-access";
import { activationEmailStatuses } from "@/server/auth/account-links";
import { requireTenant } from "@/server/auth/current-user";
import { PersonDocuments } from "@/features/documents/person-documents";
import { getStaffSalary } from "@/server/finance/salary";
import { DOCUMENT_TYPE_LABEL, listStaffDocuments, staffAuditLog, staffPermissionSummary } from "@/server/staff/profiles";
import { archiveStaffDocumentAction, restoreRoleDefaultsAction } from "@/features/staff/profile-actions";
import { DocumentVerificationForm, RoleChangeForm, StaffDocumentForm } from "@/features/staff/profile-forms";
import { AuditEntries } from "@/features/audit/audit-entries";
import { getStaff, staffAccessHistory, staffAssignments, staffOptions, staffRecord } from "@/server/operations/staff";
import { orNotFound } from "@/server/page-helpers";
import { photoUrlFor } from "@/server/people/photos";
import { listRoleProfiles } from "@/server/staff/roles";
import { type SubstitutionStatus, substituteCandidates, substitutionsFor } from "@/server/staff/substitutions";
import { hasModule } from "@/server/platform/modules";

export const metadata: Metadata = { title: "Staff member" };

const TABS = ["overview", "profile", "access", "work", "substitutes", "attendance", "salary", "documents", "audit"] as const;
type Tab = (typeof TABS)[number];

const SUB_TONE: Record<SubstitutionStatus, "positive" | "info" | "neutral" | "warning"> = { ACTIVE: "positive", SCHEDULED: "info", EXPIRED: "neutral", ENDED: "warning" };

/**
 * One staff member, in tabs: Profile (details, status, login, reset
 * password), Access (their own permissions and what changed), Work (routes
 * and responsibilities), Substitutes (cover arranged for them, and cover
 * they give) and Attendance & leave. Records are archived through the
 * status, never deleted.
 */
export default async function StaffMemberPage(props: PageProps<"/school-admin/staff/[staffId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { staffId } = await props.params;
  const search = await props.searchParams;
  const tabParam = param(search.tab);
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "overview";
  const staff = await orNotFound(getStaff(ctx, staffId));
  const roleName = staff.roleProfile?.name ?? STAFF_ROLE_NAMES[staff.role as BaseStaffRole];
  const grants = allowedGrants(staff.role, staff.grants);
  const modulesFirst = STAFF_ROLE_MODULES[staff.role as BaseStaffRole] ?? [];
  const href = (next: Tab) => (next === "overview" ? `/school-admin/staff/${staff.id}` : `/school-admin/staff/${staff.id}?tab=${next}`) as Route;

  const [payrollOn, transportOn] = await Promise.all([hasModule(ctx, "PAYROLL"), hasModule(ctx, "TRANSPORT")]);
  const [photoUrl, substitutions, todayMark, onRoutes] = await Promise.all([
    photoUrlFor(ctx, { type: "STAFF", id: staff.id }),
    substitutionsFor(ctx, staff.id),
    ctx.db.staffAttendance.findFirst({ where: { staffMemberId: staff.id, date: today() }, select: { status: true } }),
    transportOn ? ctx.db.transportRoute.findMany({ where: { OR: [{ driverId: staff.id }, { attendantId: staff.id }] }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }) : Promise.resolve([]),
  ]);
  const activeCover = substitutions.coveredBy.filter((row) => row.status === "ACTIVE");
  const activeCovering = substitutions.covering.filter((row) => row.status === "ACTIVE");

  const name = fullName(staff);
  return (
    <>
      <ProfileHero
        back={{ href: "/school-admin/staff", label: "Non-teaching staff" }}
        name={name}
        photoUrl={photoUrl}
        presence={staff.status === "ACTIVE" ? "positive" : staff.status === "ON_LEAVE" ? "warning" : "neutral"}
        badge={<StatusBadge status={staff.status} />}
        role={roleName}
        lines={[[staff.designation, staff.department].filter(Boolean).join(" · ")]}
        chips={[
          { label: `EMP ID: ${staff.employeeId}`, tone: "neutral", icon: FingerprintIcon },
          staff.joiningDate ? { label: `Joined ${formatDate(staff.joiningDate)}`, tone: "neutral", icon: CalendarDaysIcon } : null,
          staff.user ? { label: !staff.user.isActive ? "Login disabled" : staff.user.activatedAt ? "Can sign in" : "Pending activation", tone: !staff.user.isActive ? "neutral" : staff.user.activatedAt ? "green" : "amber" } : { label: "No login", tone: "neutral" },
          ...activeCover.map((row) => ({ label: `Covered by ${row.substitute.name} until ${formatDate(row.endDate)}`, tone: "amber" as const })),
          ...activeCovering.map((row) => ({ label: `Covering for ${row.original.name} until ${formatDate(row.endDate)}`, tone: "cyan" as const })),
        ]}
        facts={[
          { label: "Workspace", value: STAFF_ROLE_WORKSPACE[staff.role as BaseStaffRole] ?? "As assigned", icon: BriefcaseIcon },
          { label: "Mobile", value: staff.phone ?? "—", icon: PhoneIcon },
          ...(transportOn && (onRoutes.length || staff.role === "DRIVER" || staff.role === "TRANSPORT_ATTENDANT") ? [{ label: "Routes", value: onRoutes.length ? onRoutes.map((route) => (route.code ? `${route.code} · ${route.name}` : route.name)).join(", ") : "None yet", icon: BusIcon }] : []),
        ]}
        actions={
          <>
            <HeroAction href={href("documents")} icon={SparklesIcon} label="Generate document" primary />
            <HeroAction href={href("profile")} icon={PencilIcon} label="Edit" />
            <HeroAction href={href("access")} icon={ShieldCheckIcon} label="Permissions" />
            <HeroAction href={href("attendance")} icon={CalendarCheckIcon} label="Attendance" />
          </>
        }
      />

      <ProfileTabs
        label="Staff member"
        tabs={[
          { href: href("overview"), label: "Overview", active: tab === "overview" },
          { href: href("profile"), label: "Employment details", active: tab === "profile" },
          { href: href("access"), label: "Role & access", count: grants.length, active: tab === "access" },
          { href: href("work"), label: transportOn && (staff.role === "DRIVER" || staff.role === "TRANSPORT_ATTENDANT") ? "Work & routes" : "Work", count: onRoutes.length || undefined, active: tab === "work" },
          { href: href("substitutes"), label: "Substitutes", count: activeCover.length + activeCovering.length || undefined, active: tab === "substitutes" },
          { href: href("attendance"), label: "Attendance & leave", active: tab === "attendance" },
          // Salary only for a school whose plan has payroll.
          ...(payrollOn ? [{ href: href("salary"), label: "Salary", active: tab === "salary" }] : []),
          { href: href("documents"), label: "Documents", active: tab === "documents" },
          { href: href("audit"), label: "Audit log", active: tab === "audit" },
        ]}
      />

      {tab === "overview" ? <OverviewTab ctx={ctx} staff={staff} grants={grants} todayMark={todayMark?.status ?? null} href={href} /> : null}
      {tab === "profile" ? <ProfileTab ctx={ctx} staff={staff} /> : null}
      {tab === "access" ? <AccessTab ctx={ctx} staff={staff} roleName={roleName} grants={grants} modulesFirst={modulesFirst} temporary={activeCovering} /> : null}
      {tab === "work" ? <WorkTab ctx={ctx} staff={staff} grants={grants} transportOn={transportOn} /> : null}
      {tab === "substitutes" ? <SubstitutesTab ctx={ctx} staff={staff} grants={grants} substitutions={substitutions} /> : null}
      {tab === "attendance" ? <AttendanceTab ctx={ctx} staffId={staff.id} month={param(search.month)} base={href("attendance")} /> : null}
      {tab === "salary" && payrollOn ? <SalaryTab ctx={ctx} staffId={staff.id} /> : null}
      {tab === "documents" ? <DocumentsTab ctx={ctx} staffId={staff.id} showArchived={param(search.archived) === "1"} /> : null}
      {tab === "audit" ? <AuditTab ctx={ctx} staffId={staff.id} by={param(search.by)} base={href("audit")} /> : null}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireTenant>>;
type Staff = Awaited<ReturnType<typeof getStaff>>;

/** Years and months since a date: "3 yrs 2 mos". */
function tenure(from: Date, to: Date) {
  const months = Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() - (to.getDate() < from.getDate() ? 1 : 0));
  const years = Math.floor(months / 12);
  return [years ? pluralize(years, "yr") : null, months % 12 || !years ? pluralize(months % 12, "mo") : null].filter(Boolean).join(" ");
}

/** At a glance: today, attendance, permissions, service — then what they are responsible for. */
async function OverviewTab({ ctx, staff, grants, todayMark, href }: { ctx: Ctx; staff: Staff; grants: string[]; todayMark: string | null; href: (tab: Tab) => Route }) {
  const now = today();
  const marks = await ctx.db.staffAttendance.groupBy({ by: ["status"], where: { staffMemberId: staff.id, date: { gte: addDays(now, -30), lte: now } }, _count: { _all: true } });
  const counts = Object.fromEntries(marks.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const markedDays = marks.reduce((sum, row) => sum + row._count._all, 0);
  const attended = attendedDays({ PRESENT: counts.PRESENT ?? 0, LATE: counts.LATE ?? 0, HALF_DAY: 0 });
  const byModule = new Map<string, string[]>();
  for (const grant of grants) {
    const def = grantDef(grant);
    if (!def) continue;
    byModule.set(def.module, [...(byModule.get(def.module) ?? []), def.label]);
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Today"
          icon={CalendarCheckIcon}
          tone={todayMark === "ABSENT" ? "red" : todayMark === "ON_LEAVE" ? "amber" : "green"}
          value={todayMark ? humanize(todayMark) : "Not marked"}
          valueClassName="text-xl"
          sub={formatDate(now)}
          href={href("attendance")}
        />
        <MetricTile label="Attendance" icon={FingerprintIcon} tone="green" value={markedDays ? `${Math.round((attended / markedDays) * 100)}%` : "—"} sub={markedDays ? `Last 30 days · ${pluralize(markedDays, "day")} marked` : "Not marked in 30 days"} foot={counts.ABSENT ? <TileChip tone="red">{`${counts.ABSENT} absent`}</TileChip> : null} href={href("attendance")} />
        <MetricTile label="Permissions" icon={KeyRoundIcon} tone="purple" value={grants.length} sub={grants.length ? `Across ${pluralize(byModule.size, "area")}` : "Only common pages"} href={href("access")} />
        <MetricTile label="Service" icon={BriefcaseIcon} tone="blue" value={staff.joiningDate ? tenure(staff.joiningDate, now) : "—"} valueClassName="text-xl" sub={staff.joiningDate ? `Since ${formatDate(staff.joiningDate)}` : "Joining date not recorded"} />
      </div>

      <DocumentShortcuts ctx={ctx} kind="STAFF" personId={staff.id} picks={["STAFF_ID_CARD", "EMPLOYMENT_VERIFICATION", "APPOINTMENT_LETTER"]} more={href("documents")} />

      <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Panel
          title="Responsibilities & scope"
          icon={ListChecksIcon}
          aside={
            <Link href={href("access")} className="text-primary text-sm font-semibold hover:underline">
              Change
            </Link>
          }
        >
          {byModule.size ? (
            <ul className="flex flex-col gap-2">
              {[...byModule.entries()].map(([module, labels]) => (
                <SoftRow key={module} className="items-start">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{STAFF_MODULE_LABEL[module as keyof typeof STAFF_MODULE_LABEL] ?? module}</span>
                      <TileChip tone="neutral">{pluralize(labels.length, "permission")}</TileChip>
                    </span>
                    <span className="text-muted-foreground block text-sm">{labels.join(" · ")}</span>
                  </span>
                </SoftRow>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No module permissions — they see only the pages every staff member has.</p>
          )}
        </Panel>
        <Panel title="Contact & employment" icon={PhoneIcon} tone="cyan">
          <dl className="flex flex-col gap-2 text-sm">
            {[
              { label: "Mobile", value: staff.phone ?? "—", href: staff.phone ? `tel:${staff.phone.replace(/\s/g, "")}` : null },
              { label: "Email", value: staff.email ?? "—", href: staff.email ? `mailto:${staff.email}` : null },
              { label: "Job title / department", value: [staff.designation, staff.department].filter(Boolean).join(" · ") || "—", href: null },
              { label: "Joined", value: staff.joiningDate ? formatDate(staff.joiningDate) : "—", href: null },
              { label: "Login", value: staff.user ? (staff.user.isActive ? (staff.user.activatedAt ? "Can sign in" : "Pending activation") : "Disabled") : "No login", href: null },
            ].map((item) => (
              <SoftRow key={item.label} className="justify-between py-2.5">
                <dt className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{item.label}</dt>
                <dd className="min-w-0 truncate text-right font-medium">
                  {item.href ? (
                    <a href={item.href} className="text-primary hover:underline">
                      {item.value}
                    </a>
                  ) : (
                    item.value
                  )}
                </dd>
              </SoftRow>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

async function ProfileTab({ ctx, staff }: { ctx: Ctx; staff: Staff }) {
  const [invites, roles] = await Promise.all([activationEmailStatuses(ctx, [staff.user?.id]), listRoleProfiles(ctx)]);
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Basic information</CardTitle>
          <CardDescription>Name, role, department, contact and joining date.</CardDescription>
        </CardHeader>
        <CardContent>
          <StaffForm roles={roles.map((role) => ({ value: role.id, label: role.name }))} staff={{ ...staff, joiningDate: staff.joiningDate ? toDateInput(staff.joiningDate) : "", dateOfBirth: staff.dateOfBirth ? toDateInput(staff.dateOfBirth) : "" }} />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        {/* Activate, deactivate, archive: a status change with its history — never a delete. */}
        <LifecyclePanel ctx={ctx} person="STAFF" personId={staff.id} />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Staff sign in at the usual login page and land in the staff portal — never the School Admin screens.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {staff.user ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{staff.user.email}</span>
                  <StatusBadge
                    status={staff.user.isActive ? "ACTIVE" : "INACTIVE"}
                    label={!staff.user.isActive ? "Disabled" : staff.user.activatedAt ? "Can sign in" : "Pending activation"}
                    tone={!staff.user.isActive ? "neutral" : staff.user.activatedAt ? "positive" : "warning"}
                  />
                </div>
                {staff.user.isActive && !staff.user.activatedAt ? <ActivationEmailNote invite={invites.get(staff.user.id)} /> : null}
                <p className="text-muted-foreground">
                  {staff.user.lastLoginAt ? `Last signed in ${formatDateTime(staff.user.lastLoginAt)}.` : "Has not signed in yet."}
                  {staff.user.isActive ? "" : " Set the status back to Active to let them sign in again."}
                </p>
                <ResetPortalPasswordForm userId={staff.user.id} pending={!staff.user.activatedAt} />
              </>
            ) : !["ACTIVE", "ON_LEAVE"].includes(staff.status) ? (
              <p className="text-muted-foreground">Inactive staff cannot be given a login.</p>
            ) : (
              <StaffLoginForm staffId={staff.id} defaultEmail={staff.email} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function AccessTab({
  ctx,
  staff,
  roleName,
  grants,
  modulesFirst,
  temporary,
}: {
  ctx: Ctx;
  staff: Staff;
  roleName: string;
  grants: ReturnType<typeof allowedGrants>;
  modulesFirst: (typeof STAFF_MODULES)[number][];
  temporary: Awaited<ReturnType<typeof substitutionsFor>>["covering"];
}) {
  const [history, summary, roles] = await Promise.all([staffAccessHistory(ctx, staff.id), staffPermissionSummary(ctx, staff.id), listRoleProfiles(ctx)]);
  const label = (key: string) => grantDef(key)?.label ?? key;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_1fr]">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Permission summary</CardTitle>
          <CardDescription>
            Role <strong>{summary.roleName}</strong> · workspace <strong>{STAFF_ROLE_WORKSPACE[staff.role as BaseStaffRole] ?? "As assigned"}</strong>. Responsibilities below only decide what this person may do; the School Admin keeps full access to every workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Role defaults", summary.defaults.length],
                ["Custom added", summary.added.length],
                ["Custom removed", summary.removed.length],
                ["Effective", summary.effective.length],
              ].map(([name, value]) => (
                <div key={name} className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-muted-foreground text-xs">{name}</p>
                  <p className="text-lg font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            {summary.added.length ? <p className="text-sm"><span className="text-success-strong font-medium">Added:</span> {summary.added.map(label).join(", ")}</p> : null}
            {summary.removed.length ? <p className="text-sm"><span className="text-danger font-medium">Removed:</span> {summary.removed.map(label).join(", ")}</p> : null}
            {summary.added.length || summary.removed.length ? (
              <div>
                <ActionButton
                  action={restoreRoleDefaultsAction}
                  fields={{ staffId: staff.id }}
                  variant="outline"
                  confirm={{ title: "Restore the role's default permissions?", description: `Your custom changes for this person are undone: they get exactly the ${summary.roleName} defaults.`, confirmLabel: "Restore defaults" }}
                >
                  Restore role defaults
                </ActionButton>
              </div>
            ) : null}
          </div>
          <RoleChangeForm staffId={staff.id} currentRoleId={staff.roleProfileId} roles={roles.filter((role) => !role.archivedAt).map((role) => ({ value: role.id, label: role.name }))} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>
            Role: <strong>{roleName}</strong>
            {staff.roleProfile ? (
              <>
                {" · "}
                <Link href={`/school-admin/staff/roles/${staff.roleProfile.id}` as Route} className="underline">
                  role defaults
                </Link>
              </>
            ) : null}
            . Besides these, every staff member has their profile, attendance, leave, notices, events and meetings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffGrantsForm staffId={staff.id} baseRole={staff.role} roleName={roleName} grants={grants} modulesFirst={modulesFirst} />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Assigned modules</CardTitle>
            <CardDescription>&quot;Limited&quot;: the server narrows it to their own assignment.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <PermissionMatrix grants={grants} baseRole={staff.role} />
            {temporary.length ? (
              <div className="bg-info-soft rounded-xl p-3 text-sm">
                <p className="font-medium">Also, until the substitution ends:</p>
                {temporary.map((row) => (
                  <p key={row.id} className="text-muted-foreground text-xs">
                    Covering for {row.original.name} until {formatDate(row.endDate)}: {row.grants.map((key) => grantDef(key)?.label ?? key).join(", ") || "routes only"}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Access history</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length ? (
              <ul className="divide-y text-sm">
                {history.map((row) => (
                  <li key={row.id} className="py-2">
                    {row.summary}
                    <span className="text-muted-foreground block text-xs">
                      {formatDateTime(row.createdAt)}
                      {row.actor ? ` · ${fullName(row.actor)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No changes recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function WorkTab({ ctx, staff, grants, transportOn }: { ctx: Ctx; staff: Staff; grants: string[]; transportOn: boolean }) {
  // Routes only where the school's plan has transport.
  const crew = !transportOn ? null : staff.role === "DRIVER" ? ("DRIVER" as const) : staff.role === "TRANSPORT_ATTENDANT" ? ("ATTENDANT" as const) : null;
  const [work, routes, vehicles, drivers, attendants] = await Promise.all([
    staffAssignments(ctx, staff.id),
    transportOn ? listRoutes(ctx) : Promise.resolve([]),
    transportOn ? listVehicles(ctx) : Promise.resolve([]),
    staffOptions(ctx, ["DRIVER"]),
    staffOptions(ctx, ["TRANSPORT_ATTENDANT"]),
  ]);
  const mine = routes.filter((route) => route.driver?.id === staff.id || route.attendant?.id === staff.id);
  const vehicleOptions = vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.registrationNo} (${vehicle.capacity} seats)` }));
  // Other routes, each with who is on it now, so a replacement is never a surprise.
  const routeOptions = (exclude: string[]) =>
    routes
      .filter((route) => !exclude.includes(route.id))
      .map((route) => {
        const seat = crew === "ATTENDANT" ? route.attendant : route.driver;
        const name = route.code ? `${route.code} · ${route.name}` : route.name;
        // Whole sentences, so each reads naturally once translated.
        const label = seat
          ? route.isActive
            ? `${name} — now ${fullName(seat)}`
            : `${name} — now ${fullName(seat)} (not running)`
          : route.isActive
            ? `${name} — no one yet`
            : `${name} — no one yet (not running)`;
        return { value: route.id, label };
      });
  const modules = STAFF_MODULES.filter((module) => grants.some((key) => key.startsWith(`${module}.`)));

  return (
    <div className="flex flex-col gap-6">
      {crew || mine.length ? (
        <section aria-labelledby="routes" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="routes" className="flex items-center gap-2 text-base font-semibold">
              <BusIcon className="size-4" aria-hidden />
              Routes
              <span className="text-muted-foreground text-sm font-normal">
                {mine.length ? `${mine.length} · ${crew === "ATTENDANT" ? "attends" : "drives"}` : "none yet"}
              </span>
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/school-admin/transport">All routes</Link>
            </Button>
          </div>

          {mine.map((route) => {
            const as = route.driver?.id === staff.id ? "Driver" : "Attendant";
            return (
              <Card key={route.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {route.code ? <span className="bg-primary-soft text-primary-strong rounded-md px-1.5 py-0.5 text-xs font-bold">{route.code}</span> : null}
                    {route.name}
                    <StatusBadge status="ACTIVE" tone="info" label={as} />
                    {!route.isActive ? <StatusBadge status="INACTIVE" label="Not running" /> : null}
                  </CardTitle>
                  <CardDescription>
                    {[
                      route.startPoint || route.endPoint ? `${route.startPoint ?? "—"} → ${route.endPoint ?? "—"}` : null,
                      route.vehicle ? `${route.vehicle.registrationNo} (${route.vehicle.capacity} seats)` : "No vehicle",
                      `${route.riders} students`,
                      as === "Driver" ? (route.attendant ? `Attendant: ${fullName(route.attendant)}` : "No attendant") : route.driver ? `Driver: ${fullName(route.driver)}` : "No driver",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {/* Send them elsewhere, or take them off. */}
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-64 flex-1">
                      <MoveCrewForm staffId={staff.id} fromRouteId={route.id} routes={routeOptions([route.id])} />
                    </div>
                    <ActionButton
                      action={removeRouteCrewAction}
                      fields={{ routeId: route.id, staffId: staff.id }}
                      variant="ghost"
                      size="sm"
                      confirm={{ title: `Take ${fullName(staff)} off ${route.name}?`, description: "The route keeps its stops and students; assign someone else to it.", confirmLabel: "Take off" }}
                    >
                      Remove from route
                    </ActionButton>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/school-admin/transport/${route.id}` as Route}>Students on this route</Link>
                    </Button>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-2">
                    <div className="flex flex-col gap-3">
                      <h3 className="text-sm font-semibold">{`Stops (${route.stops.length})`}</h3>
                      {route.stops.length ? (
                        <ol className="divide-y rounded-xl border text-sm">
                          {route.stops.map((stop) => (
                            <li key={stop.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                              <span className="w-6 tabular-nums">{stop.sequence}.</span>
                              <span className="min-w-0 flex-1">
                                {stop.name}
                                {stop.location ? <span className="text-muted-foreground block text-xs">{stop.location}</span> : null}
                              </span>
                              <span className="text-muted-foreground text-xs tabular-nums">
                                {stop.pickupMinute !== null ? formatMinutes(stop.pickupMinute) : "—"} / {stop.dropMinute !== null ? formatMinutes(stop.dropMinute) : "—"}
                              </span>
                              <ActionButton action={removeStopAction} fields={{ stopId: stop.id }} variant="ghost" size="xs" confirm={{ title: `Remove ${stop.name}?`, description: "Only a stop nobody boards at can be removed.", confirmLabel: "Remove" }}>
                                Remove
                              </ActionButton>
                              <details className="basis-full">
                                <summary className="text-muted-foreground cursor-pointer text-xs">Edit stop</summary>
                                <div className="mt-3">
                                  <StopForm
                                    routeId={route.id}
                                    nextSequence={stop.sequence}
                                    stop={{ id: stop.id, name: stop.name, location: stop.location, sequence: stop.sequence, pickupTime: stop.pickupMinute !== null ? minutesToTime(stop.pickupMinute) : "", dropTime: stop.dropMinute !== null ? minutesToTime(stop.dropMinute) : "" }}
                                  />
                                </div>
                              </details>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-muted-foreground text-sm">No stops yet — stops are optional; add them below.</p>
                      )}
                      <details className="rounded-xl border border-dashed p-3" open={!route.stops.length}>
                        <summary className="cursor-pointer text-sm font-medium">+ Add stop</summary>
                        <div className="mt-3">
                          <StopForm routeId={route.id} nextSequence={(route.stops.at(-1)?.sequence ?? 0) + 1} />
                        </div>
                      </details>
                    </div>
                    <details className="h-fit rounded-xl border p-3">
                      <summary className="cursor-pointer text-sm font-semibold">Edit route — name, number, start/end, vehicle, crew</summary>
                      <div className="mt-3">
                        <RouteForm
                          route={{ id: route.id, name: route.name, code: route.code, startPoint: route.startPoint, endPoint: route.endPoint, vehicleId: route.vehicle?.id ?? null, driverId: route.driver?.id ?? null, attendantId: route.attendant?.id ?? null, isActive: route.isActive, notes: route.notes }}
                          vehicles={vehicleOptions}
                          drivers={drivers}
                          attendants={attendants}
                        />
                      </div>
                    </details>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {crew ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>{mine.length ? "Also assign to a route" : "Assign to a route"}</CardTitle>
                  <CardDescription>{crew === "DRIVER" ? `Put ${fullName(staff)} on an existing route as its driver.` : `Put ${fullName(staff)} on an existing route as its attendant.`}</CardDescription>
                </CardHeader>
                <CardContent>
                  {routeOptions(mine.map((route) => route.id)).length ? (
                    <AssignCrewForm staffId={staff.id} as={crew} routes={routeOptions(mine.map((route) => route.id))} />
                  ) : (
                    <p className="text-muted-foreground text-sm">No other routes yet — create one.</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Create a new route</CardTitle>
                  <CardDescription>{crew === "DRIVER" ? `${fullName(staff)} is already filled in as its driver; add stops after saving.` : `${fullName(staff)} is already filled in as its attendant; add stops after saving.`}</CardDescription>
                </CardHeader>
                <CardContent>
                  <RouteForm vehicles={vehicleOptions} drivers={drivers} attendants={attendants} defaults={crew === "DRIVER" ? { driverId: staff.id } : { attendantId: staff.id }} />
                </CardContent>
              </Card>
            </div>
          ) : null}
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Responsibilities</CardTitle>
          <CardDescription>
            The modules their permissions open, and what they have done in them.{" "}
            <Link href={`/school-admin/staff/${staff.id}?tab=access` as Route} className="underline">
              Change permissions
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {modules.length ? (
            <ul className="flex flex-col gap-2">
              {modules.map((module) => (
                <li key={module}>
                  <span className="font-medium">{STAFF_MODULE_LABEL[module]}</span>
                  <span className="text-muted-foreground block text-xs">
                    {grants
                      .filter((key) => key.startsWith(`${module}.`))
                      .map((key) => grantDef(key)?.label ?? key)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No module permissions — only the common staff pages.</p>
          )}
          {work.loansIssued ? <p className="text-muted-foreground text-xs">{work.loansIssued} library loans issued.</p> : null}
          {work.paymentsTaken ? <p className="text-muted-foreground text-xs">{work.paymentsTaken} fee payments taken.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

async function SubstitutesTab({ ctx, staff, grants, substitutions }: { ctx: Ctx; staff: Staff; grants: string[]; substitutions: Awaited<ReturnType<typeof substitutionsFor>> }) {
  const [candidates, work] = await Promise.all([substituteCandidates(ctx, staff.id), staffAssignments(ctx, staff.id)]);
  const list = (rows: typeof substitutions.coveredBy, who: "substitute" | "original") =>
    rows.length ? (
      <ul className="divide-y text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{who === "substitute" ? row.substitute.name : row.original.name}</span>
              <span className="text-muted-foreground block text-xs">
                {formatDate(row.startDate)} – {formatDate(row.endDate)} · {row.reason}
                {row.grants.length ? ` · ${row.grants.map((key) => grantDef(key)?.label ?? key).join(", ")}` : ""}
                {row.coverRoutes ? " · routes" : ""}
              </span>
              <span className="text-muted-foreground block text-xs">
                Set by {row.createdBy ?? "—"} on {formatDate(row.createdAt)}
                {row.endedBy ? ` · ended early by ${row.endedBy}` : ""}
              </span>
            </span>
            <StatusBadge status={row.status} tone={SUB_TONE[row.status]} label={humanize(row.status)} />
            {row.status === "ACTIVE" || row.status === "SCHEDULED" ? (
              <ActionButton action={endSubstitutionAction} fields={{ substitutionId: row.id }} variant="ghost" size="xs" confirm={{ title: "End this substitution now?", description: "The temporary access stops immediately. The record is kept.", confirmLabel: "End now" }}>
                End now
              </ActionButton>
            ) : null}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-muted-foreground text-sm">None.</p>
    );
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RepeatIcon className="size-4" aria-hidden />
            Assign a substitute
          </CardTitle>
          <CardDescription>
            Someone to cover {fullName(staff)}&apos;s work for a few days. They get the access below for exactly those days; it expires by itself. {fullName(staff)}&apos;s own access and routes are not changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staff.status === "ACTIVE" || staff.status === "ON_LEAVE" ? (
            <SubstitutionForm originalStaffId={staff.id} originalGrants={grants} candidates={candidates} today={toDateInput(today())} hasRoutes={work.routes.some((route) => route.isActive)} />
          ) : (
            <EmptyState title="Not a current staff member">Substitutes are arranged for active staff or staff on leave.</EmptyState>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Covered by others</CardTitle>
            <CardDescription>Current, upcoming and past substitutes for {fullName(staff)}.</CardDescription>
          </CardHeader>
          <CardContent>{list(substitutions.coveredBy, "substitute")}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Covering for others</CardTitle>
          </CardHeader>
          <CardContent>{list(substitutions.covering, "original")}</CardContent>
        </Card>
        <p className="text-muted-foreground text-xs">
          Teachers are covered period by period on{" "}
          <Link href="/school-admin/substitutes" className="underline">
            Teachers → Cover
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * Their salary structure (effective-dated: a raise is a new row, so the
 * history stays), and the months they have been paid. Payments are recorded
 * from Finance → Payroll or Salaries.
 */
async function SalaryTab({ ctx, staffId }: { ctx: Ctx; staffId: string }) {
  const salary = await getStaffSalary(ctx, staffId);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Salary structure</CardTitle>
          <CardDescription>
            {salary.current
              ? `Now ${rupees(salary.current.netMinor)} net (${rupees(salary.current.amountMinor)} + ${rupees(salary.current.allowancesMinor)} − ${rupees(salary.current.deductionsMinor)}), ${salary.current.salaryType.toLowerCase()}.`
              : "No salary set yet. Enter it here; it then appears in the monthly payroll."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {salary.history.length ? (
            <ul className="divide-y rounded-lg border">
              {salary.history.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">{formatDate(row.effectiveFrom)}</span>
                  <span className="min-w-0 flex-1 tabular-nums">
                    {rupees(row.netMinor)} net
                    <span className="text-muted-foreground block text-xs">
                      {rupees(row.amountMinor)} + {rupees(row.allowancesMinor)} − {rupees(row.deductionsMinor)}
                    </span>
                  </span>
                  {row.current ? <StatusBadge status="ACTIVE" label="Current" /> : null}
                  {row.effectiveFrom > today() ? <StatusBadge status="PENDING" label="Scheduled" /> : null}
                  <ActionButton
                    action={removeSalaryAction}
                    fields={{ salaryId: row.id }}
                    variant="ghost"
                    size="xs"
                    confirm={{ title: "Remove this salary record?", description: "The figure before it becomes current again. Use this for a row entered by mistake.", confirmLabel: "Remove" }}
                  >
                    Remove
                  </ActionButton>
                </li>
              ))}
            </ul>
          ) : null}
          <SalaryForm
            staffMemberId={staffId}
            today={toDateInput(today())}
            current={
              salary.current
                ? {
                    salaryType: salary.current.salaryType,
                    amountRupees: toRupeeInput(salary.current.amountMinor),
                    allowancesRupees: toRupeeInput(salary.current.allowancesMinor),
                    deductionsRupees: toRupeeInput(salary.current.deductionsMinor),
                  }
                : undefined
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Salary paid</CardTitle>
          <CardDescription>The last 24 months. Pay from Finance → Payroll.</CardDescription>
        </CardHeader>
        <CardContent>
          {salary.payments.length ? (
            <ul className="divide-y text-sm">
              {salary.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{formatMonth(payment.forMonth)}</span>
                    <span className="text-muted-foreground block text-xs">
                      Paid {formatDate(payment.paidOn)} · {humanize(payment.method)}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums">{rupees(payment.amountMinor)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No salary paid yet.</p>
          )}
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/school-admin/finance/payroll">Open monthly payroll</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Private documents on their record. Archiving keeps the file and the history. */
async function DocumentsTab({ ctx, staffId, showArchived }: { ctx: Ctx; staffId: string; showArchived: boolean }) {
  const documents = await listStaffDocuments(ctx, staffId, { archived: showArchived });
  const VERIFY_TONE = { PENDING: "neutral", VERIFIED: "positive", REJECTED: "negative" } as const;
  return (
    <>
    <div className="mb-6">
      <PersonDocuments ctx={ctx} kind="STAFF" personId={staffId} />
    </div>
    <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Only School Admins of this school can open them.{" "}
            <Link href={`/school-admin/staff/${staffId}?tab=documents${showArchived ? "" : "&archived=1"}` as Route} className="underline">
              {showArchived ? "Hide removed" : "Show removed"}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length ? (
            <ul className="divide-y">
              {documents.map((doc) => (
                <li key={doc.id} className={`flex flex-col gap-2 py-3 ${doc.archivedAt ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a href={`/api/v1/staff-documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {DOCUMENT_TYPE_LABEL[doc.type]}
                      {doc.label ? ` — ${doc.label}` : ""}
                    </a>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={doc.verification} tone={VERIFY_TONE[doc.verification]} label={doc.verification === "PENDING" ? "Not checked" : humanize(doc.verification)} />
                      {doc.archivedAt ? <StatusBadge status="ARCHIVED" label="Removed" /> : null}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {doc.fileName} · {Math.max(1, Math.round(doc.size / 1024))} KB · uploaded {formatDateTime(doc.createdAt)}
                    {doc.notes ? ` · ${doc.notes}` : ""}
                  </p>
                  {!doc.archivedAt ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <DocumentVerificationForm documentId={doc.id} verification={doc.verification} />
                      <ActionButton
                        action={archiveStaffDocumentAction}
                        fields={{ documentId: doc.id }}
                        variant="ghost"
                        confirm={{ title: "Remove this document from the record?", description: "It is kept in the history (Show removed) and on the audit log.", confirmLabel: "Remove" }}
                      >
                        Remove
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No documents yet.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Upload a document</CardTitle>
          <CardDescription>Aadhaar, PAN and the rest are optional — upload what your school keeps.</CardDescription>
        </CardHeader>
        <CardContent>
          <StaffDocumentForm staffId={staffId} />
        </CardContent>
      </Card>
    </div>
    </>
  );
}

/** What was done to their record, and what they did themselves — in words, with the details one click away. */
async function AuditTab({ ctx, staffId, by, base }: { ctx: Ctx; staffId: string; by: string | undefined; base: Route }) {
  const view = by === "BY" ? "BY" : by === "ABOUT" ? "ABOUT" : "ALL";
  const rows = await staffAuditLog(ctx, staffId, { by: view });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Every entry names who really did it. Entries are never edited or deleted.</CardDescription>
      </CardHeader>
      <CardContent>
        <ViewTabs
          label="Audit view"
          tabs={[
            { href: base, label: "Everything", active: view === "ALL" },
            { href: `${base}&by=ABOUT` as Route, label: "Changes to their record", active: view === "ABOUT" },
            { href: `${base}&by=BY` as Route, label: "Done by them", active: view === "BY" },
          ]}
        />
        <AuditEntries rows={rows} />
      </CardContent>
    </Card>
  );
}

async function AttendanceTab({ ctx, staffId, month: monthParam, base }: { ctx: Ctx; staffId: string; month: string | undefined; base: Route }) {
  const month = parseDateInput(monthParam ? `${monthParam}-01` : null) ?? undefined;
  const record = await staffRecord(ctx, staffId, month);
  const monthKey = (date: Date) => date.toISOString().slice(0, 7);
  const shift = (by: number) => monthKey(new Date(Date.UTC(record.from.getUTCFullYear(), record.from.getUTCMonth() + by, 1)));
  const monthLabel = record.from.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Attendance · {monthLabel}</CardTitle>
          <CardDescription>
            <Link href={`${base}&month=${shift(-1)}` as Route} className="underline">
              ← Previous
            </Link>
            {" · "}
            <Link href={`${base}&month=${shift(1)}` as Route} className="underline">
              Next →
            </Link>
            {" · "}
            <Link href="/school-admin/attendance/staff" className="underline">
              Mark or correct
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-4 gap-2 text-center">
            {(["PRESENT", "LATE", "ABSENT", "ON_LEAVE"] as const).map((status) => (
              <div key={status} className="bg-muted/50 rounded-lg px-1 py-2">
                <dt className="text-muted-foreground text-[11px]">{humanize(status)}</dt>
                <dd className="font-semibold tabular-nums">{record.counts[status]}</dd>
              </div>
            ))}
          </dl>
          {record.days.length ? (
            <ul className="max-h-72 divide-y overflow-y-auto text-sm">
              {record.days.map((day) => (
                <li key={day.date.toISOString()} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    {formatDayShort(day.date)}
                    {day.remarks ? <span className="text-muted-foreground block text-xs">{day.remarks}</span> : null}
                  </span>
                  <StatusBadge status={day.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing marked this month.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Leave</CardTitle>
          <CardDescription>
            Latest 20 requests.{" "}
            <Link href="/school-admin/leave" className="underline">
              Decide pending leave
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {record.leave.length ? (
            <ul className="divide-y text-sm">
              {record.leave.map((leave) => (
                <li key={leave.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    {humanize(leave.type)} · {formatDate(leave.startDate)}
                    {leave.endDate.getTime() !== leave.startDate.getTime() ? ` – ${formatDate(leave.endDate)}` : ""}
                    <span className="text-muted-foreground block truncate text-xs">{leave.reason}</span>
                  </span>
                  <StatusBadge status={leave.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No leave requested.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
