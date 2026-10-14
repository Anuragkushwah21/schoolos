import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpenCheckIcon,
  BriefcaseIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ClockIcon,
  FingerprintIcon,
  GraduationCapIcon,
  PencilIcon,
  SettingsIcon,
  SparklesIcon,
  UserRoundIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { DocumentShortcuts, PersonDocuments } from "@/features/documents/person-documents";
import { removeSalaryAction } from "@/features/finance/actions";
import { SalaryForm } from "@/features/finance/forms";
import { rupees, toRupeeInput } from "@/features/finance/money";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { HeroAction, MetricTile, Panel, ProfileHero, ProfileTabs, SoftRow, TileChip } from "@/features/people/profile-ui";
import { TeacherWeekCard } from "@/features/people/teacher-week";
import { deleteTeacherAction, unassignSubjectAction } from "@/features/school/people-actions";
import { AssignSubjectForm, EditTeacherForm, LoginStatus, ResetPortalPasswordForm } from "@/features/school/people-forms";
import { attendedDays } from "@/lib/attendance";
import { addDays, formatDate, formatDateTime, toDateInput, today } from "@/lib/dates";
import { formatPercent, humanize, pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { academicMonitoring } from "@/server/academics/progress";
import { type AdmissionSeatOptions, admissionSeatOptions, groupLabel } from "@/server/academics/streams";
import { classSectionOptions, listSubjects } from "@/server/academics/structure";
import { activationEmailStatuses } from "@/server/auth/account-links";
import { type TenantContext, requireTenant } from "@/server/auth/current-user";
import { getTeacherSalary } from "@/server/finance/salary";
import { orNotFound } from "@/server/page-helpers";
import { photoUrlFor } from "@/server/people/photos";
import { getTeacherProfile } from "@/server/people/teachers";
import { hasModule } from "@/server/platform/modules";

export const metadata: Metadata = { title: "Teacher" };

const TABS = ["overview", "teaching", "documents", "salary", "account"] as const;
type Tab = (typeof TABS)[number];
type Profile = Awaited<ReturnType<typeof getTeacherProfile>>;
type Teacher = Profile["teacher"];

const PRESENCE: Record<string, "positive" | "warning" | "negative" | "neutral"> = { ACTIVE: "positive", ON_LEAVE: "warning", SUSPENDED: "negative" };

/** "Class 10" + "B" → "10B"; "Nursery" + "A" → "NuA". */
function shortSection(className: string, section: string) {
  const digits = className.match(/\d+/)?.[0];
  return `${digits ?? className.slice(0, 2)}${section}`;
}

/**
 * One teacher, in tabs: Overview (workload, attendance, syllabus coverage,
 * what they teach), Teaching (assign and remove subjects, their week),
 * Documents, Salary (School Admin, with payroll) and Account (login, status,
 * details, delete). Every figure is read from the records.
 */
export default async function TeacherPage(props: PageProps<"/school-admin/teachers/[teacherId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { teacherId } = await props.params;
  const search = await props.searchParams;
  const profile = await orNotFound(getTeacherProfile(ctx, teacherId));
  const { teacher, session } = profile;

  // Salary only for a school whose plan has payroll, and only for the School Admin: the Principal does not see salaries.
  const salaryOn = ctx.user.role === "SCHOOL_ADMIN" && (await hasModule(ctx, "PAYROLL"));
  const tabParam = param(search.tab);
  const tab: Tab = TABS.includes(tabParam as Tab) && (tabParam !== "salary" || salaryOn) ? (tabParam as Tab) : "overview";
  const href = (next: Tab) => (next === "overview" ? `/school-admin/teachers/${teacher.id}` : `/school-admin/teachers/${teacher.id}?tab=${next}`);
  const photoUrl = await photoUrlFor(ctx, { type: "TEACHER", id: teacher.id });
  const name = `${teacher.firstName} ${teacher.lastName}`;

  return (
    <>
      <ProfileHero
        back={{ href: "/school-admin/teachers", label: "Teachers" }}
        session={session?.name}
        name={name}
        photoUrl={photoUrl}
        presence={PRESENCE[teacher.status] ?? "neutral"}
        badge={<StatusBadge status={teacher.status} />}
        role={[teacher.designation ?? "Teacher", teacher.classTeacherOf.length ? `Class teacher ${teacher.classTeacherOf.map((s) => shortSection(s.class.name, s.name)).join(", ")}` : null].filter(Boolean).join(" & ")}
        chips={[
          { label: teacher.employeeId, tone: "neutral", icon: FingerprintIcon },
          teacher.joiningDate ? { label: `Joined ${formatDate(teacher.joiningDate)}`, tone: "neutral", icon: CalendarDaysIcon } : null,
          teacher.qualification ? { label: teacher.qualification, tone: "purple", icon: GraduationCapIcon } : null,
        ]}
        actions={
          <>
            <HeroAction href={href("documents")} icon={SparklesIcon} label="Generate document" primary />
            <HeroAction href={href("account")} icon={PencilIcon} label="Edit" />
            <HeroAction href={`/school-admin/timetable?teacher=${teacher.id}`} icon={CalendarClockIcon} label="Timetable" />
          </>
        }
      />

      <ProfileTabs
        label="Teacher"
        tabs={[
          { href: href("overview"), label: "Overview", active: tab === "overview" },
          { href: href("teaching"), label: "Teaching assignments", count: teacher.assignments.length, active: tab === "teaching" },
          { href: href("documents"), label: "Documents", active: tab === "documents" },
          ...(salaryOn ? [{ href: href("salary"), label: "Salary", active: tab === "salary" }] : []),
          { href: href("account"), label: "Account", active: tab === "account" },
        ]}
      />

      {tab === "overview" ? <OverviewTab ctx={ctx} profile={profile} href={href} /> : null}
      {tab === "teaching" ? <TeachingTab ctx={ctx} profile={profile} /> : null}
      {tab === "documents" ? <PersonDocuments ctx={ctx} kind="TEACHER" personId={teacher.id} /> : null}
      {tab === "salary" && salaryOn ? <SalaryTab ctx={ctx} teacher={teacher} /> : null}
      {tab === "account" ? <AccountTab ctx={ctx} teacher={teacher} name={name} /> : null}
    </>
  );
}

async function OverviewTab({ ctx, profile, href }: { ctx: TenantContext; profile: Profile; href: (tab: Tab) => string }) {
  const { teacher, session, periodsPerWeek } = profile;
  const now = today();
  const sessionStart = session ? (await ctx.db.academicSession.findFirst({ where: { id: session.id }, select: { startDate: true } }))?.startDate : null;
  const sectionIds = [...new Set(teacher.assignments.map((row) => row.section.id))];
  const [marks, todayMark, slots, strength, monitoring] = await Promise.all([
    ctx.db.teacherAttendance.groupBy({ by: ["status"], where: { teacherId: teacher.id, date: { gte: addDays(now, -30), lte: now } }, _count: { _all: true } }),
    ctx.db.teacherAttendance.findFirst({ where: { teacherId: teacher.id, date: now }, select: { status: true } }),
    session ? ctx.db.timetableSlot.findMany({ where: { teacherId: teacher.id, academicSessionId: session.id }, select: { sectionId: true, subject: { select: { name: true } } } }) : Promise.resolve([]),
    sectionIds.length ? ctx.db.studentEnrollment.groupBy({ by: ["sectionId"], where: { sectionId: { in: sectionIds }, status: "ACTIVE" }, _count: { _all: true } }) : Promise.resolve([]),
    sessionStart ? academicMonitoring(ctx, { teacherId: teacher.id, from: sessionStart, to: now }).catch(() => null) : Promise.resolve(null),
  ]);

  const counts = Object.fromEntries(marks.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const markedDays = marks.reduce((sum, row) => sum + row._count._all, 0);
  const attended = attendedDays({ PRESENT: counts.PRESENT ?? 0, LATE: counts.LATE ?? 0, HALF_DAY: 0 });
  const periods = new Map<string, number>();
  for (const slot of slots) periods.set(`${slot.sectionId}:${slot.subject.name}`, (periods.get(`${slot.sectionId}:${slot.subject.name}`) ?? 0) + 1);
  const students = new Map(strength.map((row) => [row.sectionId, row._count._all]));
  const configured = monitoring?.rows.filter((row) => row.syllabus.configured && row.syllabus.expected > 0) ?? [];
  const expected = configured.reduce((sum, row) => sum + row.syllabus.expected, 0);
  const covered = configured.reduce((sum, row) => sum + row.syllabus.covered, 0);
  const behind = configured.reduce((sum, row) => sum + row.syllabus.behind, 0);
  const coverage = expected ? Math.round((covered / expected) * 100) : null;
  const classTeacherOf = new Set(teacher.classTeacherOf.map((section) => section.id));
  const classNames = [...new Set(teacher.assignments.map((row) => row.section.class.name))];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Weekly periods" icon={ClockIcon} tone="blue" value={periodsPerWeek} sub={session ? `On the ${session.name} timetable` : "No current session"} href={`/school-admin/timetable?teacher=${teacher.id}`} />
        <MetricTile
          label="Attendance rate"
          icon={FingerprintIcon}
          tone="green"
          value={markedDays ? formatPercent(attended, markedDays) : "—"}
          sub={markedDays ? `Last 30 days · ${pluralize(markedDays, "day")} marked` : "Not marked in 30 days"}
          foot={<TileChip tone={todayMark ? (todayMark.status === "ABSENT" ? "red" : todayMark.status === "ON_LEAVE" ? "amber" : "green") : "neutral"}>{todayMark ? `Today: ${humanize(todayMark.status)}` : "Today: not marked"}</TileChip>}
        />
        <MetricTile label="Assigned scope" icon={UsersIcon} tone="purple" value={pluralize(sectionIds.length, "section")} valueClassName="text-xl" sub={classNames.join(", ") || "Nothing assigned"} href={href("teaching")} />
        <MetricTile
          label="Syllabus track"
          icon={BookOpenCheckIcon}
          tone="cyan"
          value={coverage === null ? "—" : `${coverage}%`}
          sub={coverage === null ? "No syllabus set for their classes" : `${covered} of ${expected} expected topics covered`}
          progress={coverage}
          foot={coverage === null ? null : <TileChip tone={behind ? "amber" : "green"}>{behind ? `${pluralize(behind, "unit")} behind` : "On track"}</TileChip>}
        />
      </div>

      <DocumentShortcuts ctx={ctx} kind="TEACHER" personId={teacher.id} picks={["STAFF_ID_CARD", "EMPLOYMENT_VERIFICATION", "APPOINTMENT_LETTER"]} more={href("documents")} />

      <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Teaching assignments" icon={BriefcaseIcon} description={session ? `Academic session ${session.name}` : undefined} aside={<TileChip>{`${pluralize(teacher.assignments.length, "assignment")}`}</TileChip>}>
          {teacher.assignments.length ? (
            <ul className="flex flex-col gap-2">
              {[...teacher.assignments]
                .sort((a, b) => b.section.class.level - a.section.class.level || a.section.name.localeCompare(b.section.name))
                .map((assignment) => {
                  const perWeek = periods.get(`${assignment.section.id}:${assignment.subject.name}`) ?? 0;
                  return (
                    <SoftRow key={assignment.id}>
                      <span className="text-primary w-14 shrink-0 text-center text-xl font-extrabold">{shortSection(assignment.section.class.name, assignment.section.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/school-admin/academics/sections/${assignment.section.id}`} className="font-semibold hover:underline">
                            {groupLabel(assignment.section, assignment.stream)}
                          </Link>
                          <TileChip tone={classTeacherOf.has(assignment.section.id) ? "purple" : "neutral"}>{classTeacherOf.has(assignment.section.id) ? "Class teacher" : "Subject teacher"}</TileChip>
                        </span>
                        <span className="text-muted-foreground block text-sm">{`${assignment.subject.name}${assignment.subject.code ? ` (${assignment.subject.code})` : ""}`}</span>
                        <span className="text-muted-foreground flex items-center gap-1 text-xs">
                          <UsersIcon className="size-3.5" aria-hidden />
                          {`${students.get(assignment.section.id) ?? 0} students enrolled`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xl font-extrabold tabular-nums">{perWeek}</span>
                        <span className="text-muted-foreground text-xs">per wk</span>
                      </span>
                    </SoftRow>
                  );
                })}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No subjects assigned this session.</p>
          )}
        </Panel>
        <TeacherWeekCard ctx={ctx} teacherId={teacher.id} />
      </div>
    </div>
  );
}

async function TeachingTab({ ctx, profile }: { ctx: TenantContext; profile: Profile }) {
  const { teacher, session } = profile;
  const [subjects, sections, seats] = await Promise.all([
    listSubjects(ctx, { activeOnly: true }),
    session ? classSectionOptions(ctx, session.id) : Promise.resolve([]),
    session ? admissionSeatOptions(ctx, session.id) : Promise.resolve({} as AdmissionSeatOptions),
  ]);
  // The streams each section shares its seats with, for "whole section or one stream".
  const streamsBySection = Object.fromEntries(Object.entries(seats).map(([sectionId, plan]) => [sectionId, plan.streams.map((stream) => ({ value: stream.value, label: stream.name }))]));
  const assignments = [...teacher.assignments].sort((a, b) => a.section.class.level - b.section.class.level || a.subject.name.localeCompare(b.subject.name));

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
      <Panel title={`Subjects taught${session ? ` in ${session.name}` : ""}`} icon={BriefcaseIcon} description="A teacher can mark attendance only for sections listed here or where they are class teacher.">
        <div className="flex flex-col gap-5">
          {assignments.length ? (
            <ul className="flex flex-col gap-2">
              {assignments.map((assignment) => (
                <SoftRow key={assignment.id} className="text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{assignment.subject.name}</span> ·{" "}
                    <Link href={`/school-admin/academics/sections/${assignment.section.id}`} className="hover:underline">
                      {groupLabel(assignment.section, assignment.stream)}
                    </Link>
                  </span>
                  <ActionButton
                    action={unassignSubjectAction}
                    fields={{ assignmentId: assignment.id }}
                    variant="ghost"
                    size="xs"
                    confirm={{ title: "Remove this assignment?", description: "The teacher will lose access to this section unless they are its class teacher.", confirmLabel: "Remove" }}
                  >
                    Remove
                  </ActionButton>
                </SoftRow>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No subjects assigned yet.</p>
          )}
          {teacher.classTeacherOf.length ? (
            <p className="text-sm">
              Class teacher of{" "}
              {teacher.classTeacherOf.map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/school-admin/academics/sections/${s.id}`} className="font-medium hover:underline">
                    {s.class.name} – {s.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          ) : null}
          {session && sections.length ? (
            <AssignSubjectForm teacherId={teacher.id} subjects={subjects.map((s) => ({ value: s.id, label: s.name }))} sections={sections} streamsBySection={streamsBySection} />
          ) : (
            <p className="text-muted-foreground text-sm">Add a class under Academics, or set a current session, to assign subjects.</p>
          )}
        </div>
      </Panel>
      <TeacherWeekCard ctx={ctx} teacherId={teacher.id} />
    </div>
  );
}

async function SalaryTab({ ctx, teacher }: { ctx: TenantContext; teacher: Teacher }) {
  const salary = await getTeacherSalary(ctx, teacher.id);
  return (
    <Panel
      title="Salary"
      icon={WalletIcon}
      tone="orange"
      description={`Only you and ${teacher.firstName} can see this. Never required to add a teacher.`}
      aside={salary.current ? <StatusBadge status="ACTIVE" label="Configured" /> : <StatusBadge status="PENDING" label="Not set" />}
    >
      <div className="flex flex-col gap-5">
        {salary.current ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile label="Salary" icon={WalletIcon} tone="blue" value={rupees(salary.current.amountMinor)} valueClassName="text-xl" sub={humanize(salary.current.salaryType)} />
            <MetricTile label="Net" icon={WalletIcon} tone="green" value={rupees(salary.current.netMinor)} valueClassName="text-xl" />
            <MetricTile label="Allowances" icon={WalletIcon} tone="cyan" value={rupees(salary.current.allowancesMinor)} valueClassName="text-xl" />
            <MetricTile label="Deductions" icon={WalletIcon} tone="amber" value={rupees(salary.current.deductionsMinor)} valueClassName="text-xl" sub={`Effective from ${formatDate(salary.current.effectiveFrom)}`} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No salary recorded. A teacher works without one — this is the school&apos;s employment record, not a requirement for adding them.</p>
        )}
        {salary.history.length > 1 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">History</p>
            <ul className="flex flex-col gap-2">
              {salary.history.map((row) => (
                <SoftRow key={row.id} className="flex-wrap text-sm">
                  <span className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">{formatDate(row.effectiveFrom)}</span>
                  <span className="min-w-0 flex-1 tabular-nums">{rupees(row.amountMinor)}</span>
                  {row.current ? <StatusBadge status="ACTIVE" label="Current" /> : null}
                  {row.effectiveFrom > today() ? <StatusBadge status="PENDING" label="Scheduled" /> : null}
                  <ActionButton
                    action={removeSalaryAction}
                    fields={{ salaryId: row.id }}
                    variant="ghost"
                    size="xs"
                    pendingLabel="Removing…"
                    confirm={{ title: "Remove this salary record?", description: "The figure before it becomes current again. Use this for a row entered by mistake.", confirmLabel: "Remove" }}
                  >
                    Remove
                  </ActionButton>
                </SoftRow>
              ))}
            </ul>
          </div>
        ) : null}
        <SalaryForm
          teacherId={teacher.id}
          today={toDateInput(today())}
          current={
            salary.current
              ? { salaryType: salary.current.salaryType, amountRupees: toRupeeInput(salary.current.amountMinor), allowancesRupees: toRupeeInput(salary.current.allowancesMinor), deductionsRupees: toRupeeInput(salary.current.deductionsMinor) }
              : undefined
          }
        />
      </div>
    </Panel>
  );
}

async function AccountTab({ ctx, teacher, name }: { ctx: TenantContext; teacher: Teacher; name: string }) {
  const invites = await activationEmailStatuses(ctx, [teacher.user.id]);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Panel title="Details" icon={UserRoundIcon} description="Name, contact, designation and joining date.">
        <EditTeacherForm
          teacher={{
            teacherId: teacher.id,
            email: teacher.user.email,
            firstName: teacher.firstName,
            lastName: teacher.lastName,
            gender: teacher.gender,
            employeeId: teacher.employeeId,
            phone: teacher.phone,
            qualification: teacher.qualification,
            joiningDate: teacher.joiningDate ? toDateInput(teacher.joiningDate) : "",
            status: teacher.status,
            designation: teacher.designation,
            dateOfBirth: teacher.dateOfBirth ? toDateInput(teacher.dateOfBirth) : "",
            addressLine: teacher.addressLine,
            city: teacher.city,
            state: teacher.state,
            postalCode: teacher.postalCode,
          }}
        />
      </Panel>
      <div className="flex flex-col gap-5">
        <LifecyclePanel ctx={ctx} person="TEACHER" personId={teacher.id} />
        <Panel title="Sign-in" icon={FingerprintIcon} tone="purple">
          <div className="flex flex-col gap-3 text-sm">
            <LoginStatus user={teacher.user} invite={invites.get(teacher.user.id)} />
            <p className="text-muted-foreground text-xs">Last sign-in {formatDateTime(teacher.user.lastLoginAt)}</p>
            <ResetPortalPasswordForm userId={teacher.user.id} pending={!teacher.user.activatedAt} />
          </div>
        </Panel>
        <Panel title="Added by mistake?" icon={SettingsIcon} tone="red" description="Delete works only before they take a register, teach a period or set homework.">
          {/* Refused by the service once this teacher has any record in the
              school, which is why the dialog says what it will and will not
              do rather than simply asking twice. */}
          <ActionButton
            action={deleteTeacherAction}
            fields={{ teacherId: teacher.id }}
            variant="destructive"
            size="default"
            confirm={{
              title: `Delete ${name}?`,
              description:
                "This erases the staff record and the sign-in together. It only works for someone added by mistake — once they have taken a register, taught a period or set homework, the delete is refused and you should use Change status (for example Resigned) instead.",
              confirmLabel: "Delete",
            }}
          >
            Delete (added by mistake)
          </ActionButton>
        </Panel>
      </div>
    </div>
  );
}
