import type { Metadata, Route } from "next";
import Link from "next/link";
import {
  BookOpenCheckIcon,
  CalendarCheckIcon,
  ClipboardCheckIcon,
  FileSpreadsheetIcon,
  GraduationCapIcon,
  HandHelpingIcon,
  LayoutGridIcon,
  LibraryIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  PrinterIcon,
  SettingsIcon,
  SirenIcon,
  SparklesIcon,
  TrophyIcon,
  UserRoundIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DocumentShortcuts, PersonDocuments } from "@/features/documents/person-documents";
import { StudentAttentionCard } from "@/features/exams/student-attention";
import { rupees } from "@/features/finance/money";
import { LoansList } from "@/features/operations/library-desk";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { Eyebrow, HeroAction, MetricTile, Panel, ProfileHero, ProfileTabs, RowIconLink, SoftRow, TileChip } from "@/features/people/profile-ui";
import { deleteStudentAction, unlinkGuardianAction } from "@/features/school/people-actions";
import { EditParentForm, EnrollmentForm, LinkGuardianForm, LoginStatus, PortalAccessForm, ResetPortalPasswordForm } from "@/features/school/people-forms";
import { attendedDays } from "@/lib/attendance";
import { ForbiddenError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPercent, fullName, humanize, pluralize } from "@/lib/format";
import { OUTCOME_LABEL } from "@/lib/grades";
import { param } from "@/lib/search-params";
import { listAcademicSessions, sectionLabel } from "@/server/academics/structure";
import { groupLabel, seatOptionsFor } from "@/server/academics/streams";
import { activationEmailStatuses } from "@/server/auth/account-links";
import { type TenantContext, requireTenant } from "@/server/auth/current-user";
import { getReportCard, publishedExamsFor } from "@/server/exams/results";
import { getStudentFees } from "@/server/finance/fees";
import { listLoans } from "@/server/operations/library";
import { orNotFound } from "@/server/page-helpers";
import { photoUrlFor } from "@/server/people/photos";
import { getStudentProfile, searchParents } from "@/server/people/students";
import { hasModule } from "@/server/platform/modules";
import { supportForStudent } from "@/server/support/service";

export const metadata: Metadata = { title: "Student" };

const TABS = ["overview", "academics", "attendance", "documents", "family", "fees", "account"] as const;
type Tab = (typeof TABS)[number];
type Profile = Awaited<ReturnType<typeof getStudentProfile>>;

const PRESENCE: Record<string, "positive" | "warning" | "negative" | "neutral"> = { ACTIVE: "positive", INACTIVE: "neutral", SUSPENDED: "negative" };

/**
 * One student, in tabs: Overview (headline figures, latest marks, family),
 * Academics, Attendance, Documents, Family, Fees (School Admin, with the fees
 * module) and Account (placement, login, status, delete). Every figure comes
 * from the school's records; a tile with nothing recorded says so.
 */
