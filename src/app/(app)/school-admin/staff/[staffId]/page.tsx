import type { Metadata, Route } from "next";
import Link from "next/link";
import { BusIcon, RepeatIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PersonPhoto } from "@/components/shared/person-photo";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
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
import { formatDate, formatDateTime, formatDayShort, formatMinutes, minutesToTime, parseDateInput, today, toDateInput } from "@/lib/dates";
import { fullName, humanize, pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { type BaseStaffRole, STAFF_MODULE_LABEL, STAFF_MODULES, STAFF_ROLE_MODULES, STAFF_ROLE_NAMES, allowedGrants, grantDef } from "@/lib/staff-access";
import { activationEmailStatuses } from "@/server/auth/account-links";
import { requireTenant } from "@/server/auth/current-user";
import { getStaff, staffAccessHistory, staffAssignments, staffOptions, staffRecord } from "@/server/operations/staff";
import { orNotFound } from "@/server/page-helpers";
import { photoUrlFor } from "@/server/people/photos";
import { listRoleProfiles } from "@/server/staff/roles";
import { type SubstitutionStatus, substituteCandidates, substitutionsFor } from "@/server/staff/substitutions";

export const metadata: Metadata = { title: "Staff member" };

const TABS = ["profile", "access", "work", "substitutes", "attendance"] as const;
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
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "profile";
  const staff = await orNotFound(getStaff(ctx, staffId));
  const roleName = staff.roleProfile?.name ?? STAFF_ROLE_NAMES[staff.role as BaseStaffRole];
  const grants = allowedGrants(staff.role, staff.grants);
  const modulesFirst = STAFF_ROLE_MODULES[staff.role as BaseStaffRole] ?? [];
  const href = (next: Tab) => (next === "profile" ? `/school-admin/staff/${staff.id}` : `/school-admin/staff/${staff.id}?tab=${next}`) as Route;

  const [photoUrl, substitutions, todayMark, onRoutes] = await Promise.all([
    photoUrlFor(ctx, { type: "STAFF", id: staff.id }),
    substitutionsFor(ctx, staff.id),
    ctx.db.staffAttendance.findFirst({ where: { staffMemberId: staff.id, date: today() }, select: { status: true } }),
    ctx.db.transportRoute.findMany({ where: { OR: [{ driverId: staff.id }, { attendantId: staff.id }] }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
  ]);
  const activeCover = substitutions.coveredBy.filter((row) => row.status === "ACTIVE");
  const activeCovering = substitutions.covering.filter((row) => row.status === "ACTIVE");

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/staff", label: "Non-teaching staff" }}
        title={fullName(staff)}
        description={[roleName, staff.employeeId, staff.department].filter(Boolean).join(" · ")}
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <PersonPhoto name={fullName(staff)} photoUrl={photoUrl} who="The staff member" />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={staff.status} />
          {staff.user ? <StatusBadge status={staff.user.isActive ? "ACTIVE" : "INACTIVE"} label={staff.user.isActive ? "Has a login" : "Login disabled"} tone={staff.user.isActive ? "positive" : "neutral"} /> : <StatusBadge status="INACTIVE" tone="neutral" label="No login" />}
          {activeCover.map((row) => (
            <StatusBadge key={row.id} status="ACTIVE" tone="warning" label={`Covered by ${row.substitute.name} until ${formatDate(row.endDate)}`} />
          ))}
          {activeCovering.map((row) => (
            <StatusBadge key={row.id} status="ACTIVE" tone="info" label={`Covering for ${row.original.name} until ${formatDate(row.endDate)}`} />
          ))}
        </div>
      </div>

      {/* Everything about them at a glance; each tab below is where it is changed. */}
      <Card size="sm" className="mb-4">
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Role", value: roleName, href: staff.roleProfile ? (`/school-admin/staff/roles/${staff.roleProfile.id}` as Route) : null },
              { label: "Employee ID", value: staff.employeeId },
              { label: "Job title / department", value: [staff.designation, staff.department].filter(Boolean).join(" · ") || "—" },
              { label: "Mobile", value: staff.phone ?? "—", href: staff.phone ? (`tel:${staff.phone.replace(/\s/g, "")}` as Route) : null },
              { label: "Email", value: staff.email ?? "—" },
              { label: "Joined", value: staff.joiningDate ? formatDate(staff.joiningDate) : "—" },
              { label: "Today", value: todayMark ? humanize(todayMark.status) : "Not marked", href: href("attendance") },
              { label: "Login", value: staff.user ? (staff.user.isActive ? (staff.user.activatedAt ? "Can sign in" : "Pending activation") : "Disabled") : "No login", href: href("profile") },
              { label: "Permissions", value: grants.length ? pluralize(grants.length, "permission") : "Only common pages", href: href("access") },
              ...(onRoutes.length || staff.role === "DRIVER" || staff.role === "TRANSPORT_ATTENDANT"
                ? [{ label: "Routes", value: onRoutes.length ? onRoutes.map((route) => (route.code ? `${route.code} · ${route.name}` : route.name)).join(", ") : "None yet", href: href("work") }]
                : []),
            ].map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-muted-foreground text-xs">{item.label}</dt>
                <dd className="truncate font-medium">
                  {item.href ? (
                    <Link href={item.href} className="hover:underline">
                      {item.value}
                    </Link>
                  ) : (
                    item.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <ViewTabs
        label="Staff member"
        tabs={[
          { href: href("profile"), label: "Profile", active: tab === "profile" },
          { href: href("access"), label: "Role & access", count: grants.length, active: tab === "access" },
          { href: href("work"), label: staff.role === "DRIVER" || staff.role === "TRANSPORT_ATTENDANT" ? "Work & routes" : "Work", count: onRoutes.length || undefined, active: tab === "work" },
          { href: href("substitutes"), label: "Substitutes", count: activeCover.length + activeCovering.length || undefined, active: tab === "substitutes" },
          { href: href("attendance"), label: "Attendance & leave", active: tab === "attendance" },
        ]}
      />

      {tab === "profile" ? <ProfileTab ctx={ctx} staff={staff} /> : null}
      {tab === "access" ? <AccessTab ctx={ctx} staff={staff} roleName={roleName} grants={grants} modulesFirst={modulesFirst} temporary={activeCovering} /> : null}
      {tab === "work" ? <WorkTab ctx={ctx} staff={staff} grants={grants} /> : null}
      {tab === "substitutes" ? <SubstitutesTab ctx={ctx} staff={staff} grants={grants} substitutions={substitutions} /> : null}
      {tab === "attendance" ? <AttendanceTab ctx={ctx} staffId={staff.id} month={param(search.month)} base={href("attendance")} /> : null}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireTenant>>;
type Staff = Awaited<ReturnType<typeof getStaff>>;

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
          <StaffForm roles={roles.map((role) => ({ value: role.id, label: role.name }))} staff={{ ...staff, joiningDate: staff.joiningDate ? toDateInput(staff.joiningDate) : "" }} />
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
  const history = await staffAccessHistory(ctx, staff.id);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_1fr]">
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

async function WorkTab({ ctx, staff, grants }: { ctx: Ctx; staff: Staff; grants: string[] }) {
  const crew = staff.role === "DRIVER" ? ("DRIVER" as const) : staff.role === "TRANSPORT_ATTENDANT" ? ("ATTENDANT" as const) : null;
  const [work, routes, vehicles, drivers, attendants] = await Promise.all([
    staffAssignments(ctx, staff.id),
    listRoutes(ctx),
    listVehicles(ctx),
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