export default async function StudentPage(props: PageProps<"/school-admin/students/[studentId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const { studentId } = await props.params;
  const search = await props.searchParams;
  const profile = await orNotFound(getStudentProfile(ctx, studentId));
  const { student } = profile;

  // Fees only for the School Admin, where the plan has fees: the Principal sees no individual fees.
  const feesOn = ctx.user.role === "SCHOOL_ADMIN" && (await hasModule(ctx, "FINANCE"));
  const tabParam = param(search.tab);
  const tab: Tab = TABS.includes(tabParam as Tab) && (tabParam !== "fees" || feesOn) ? (tabParam as Tab) : "overview";
  const href = (next: Tab) => (next === "overview" ? `/school-admin/students/${student.id}` : `/school-admin/students/${student.id}?tab=${next}`);

  const [photoUrl, results] = await Promise.all([photoUrlFor(ctx, { type: "STUDENT", id: student.id }), publishedExamsFor(ctx, student.id)]);
  const current = student.enrollments.find((e) => e.academicSession.isCurrent);
  const name = `${student.firstName} ${student.lastName}`;
  const latest = results.find((exam) => exam.currentSession) ?? null;

  return (
    <>
      <ProfileHero
        back={{ href: "/school-admin/students", label: "Students" }}
        session={current?.academicSession.name}
        name={name}
        photoUrl={photoUrl}
        presence={PRESENCE[student.status] ?? "neutral"}
        badge={<StatusBadge status={student.status} />}
        chips={[
          { label: `Adm No: ${student.admissionNumber}`, tone: "neutral" },
          current ? { label: groupLabel(current.section, current.stream), tone: "blue" } : { label: "Not placed this session", tone: "amber" },
          current?.rollNumber ? { label: `Roll: ${current.rollNumber}`, tone: "purple" } : null,
        ]}
        actions={
          <>
            <HeroAction href={`/school-admin/students/${student.id}/edit`} icon={PencilIcon} label="Edit" />
            <HeroAction href={href("documents")} icon={SparklesIcon} label="Generate" primary />
            {latest ? <HeroAction href={`/report-cards/${latest.id}/${student.id}`} icon={PrinterIcon} label="Report card" external /> : null}
            <HeroAction href={href("account")} icon={SettingsIcon} label="Account" />
          </>
        }
      />

      <ProfileTabs
        label="Student"
        tabs={[
          { href: href("overview"), label: "Overview", active: tab === "overview" },
          { href: href("academics"), label: "Academic report", count: results.length || undefined, active: tab === "academics" },
          { href: href("attendance"), label: "Attendance", active: tab === "attendance" },
          { href: href("documents"), label: "Documents", active: tab === "documents" },
          { href: href("family"), label: "Family", count: student.parents.length, active: tab === "family" },
          ...(feesOn ? [{ href: href("fees"), label: "Fees", active: tab === "fees" }] : []),
          { href: href("account"), label: "Account", active: tab === "account" },
        ]}
      />

      {tab === "overview" ? <OverviewTab ctx={ctx} profile={profile} feesOn={feesOn} latest={latest} href={href} /> : null}
      {tab === "academics" ? <AcademicsTab ctx={ctx} student={student} results={results} /> : null}
      {tab === "attendance" ? <AttendanceTab profile={profile} /> : null}
      {tab === "documents" ? <PersonDocuments ctx={ctx} kind="STUDENT" personId={student.id} /> : null}
      {tab === "family" ? <FamilyTab ctx={ctx} student={student} /> : null}
      {tab === "fees" && feesOn ? <FeesTab ctx={ctx} studentId={student.id} /> : null}
      {tab === "account" ? <AccountTab ctx={ctx} student={student} name={name} /> : null}
    </>
  );
}

type Student = Profile["student"];
type Exam = Awaited<ReturnType<typeof publishedExamsFor>>[number];

function attendanceOf(profile: Profile) {
  const counts = Object.fromEntries(profile.attendance.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const marked = profile.attendance.reduce((sum, row) => sum + row._count._all, 0);
  const attended = attendedDays({ PRESENT: counts.PRESENT ?? 0, LATE: counts.LATE ?? 0, HALF_DAY: counts.HALF_DAY ?? 0 });
  return { counts, marked, attended };
}

async function OverviewTab({ ctx, profile, feesOn, latest, href }: { ctx: TenantContext; profile: Profile; feesOn: boolean; latest: Exam | null; href: (tab: Tab) => string }) {
  const { student } = profile;
  const current = student.enrollments.find((e) => e.academicSession.isCurrent);
  const { counts, marked, attended } = attendanceOf(profile);

  const [section, homework, fees, support, card] = await Promise.all([
    current
      ? ctx.db.section.findFirst({ where: { id: current.section.id }, select: { classTeacher: { select: { firstName: true, lastName: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } } })
      : Promise.resolve(null),
    current ? ctx.db.homeworkSubmission.groupBy({ by: ["status"], where: { studentId: student.id, homework: { academicSessionId: current.academicSession.id } }, _count: { _all: true } }) : Promise.resolve([]),
    feesOn ? getStudentFees(ctx, student.id) : Promise.resolve(null),
    feesOn ? Promise.resolve(null) : supportForStudent(ctx, student.id),
    latest ? getReportCard(ctx, latest.id, student.id).catch(() => null) : Promise.resolve(null),
  ]);
  const hw = Object.fromEntries(homework.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const hwRecorded = (hw.SUBMITTED ?? 0) + (hw.LATE ?? 0) + (hw.MISSING ?? 0);
  const hwIn = (hw.SUBMITTED ?? 0) + (hw.LATE ?? 0);

  // The class's average on each paper, from the marks given (absent and exempt left out).
  const paperIds = card?.subjects.map((row) => row.assessmentId) ?? [];
  const averages = paperIds.length
    ? new Map(
        (await ctx.db.assessmentResult.groupBy({ by: ["assessmentId"], where: { assessmentId: { in: paperIds }, absent: false, exempt: false, marksObtained: { not: null } }, _avg: { marksObtained: true } })).map((row) => [row.assessmentId, row._avg.marksObtained]),
      )
    : new Map<string, number | null>();
  const openSupport = support?.filter((row) => !["RESOLVED", "CLOSED"].includes(row.status)).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <StudentAttentionCard ctx={ctx} studentId={student.id} supportBase="/school-admin/support" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricTile
          label="Attendance"
          icon={CalendarCheckIcon}
          tone="green"
          value={marked ? formatPercent(attended, marked) : "—"}
          sub={marked ? `${attended} of ${pluralize(marked, "day")}` : "No register marked yet"}
          foot={marked ? <TileChip tone={counts.ABSENT ? "amber" : "green"}>{counts.ABSENT ? `${counts.ABSENT} absent` : "No absences"}</TileChip> : null}
          href={href("attendance")}
        />
        <MetricTile
          label="Performance"
          icon={TrophyIcon}
          tone="purple"
          value={latest?.percent !== null && latest?.percent !== undefined ? `${latest.percent}%` : "—"}
          sub={latest ? [latest.grade ? `Grade ${latest.grade}` : null, latest.name].filter(Boolean).join(" · ") : "No published result this session"}
          foot={latest ? <TileChip tone={latest.outcome === "PASS" ? "green" : latest.outcome === "FAIL" ? "red" : "neutral"}>{OUTCOME_LABEL[latest.outcome]}</TileChip> : null}
          href={href("academics")}
        />
        <MetricTile
          label="Class section"
          icon={LayoutGridIcon}
          tone="blue"
          value={current ? sectionLabel(current.section) : "—"}
          valueClassName="text-xl"
          sub={current ? (section?.classTeacher ? `Class teacher: ${fullName(section.classTeacher)}` : "No class teacher set") : "Not placed this session"}
          foot={section ? <TileChip tone="neutral">{`${section._count.enrollments} students`}</TileChip> : null}
        />
        {fees ? (
          <MetricTile
            label="Fee dues"
            icon={WalletIcon}
            tone="orange"
            value={rupees(fees.summary.pendingMinor)}
            valueClassName={fees.summary.overdue ? "text-danger-strong" : undefined}
            sub={`${rupees(fees.summary.paidMinor)} paid of ${rupees(fees.summary.chargedMinor)}`}
            foot={<TileChip tone={fees.summary.overdue ? "red" : fees.summary.pendingMinor > 0 ? "amber" : "green"}>{fees.summary.overdue ? "Overdue" : fees.summary.pendingMinor > 0 ? "Due" : "All paid"}</TileChip>}
            href={href("fees")}
          />
        ) : (
          <MetricTile label="Academic support" icon={HandHelpingIcon} tone="orange" value={openSupport} sub={openSupport ? "Open support records" : "Nothing open"} href={href("academics")} />
        )}
        <MetricTile
          label="Homework"
          icon={ClipboardCheckIcon}
          tone="cyan"
          value={hwRecorded ? formatPercent(hwIn, hwRecorded) : "—"}
          sub={hwRecorded ? `${hwIn} of ${hwRecorded} handed in` : "Nothing marked yet"}
          foot={hwRecorded ? <TileChip tone={hw.MISSING ? "red" : "green"}>{hw.MISSING ? `${hw.MISSING} missing` : hw.LATE ? `${hw.LATE} late` : "All on time"}</TileChip> : null}
        />
        <MetricTile
          label={latest ? latest.name : "Latest exam"}
          icon={GraduationCapIcon}
          tone="blue"
          value={latest ? latest.total : "—"}
          unit={latest ? `/${latest.maxTotal}` : undefined}
          sub={latest ? `${formatDate(latest.startDate)}` : "No published exam this session"}
          foot={
            latest ? (
              <Link href={`/report-cards/${latest.id}/${student.id}` as Route} target="_blank" className="text-primary font-semibold hover:underline">
                Open report card
              </Link>
            ) : null
          }
        />
      </div>

      <DocumentShortcuts ctx={ctx} kind="STUDENT" personId={student.id} picks={["STUDENT_ID_CARD", "TRANSFER_CERTIFICATE", "MARKSHEET", "BONAFIDE_CERTIFICATE", "CHARACTER_CERTIFICATE", "ATTENDANCE_CERTIFICATE"]} more={href("documents")} />

      <div className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Subject scores" icon={FileSpreadsheetIcon} aside={card ? <TileChip tone="neutral">{card.exam.name}</TileChip> : null}>
          {card ? (
            <>
              <ul className="flex flex-col gap-2">
                {card.subjects.map((row) => {
                  const average = averages.get(row.assessmentId);
                  return (
                    <SoftRow key={row.assessmentId}>
                      <span className="bg-card text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold uppercase">{row.subject.slice(0, 2)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{row.subject}</span>
                        <span className="text-muted-foreground block text-xs">{average !== null && average !== undefined ? `Class average: ${Math.round((average / row.maxMarks) * 100)}%` : "Class average: —"}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-lg font-bold tabular-nums">
                          {row.exempt ? "Exempt" : row.absent ? "Absent" : (row.marksObtained ?? "—")}
                          {!row.exempt && !row.absent ? <span className="text-muted-foreground text-xs font-medium">{`/${row.maxMarks}`}</span> : null}
                        </span>
                        {row.grade ? <TileChip tone={row.outcome === "FAIL" ? "red" : "green"}>{`Grade ${row.grade}`}</TileChip> : null}
                      </span>
                    </SoftRow>
                  );
                })}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild variant="outline" className="flex-1">
                  <Link href={href("academics") as Route}>All results</Link>
                </Button>
                <Button asChild className="flex-1">
                  <Link href={`/report-cards/${card.exam.id}/${student.id}` as Route} target="_blank">
                    <PrinterIcon aria-hidden />
                    Report card / PDF
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">No published examination this session. Marks appear here once results are published.</p>
          )}
        </Panel>
        <GuardiansPanel student={student} manageHref={href("family")} />
      </div>
    </div>
  );
}

/** Guardians, the emergency contact and the address — read only; changed under Family. */
function GuardiansPanel({ student, manageHref }: { student: Student; manageHref: string }) {
  const address = [student.addressLine, student.city, student.state, student.postalCode].filter(Boolean).join(", ");
  return (
    <Panel
      title="Guardian & emergency"
      icon={UsersIcon}
      aside={
        <Link href={manageHref as Route} className="text-primary text-sm font-semibold hover:underline">
          Manage
        </Link>
      }
    >
      <div className="flex flex-col gap-2">
        {student.parents.map((link) => (
          <SoftRow key={link.id}>
            <span className="bg-primary-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
              <UserRoundIcon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <Eyebrow>{`${humanize(link.relationship)}${link.isPrimary ? " · Primary" : ""}`}</Eyebrow>
              <span className="block truncate font-semibold">{fullName(link.parent)}</span>
              <span className="text-muted-foreground block truncate text-xs">{link.parent.phone}</span>
            </span>
            {link.parent.phone ? <RowIconLink href={`tel:${link.parent.phone.replace(/\s/g, "")}`} icon={PhoneIcon} label={`Call ${fullName(link.parent)}`} /> : null}
            {link.parent.email ? <RowIconLink href={`mailto:${link.parent.email}`} icon={MailIcon} label={`Email ${fullName(link.parent)}`} /> : null}
          </SoftRow>
        ))}
        {!student.parents.length ? <p className="text-muted-foreground text-sm">No guardian linked yet.</p> : null}
        {student.emergencyContactName || student.emergencyContactPhone ? (
          <SoftRow tone="danger">
            <span className="bg-card text-danger-strong flex size-10 shrink-0 items-center justify-center rounded-full">
              <SirenIcon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <Eyebrow className="text-danger-strong">Emergency contact</Eyebrow>
              <span className="block truncate font-semibold">{student.emergencyContactName ?? "—"}</span>
              <span className="text-muted-foreground block text-xs">{student.emergencyContactPhone ?? ""}</span>
            </span>
            {student.emergencyContactPhone ? <RowIconLink href={`tel:${student.emergencyContactPhone.replace(/\s/g, "")}`} icon={PhoneIcon} label="Call emergency contact" tone="danger" /> : null}
          </SoftRow>
        ) : null}
        <SoftRow className="items-start">
          <MapPinIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <Eyebrow>Residential address</Eyebrow>
            <span className="block text-sm">{address || "Not recorded"}</span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              {student.gender ? <TileChip tone="neutral">{humanize(student.gender)}</TileChip> : null}
              {student.dateOfBirth ? <TileChip tone="neutral">{`Born ${formatDate(student.dateOfBirth)}`}</TileChip> : null}
              {student.bloodGroup ? <TileChip tone="red">{`Blood ${student.bloodGroup}`}</TileChip> : null}
              {student.admissionDate ? <TileChip tone="neutral">{`Admitted ${formatDate(student.admissionDate)}`}</TileChip> : null}
            </span>
          </span>
        </SoftRow>
      </div>
    </Panel>
  );
}

async function AcademicsTab({ ctx, student, results }: { ctx: TenantContext; student: Student; results: Exam[] }) {
  const libraryOn = await hasModule(ctx, "LIBRARY");
  // Loans only for someone the library is open to — the School Admin, not the Principal; anyone else simply gets no Library panel.
  const [support, loans] = await Promise.all([
    supportForStudent(ctx, student.id),
    libraryOn ? listLoans(ctx, { studentId: student.id, view: "all" }).catch((error: unknown) => (error instanceof ForbiddenError ? null : Promise.reject(error))) : Promise.resolve(null),
  ]);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Panel id="results" title="Results" icon={TrophyIcon} tone="purple" description="Published exams, every session.">
        {results.length ? (
          <ul className="flex flex-col gap-2">
            {results.map((exam) => (
              <SoftRow key={exam.id}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{exam.name}</span>
                  <span className="text-muted-foreground block text-xs">{`${exam.session} · ${formatDate(exam.startDate)}`}</span>
                </span>
                <span className="text-right">
                  <span className="block font-bold tabular-nums">{`${exam.total}/${exam.maxTotal}`}</span>
                  <span className="text-muted-foreground block text-xs tabular-nums">{[exam.percent === null ? null : `${exam.percent}%`, exam.grade ? `Grade ${exam.grade}` : null].filter(Boolean).join(" · ") || OUTCOME_LABEL[exam.outcome]}</span>
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/report-cards/${exam.id}/${student.id}` as Route} target="_blank">
                    Report card
                  </Link>
                </Button>
              </SoftRow>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No published results yet.</p>
        )}
      </Panel>
      <div className="flex flex-col gap-5">
        <Panel
          title="Academic support"
          icon={HandHelpingIcon}
          tone="orange"
          aside={
            <Button asChild size="sm" variant="outline">
              <Link href={`/school-admin/support/new?student=${student.id}` as Route}>+ Add support</Link>
            </Button>
          }
        >
          {support.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {support.map((row) => (
                <SoftRow key={row.id} className="flex-wrap">
                  <span className="min-w-0 flex-1">
                    <Link href={`/school-admin/support/${row.id}` as Route} className="font-semibold hover:underline">
                      {row.subject ?? "General"}
                      {row.topic ? ` — ${row.topic}` : ""}
                    </Link>
                    <span className="text-muted-foreground block text-xs">
                      {humanize(row.reason)} → {humanize(row.action)}
                      {row.teacher ? ` · ${row.teacher}` : ""}
                      {row.fromConcern ? " · from a parent's concern" : ""}
                      {row.followUps ? ` · ${row.followUps} follow-ups` : ""}
                    </span>
                  </span>
                  <StatusBadge status={row.priority} />
                  <StatusBadge status={row.status} />
                </SoftRow>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No academic support recorded. Teachers add it when a student needs extra help.</p>
          )}
        </Panel>
        {loans ? (
          <Panel title="Library" icon={LibraryIcon} tone="cyan" aside={<TileChip tone="neutral">{`${loans.filter((loan) => !loan.returnedOn).length} out now · ${loans.length} issued in all`}</TileChip>}>
            {loans.length ? <LoansList loans={loans} canManage={false} /> : <p className="text-muted-foreground text-sm">No books issued yet.</p>}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function AttendanceTab({ profile }: { profile: Profile }) {
  const { counts, marked, attended } = attendanceOf(profile);
  const STATUSES = [
    { key: "PRESENT", tone: "green" },
    { key: "LATE", tone: "amber" },
    { key: "HALF_DAY", tone: "cyan" },
    { key: "ABSENT", tone: "red" },
    { key: "EXCUSED", tone: "purple" },
  ] as const;
  return (
    <Panel title="Attendance this session" icon={BookOpenCheckIcon} tone="green" description={marked ? `${formatPercent(attended, marked)} attended across ${marked} marked days.` : "No attendance marked yet."}>
      {marked ? (
        <div className="bg-muted mb-4 flex h-3 overflow-hidden rounded-full" role="presentation">
          {STATUSES.map((status) => (counts[status.key] ? <div key={status.key} className={status.tone === "green" ? "bg-success" : status.tone === "amber" ? "bg-warning" : status.tone === "cyan" ? "bg-info" : status.tone === "red" ? "bg-danger" : "bg-purple"} style={{ width: `${((counts[status.key] ?? 0) / marked) * 100}%` }} /> : null))}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {STATUSES.map((status) => (
          <div key={status.key} className="bg-muted/60 rounded-2xl p-3">
            <dt className="text-muted-foreground text-xs">{humanize(status.key)}</dt>
            <dd className="text-2xl font-extrabold tabular-nums">{counts[status.key] ?? 0}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

async function FamilyTab({ ctx, student }: { ctx: TenantContext; student: Student }) {
  const [parents, invites] = await Promise.all([searchParents(ctx), activationEmailStatuses(ctx, student.parents.map((link) => link.parent.user?.id))]);
  const linkedParentIds = new Set(student.parents.map((link) => link.parent.id));
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Panel title="Parents & guardians" icon={UsersIcon} description="A guardian with a login sees all of their linked children.">
        <div className="flex flex-col gap-3">
          {student.parents.map((link) => (
            <div key={link.id} className="bg-muted/40 flex flex-col gap-3 rounded-2xl border border-border/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    {link.parent.firstName} {link.parent.lastName}
                    {link.isPrimary ? <StatusBadge status="ACTIVE" label="Primary" tone="info" /> : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {humanize(link.relationship)} · {link.parent.phone}
                    {link.parent.email ? ` · ${link.parent.email}` : ""}
                  </p>
                </div>
                <ActionButton
                  action={unlinkGuardianAction}
                  fields={{ linkId: link.id }}
                  variant="ghost"
                  size="xs"
                  confirm={{ title: "Unlink this guardian?", description: "Their record is kept, but they will no longer see this child.", confirmLabel: "Unlink" }}
                >
                  Unlink
                </ActionButton>
              </div>
              {link.parent.user ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <LoginStatus user={link.parent.user} invite={invites.get(link.parent.user.id)} />
                    <p className="text-muted-foreground text-xs">Last sign-in {formatDateTime(link.parent.user.lastLoginAt)}</p>
                  </div>
                  <ResetPortalPasswordForm userId={link.parent.user.id} pending={!link.parent.user.activatedAt} />
                </div>
              ) : (
                <PortalAccessForm kind="parent" personId={link.parent.id} defaultEmail={link.parent.email} />
              )}
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer">Edit guardian details</summary>
                <div className="mt-3">
                  <EditParentForm
                    parent={{
                      id: link.parent.id,
                      firstName: link.parent.firstName,
                      lastName: link.parent.lastName,
                      phone: link.parent.phone,
                      email: link.parent.email,
                      occupation: link.parent.occupation,
                      addressLine: link.parent.addressLine,
                      contact: { alternatePhone: link.parent.alternatePhone, city: link.parent.city, state: link.parent.state, postalCode: link.parent.postalCode },
                      idProof: { type: link.parent.idProofType, number: link.parent.idProofNumber },
                    }}
                  />
                </div>
              </details>
            </div>
          ))}
          <details className="rounded-2xl border border-dashed p-4" open={student.parents.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">Link a guardian</summary>
            <div className="mt-4">
              <LinkGuardianForm studentId={student.id} parents={parents.filter((p) => !linkedParentIds.has(p.id)).map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName} · ${p.phone}` }))} />
            </div>
          </details>
        </div>
      </Panel>
      <GuardiansPanel student={student} manageHref={`/school-admin/students/${student.id}/edit`} />
    </div>
  );
}

async function FeesTab({ ctx, studentId }: { ctx: TenantContext; studentId: string }) {
  const fees = await getStudentFees(ctx, studentId);
  return (
    <Panel
      title={`Fees${fees.session ? ` · ${fees.session.name}` : ""}`}
      icon={WalletIcon}
      tone="orange"
      aside={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={`/school-admin/finance/ledger/${studentId}` as Route}>Ledger</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/school-admin/finance/payments?student=${studentId}` as Route}>Collect / charges</Link>
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTile label="Net fees" icon={WalletIcon} tone="blue" value={rupees(fees.summary.chargedMinor)} />
        <MetricTile label="Paid" icon={WalletIcon} tone="green" value={rupees(fees.summary.paidMinor)} />
        <MetricTile label="Pending" icon={WalletIcon} tone={fees.summary.overdue ? "red" : "amber"} value={rupees(fees.summary.pendingMinor)} valueClassName={fees.summary.overdue ? "text-danger-strong" : undefined} foot={fees.summary.overdue ? <TileChip tone="red">Overdue</TileChip> : null} />
      </div>
    </Panel>
  );
}

async function AccountTab({ ctx, student, name }: { ctx: TenantContext; student: Student; name: string }) {
  const sessions = await listAcademicSessions(ctx);
  const [sectionsBySession, invites] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId: { in: sessions.map((s) => s.id) } },
      select: { id: true, name: true, academicSessionId: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } },
    }),
    activationEmailStatuses(ctx, [student.user?.id]),
  ]);
  const sectionOptions = sectionsBySession
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => ({ value: section.id, label: sectionLabel(section), sessionId: section.academicSessionId }));
  const seats = await seatOptionsFor(ctx.db, sectionsBySession.map((section) => section.id));
  const current = student.enrollments.find((e) => e.academicSession.isCurrent);

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-5">
        <Panel title="Placement" icon={LayoutGridIcon} description="One placement per session; earlier years are kept.">
          <div className="flex flex-col gap-5">
            {student.enrollments.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {student.enrollments.map((enrollment) => (
                  <SoftRow key={enrollment.id}>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{enrollment.academicSession.name}</span> · {groupLabel(enrollment.section, enrollment.stream)}
                      {enrollment.rollNumber ? `, roll ${enrollment.rollNumber}` : ""}
                    </span>
                    <StatusBadge status={enrollment.status} />
                  </SoftRow>
                ))}
              </ul>
            ) : null}
            <EnrollmentForm
              studentId={student.id}
              sessions={sessions.map((s) => ({ value: s.id, label: s.isCurrent ? `${s.name} (current)` : s.name }))}
              sections={sectionOptions}
              defaults={{ sessionId: current?.academicSession.id ?? sessions.find((s) => s.isCurrent)?.id, sectionId: current?.section.id, streamId: current?.streamId, rollNumber: current?.rollNumber }}
              seats={seats}
            />
          </div>
        </Panel>
        <Panel title="Student login" icon={UserRoundIcon} tone="purple" description="Lets the student see their timetable, attendance and notices.">
          {student.user ? (
            <div className="flex flex-col gap-3 text-sm">
              <LoginStatus user={student.user} invite={invites.get(student.user.id)} />
              <p className="text-muted-foreground text-xs">Last sign-in {formatDateTime(student.user.lastLoginAt)}</p>
              <ResetPortalPasswordForm userId={student.user.id} pending={!student.user.activatedAt} />
            </div>
          ) : current && current.section.class.level < 6 ? (
            // Nursery to Class 5: no student account; the parent's login covers them.
            <p className="text-muted-foreground text-sm">{current.section.class.name} students do not have their own login. Their parent&apos;s login shows everything.</p>
          ) : student.status === "ACTIVE" ? (
            <PortalAccessForm kind="student" personId={student.id} />
          ) : (
            <p className="text-muted-foreground text-sm">Only active students can be given a login.</p>
          )}
        </Panel>
      </div>
      <div className="flex flex-col gap-5">
        <LifecyclePanel ctx={ctx} person="STUDENT" personId={student.id} />
        <Panel title="Added by mistake?" icon={SettingsIcon} tone="red" description="Delete works only before the child appears in a register, or has a remark or a result.">
          {/* Refused by the service once this child has a register, a remark
              or a result behind them, which is why the dialog says what it
              will and will not do rather than simply asking twice. */}
          <ActionButton
            action={deleteStudentAction}
            fields={{ studentId: student.id }}
            variant="destructive"
            size="default"
            confirm={{
              title: `Delete ${name}?`,
              description:
                "This erases the student record, their placement, their parent links and any sign-in. It only works for a child admitted by mistake — once they appear in a register, or have a remark or a result, the delete is refused and you should set their status to Transferred or Graduated instead.",
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
