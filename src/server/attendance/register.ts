import "server-only";

import { approvedLeaveOn } from "@/server/attendance/student-leave";

import { Prisma } from "@/generated/prisma/client";
import type { AttendanceStatus, RegisterTiming } from "@/generated/prisma/enums";
import { addDays, dayOfWeek, endOfSchoolDay, formatDate, formatSchoolTime, schoolInstant, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireAttendanceAccess } from "@/server/auth/teacher-access";
import { describeClosure, schoolClosureOn } from "@/server/calendar/holidays";
import type { TenantDb } from "@/server/tenancy/scope";
import { isSchoolLeader } from "@/lib/permissions";

/**
 * The daily student register: draft → submitted → (teacher) locked.
 *
 *   * Who: `requireAttendanceAccess` — the section's class teacher, a teacher
 *     the office assigned for that day (`RegisterCover`), or the School Admin.
 *   * Draft: marks are saved as the teacher taps (auto-save) or presses Save
 *     draft. A draft is not the record: nothing reaches `StudentAttendance`,
 *     parents, students, dashboards or reports.
 *   * Submit: only the teacher's (or School Admin's) explicit Submit
 *     Attendance makes it final — `markAttendance`. Nothing submits a draft by
 *     itself: no timer, no page load, no background job (6 Oct 2026: the
 *     automatic end-of-period submission was removed).
 *   * Correct: after submitting, the teacher may correct until
 *     `correctionDeadline = min(submittedAt + 2 h, 23:59:59 of that date)`,
 *     fixed at submission. After it, only the School Admin can correct —
 *     checked on every save by `teacherMayCorrect`, whatever the row says.
 *
 * Dates follow the rules of a historical record: today and earlier, never a
 * future date, never a declared holiday. A weekly off is allowed but not
 * expected (a special working Saturday).
 */

export const TEACHER_EDIT_WINDOW_DAYS = 7;

/** How a mark reads on the audit log. */
const STATUS_WORD: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", LATE: "Late", EXCUSED: "Leave", HALF_DAY: "Half day" };
export const CORRECTION_WINDOW_MS = 2 * 60 * 60 * 1000;

/** EXCUSED is shown as "Leave"; HALF_DAY only while the school allows it (Settings → Attendance). */
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "HALF_DAY"];

export type AttendanceEntry = { studentId: string; status: AttendanceStatus; remarks: string | null };

type DraftMarks = { marks: Record<string, { status: AttendanceStatus; remarks: string | null }>; savedById: string | null };

// -----------------------------------------------------------------------------
// The rules
// -----------------------------------------------------------------------------

/** min(submittedAt + 2 hours, the last second of the attendance date). */
export function correctionDeadlineFor(submittedAt: Date, date: Date): Date {
  const window = new Date(submittedAt.getTime() + CORRECTION_WINDOW_MS);
  const endOfDay = endOfSchoolDay(date);
  return window < endOfDay ? window : endOfDay;
}

export type RegisterPhase = "NOT_TAKEN" | "DRAFT" | "CORRECTABLE" | "LOCKED";

type RegisterRecord = {
  status: "DRAFT" | "SUBMITTED";
  submittedAt: Date | null;
  correctionDeadline: Date | null;
};

/**
 * Where a register stands, for a teacher, right now — the one place this is
 * decided. `legacyMarkedAt` is for registers taken before registers were
 * tracked: their latest mark stands in for the submission time.
 */
export function registerPhase(register: RegisterRecord | null, legacyMarkedAt: Date | null, date: Date, now: Date = new Date()): {
  phase: RegisterPhase;
  deadline: Date | null;
} {
  if (!register) {
    if (!legacyMarkedAt) return { phase: "NOT_TAKEN", deadline: null };
    const deadline = correctionDeadlineFor(legacyMarkedAt, date);
    return { phase: now < deadline ? "CORRECTABLE" : "LOCKED", deadline };
  }
  if (register.status === "DRAFT") return { phase: "DRAFT", deadline: null };
  const deadline = register.correctionDeadline ?? (register.submittedAt ? correctionDeadlineFor(register.submittedAt, date) : null);
  return { phase: deadline && now < deadline ? "CORRECTABLE" : "LOCKED", deadline };
}

/** May a teacher still correct this submitted register? Admins always may; this is the teachers' rule. */
export function teacherMayCorrect(register: RegisterRecord | null, legacyMarkedAt: Date | null, date: Date, now: Date = new Date()): boolean {
  return registerPhase(register, legacyMarkedAt, date, now).phase === "CORRECTABLE";
}

export async function assertNotHoliday(ctx: TenantContext, date: Date): Promise<void> {
  const closure = await schoolClosureOn(ctx, date);
  if (closure?.kind === "HOLIDAY") {
    throw new AppError("VALIDATION", `${describeClosure(closure, date)} No attendance is needed.`);
  }
}

/** Throws unless `date` is a day this user may take this section's register at all. */
function assertMarkableDate(ctx: TenantContext, date: Date, session: { name: string; startDate: Date; endDate: Date }): void {
  const now = today();
  if (date > now) throw new AppError("VALIDATION", "Attendance cannot be marked for a future date.");
  if (date < session.startDate || date > session.endDate) {
    throw new AppError("VALIDATION", `${formatDate(date)} is outside the ${session.name} session.`);
  }
  if (ctx.user.role === "TEACHER" && date < addDays(now, -TEACHER_EDIT_WINDOW_DAYS)) {
    throw new ForbiddenError(
      `Teachers can take attendance for the last ${TEACHER_EDIT_WINDOW_DAYS} days only. Ask the school office to correct older registers.`,
    );
  }
}

/**
 * When a draft taken today submits itself: the end of the section's first
 * (or last) period that weekday, from the timetable. With no timetable for
 * that day, the end of the day — never a guessed clock time.
 */
export async function attendanceWindow(
  db: TenantDb,
  input: { sectionId: string; academicSessionId: string; date: Date; timing: RegisterTiming },
): Promise<{ opensAt: Date | null; finalizeAt: Date; fromTimetable: boolean }> {
  const slots = await db.timetableSlot.findMany({
    where: { sectionId: input.sectionId, academicSessionId: input.academicSessionId, dayOfWeek: dayOfWeek(input.date) },
    select: { startMinute: true, endMinute: true },
  });
  if (!slots.length) return { opensAt: null, finalizeAt: endOfSchoolDay(input.date), fromTimetable: false };
  const period =
    input.timing === "FIRST_PERIOD"
      ? slots.reduce((a, b) => (b.startMinute < a.startMinute ? b : a))
      : slots.reduce((a, b) => (b.endMinute > a.endMinute ? b : a));
  return { opensAt: schoolInstant(input.date, period.startMinute), finalizeAt: schoolInstant(input.date, period.endMinute), fromTimetable: true };
}

async function schoolSettings(ctx: TenantContext): Promise<{ timing: RegisterTiming; halfDay: boolean }> {
  const school = await ctx.db.school.findFirst({ select: { attendanceTiming: true, attendanceHalfDay: true } });
  return { timing: school?.attendanceTiming ?? "FIRST_PERIOD", halfDay: school?.attendanceHalfDay ?? true };
}

// -----------------------------------------------------------------------------
// Reading a register
// -----------------------------------------------------------------------------

async function loadSection(ctx: TenantContext, sectionId: string) {
  const section = await ctx.db.section.findFirst({
    where: { id: sectionId },
    select: {
      id: true,
      name: true,
      class: { select: { name: true } },
      stream: { select: { name: true } },
      classTeacher: { select: { firstName: true, lastName: true } },
      academicSession: { select: { id: true, name: true, startDate: true, endDate: true } },
    },
  });
  if (!section) throw new NotFoundError();
  return section;
}

async function registerState(ctx: TenantContext, sectionId: string, date: Date) {
  const [register, latest] = await Promise.all([
    ctx.db.attendanceRegister.findFirst({
      where: { sectionId, date },
      select: {
        id: true,
        status: true,
        draft: true,
        draftSavedAt: true,
        finalizeAt: true,
        submittedAt: true,
        autoSubmitted: true,
        correctionDeadline: true,
        submittedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    ctx.db.studentAttendance.findFirst({ where: { sectionId, date }, orderBy: { markedAt: "desc" }, select: { markedAt: true } }),
  ]);
  // Marks with no register row were taken before registers were tracked.
  const legacyMarkedAt = !register && latest ? latest.markedAt : null;
  return { register, legacyMarkedAt };
}

/** The register for one section on one day, with where it stands for the person asking. */
export async function getRegister(ctx: TenantContext, sectionId: string, date: Date) {
  await requireAttendanceAccess(ctx, sectionId, date);
  const section = await loadSection(ctx, sectionId);

  const [enrollments, marks, closure, state, settings] = await Promise.all([
    ctx.db.studentEnrollment.findMany({
      where: { sectionId: section.id, status: "ACTIVE", student: { status: "ACTIVE" } },
      select: { rollNumber: true, student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
    }),
    ctx.db.studentAttendance.findMany({
      where: { sectionId: section.id, date },
      select: { studentId: true, status: true, remarks: true, markedAt: true, markedBy: { select: { firstName: true, lastName: true } } },
    }),
    schoolClosureOn(ctx, date),
    registerState(ctx, section.id, date),
    schoolSettings(ctx),
  ]);

  // Approved student leave for the day — shown, never written into the register by itself.
  const onLeave = await approvedLeaveOn(ctx, enrollments.map((enrollment) => enrollment.student.id), date);
  const draft = state.register?.status === "DRAFT" ? ((state.register.draft ?? { marks: {} }) as DraftMarks).marks : null;
  const byStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
  const rollOrder = (roll: string | null) => (roll && /^\d+$/.test(roll) ? Number(roll) : Number.MAX_SAFE_INTEGER);
  const rows = enrollments
    .sort((a, b) => rollOrder(a.rollNumber) - rollOrder(b.rollNumber) || a.student.firstName.localeCompare(b.student.firstName))
    .map((enrollment) => {
      const mark = draft ? draft[enrollment.student.id] : byStudent.get(enrollment.student.id);
      return {
        studentId: enrollment.student.id,
        name: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
        admissionNumber: enrollment.student.admissionNumber,
        rollNumber: enrollment.rollNumber,
        status: mark?.status ?? null,
        remarks: mark?.remarks ?? null,
        /** The reason, when the student is on approved leave today. */
        leave: onLeave.get(enrollment.student.id) ?? null,
      };
    });

  const latest = marks.reduce<(typeof marks)[number] | null>((acc, mark) => (!acc || mark.markedAt > acc.markedAt ? mark : acc), null);
  const { phase, deadline } = registerPhase(state.register, state.legacyMarkedAt, date);

  // What this person may do with it now, and if nothing, why not.
  let editable = true;
  let lockedReason: string | null = null;
  try {
    assertMarkableDate(ctx, date, section.academicSession);
    if (closure?.kind === "HOLIDAY") throw new AppError("VALIDATION", `${describeClosure(closure, date)} No attendance is needed.`);
    if (ctx.user.role === "TEACHER" && phase === "LOCKED") {
      throw new AppError("VALIDATION", "The attendance correction window has ended. Please contact your School Admin if a correction is needed.");
    }
  } catch (error) {
    editable = false;
    lockedReason = error instanceof AppError ? error.message : null;
  }

  return {
    section: { id: section.id, label: sectionLabel(section), session: section.academicSession, classTeacher: section.classTeacher ? fullName(section.classTeacher) : null },
    date,
    rows,
    marked: marks.length,
    lastMarked: latest ? { at: latest.markedAt, by: latest.markedBy ? `${latest.markedBy.firstName} ${latest.markedBy.lastName}` : null } : null,
    phase,
    deadline,
    draftSavedAt: state.register?.status === "DRAFT" ? state.register.draftSavedAt : null,
    submittedAt: state.register?.submittedAt ?? state.legacyMarkedAt,
    /** Who pressed Submit; null for registers submitted automatically before 6 Oct 2026, or taken before registers were tracked. */
    submittedBy: state.register?.submittedBy ? fullName(state.register.submittedBy) : null,
    autoSubmitted: state.register?.autoSubmitted ?? false,
    halfDay: settings.halfDay,
    isAdmin: isSchoolLeader(ctx.user.role),
    editable,
    lockedReason,
    closure: closure ? { kind: closure.kind, label: closure.label } : null,
  };
}

// -----------------------------------------------------------------------------
// Writing a register
// -----------------------------------------------------------------------------

async function prepareWrite(ctx: TenantContext, input: { sectionId: string; date: Date; entries: AttendanceEntry[] }) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "PRINCIPAL", "TEACHER");
  try {
    await requireAttendanceAccess(ctx, input.sectionId, input.date);
  } catch (error) {
    // A refused register is worth knowing about: a stale page after a change
    // of class teacher, or someone editing the request.
    await recordAudit({
      action: "ATTENDANCE_ACCESS_DENIED",
      entityType: "Section",
      entityId: input.sectionId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: "A register was refused: the user is not this section's class teacher or assigned cover.",
    });
    throw error;
  }
  const section = await loadSection(ctx, input.sectionId);
  assertMarkableDate(ctx, input.date, section.academicSession);
  await assertNotHoliday(ctx, input.date);
  if (!input.entries.length) throw new ValidationError("Mark at least one student before saving.");
  // Half Day only where the School Admin allows it — checked here, not just hidden in the form.
  if (input.entries.some((entry) => entry.status === "HALF_DAY") && !(await schoolSettings(ctx)).halfDay) {
    throw new ValidationError("Half Day is turned off for this school. Ask the School Admin to allow it under Settings → Attendance.");
  }

  const enrolled = new Set(
    (await ctx.db.studentEnrollment.findMany({ where: { sectionId: section.id, status: "ACTIVE" }, select: { studentId: true } })).map((row) => row.studentId),
  );
  // A forged student id — including one from another school — fails the whole save.
  if (input.entries.some((entry) => !enrolled.has(entry.studentId))) throw new ForbiddenError("A student in this register is not in this section.");
  return section;
}

/**
 * Save draft (and auto-save): keep the marks while the teacher works. Never
 * the record, and never submitted from here — nothing reaches parents,
 * students, dashboards or reports until the teacher presses Submit Attendance.
 */
export async function saveRegisterDraft(
  ctx: TenantContext,
  input: { sectionId: string; date: Date; entries: AttendanceEntry[] },
): Promise<{ savedAt: Date }> {
  const section = await prepareWrite(ctx, input);
  const state = await registerState(ctx, section.id, input.date);
  if (state.register?.status === "SUBMITTED" || state.legacyMarkedAt) {
    throw new ConflictError("This attendance is already submitted. Use Correct attendance to change it.");
  }

  const draft: DraftMarks = {
    marks: Object.fromEntries(input.entries.map((entry) => [entry.studentId, { status: entry.status, remarks: entry.remarks }])),
    savedById: ctx.user.id,
  };
  const savedAt = new Date();
  await ctx.db.attendanceRegister.upsert({
    where: { schoolId_sectionId_date: { schoolId: ctx.schoolId, sectionId: section.id, date: input.date } },
    create: {
      schoolId: ctx.schoolId,
      academicSessionId: section.academicSession.id,
      sectionId: section.id,
      date: input.date,
      status: "DRAFT",
      draft,
      draftSavedAt: savedAt,
      // No submission time: a draft waits for the teacher, however long.
      finalizeAt: null,
    },
    update: { draft, draftSavedAt: savedAt, finalizeAt: null },
  });
  return { savedAt };
}

async function writeMarks(ctx: TenantContext, sectionId: string, academicSessionId: string, date: Date, entries: AttendanceEntry[], tx: TenantDb) {
  for (const entry of entries) {
    await tx.studentAttendance.upsert({
      where: { schoolId_studentId_date: { schoolId: ctx.schoolId, studentId: entry.studentId, date } },
      create: {
        schoolId: ctx.schoolId,
        academicSessionId,
        studentId: entry.studentId,
        sectionId,
        date,
        status: entry.status,
        remarks: entry.remarks,
        markedByUserId: ctx.user.id,
      },
      update: { sectionId, academicSessionId, status: entry.status, remarks: entry.remarks, markedByUserId: ctx.user.id, markedAt: new Date() },
    });
  }
}

export type SaveOutcome = { saved: number; kind: "SUBMITTED" | "CORRECTED"; deadline: Date | null };

/**
 * Save a whole register — the Submit / Correct button.
 *
 * Not yet submitted: this submits it, starting the correction window.
 * Already submitted: this is a correction — a teacher only inside the window
 * and with a reason when anything changes; the School Admin at any time. Each
 * changed mark is on the audit trail with its old and new value.
 */
export async function markAttendance(
  ctx: TenantContext,
  input: { sectionId: string; date: Date; entries: AttendanceEntry[]; reason?: string | null },
): Promise<SaveOutcome> {
  const section = await prepareWrite(ctx, input);
  const state = await registerState(ctx, section.id, input.date);
  const submitted = state.register?.status === "SUBMITTED" || Boolean(state.legacyMarkedAt);

  if (!submitted) {
    const now = new Date();
    const deadline = correctionDeadlineFor(now, input.date);
    await ctx.db.$transaction(async (tx) => {
      await tx.attendanceRegister.upsert({
        where: { schoolId_sectionId_date: { schoolId: ctx.schoolId, sectionId: section.id, date: input.date } },
        create: {
          schoolId: ctx.schoolId,
          academicSessionId: section.academicSession.id,
          sectionId: section.id,
          date: input.date,
          status: "SUBMITTED",
          submittedAt: now,
          submittedById: ctx.user.id,
          correctionDeadline: deadline,
        },
        update: { status: "SUBMITTED", draft: Prisma.DbNull, submittedAt: now, submittedById: ctx.user.id, autoSubmitted: false, correctionDeadline: deadline, finalizeAt: null },
      });
      await writeMarks(ctx, section.id, section.academicSession.id, input.date, input.entries, tx as unknown as TenantDb);
    });
    const absent = input.entries.filter((entry) => entry.status === "ABSENT").length;
    await recordAudit({
      action: "ATTENDANCE_MARKED",
      entityType: "Section",
      entityId: section.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Attendance for ${sectionLabel(section)} on ${formatDate(input.date)} submitted: ${input.entries.length} marked, ${absent} absent.`,
    });
    return { saved: input.entries.length, kind: "SUBMITTED", deadline };
  }

  // A correction.
  if (ctx.user.role === "TEACHER" && !teacherMayCorrect(state.register, state.legacyMarkedAt, input.date)) {
    throw new ForbiddenError("The attendance correction window has ended. Please contact your School Admin if a correction is needed.");
  }
  const before = new Map(
    (await ctx.db.studentAttendance.findMany({ where: { sectionId: section.id, date: input.date }, select: { studentId: true, status: true, remarks: true } })).map((row) => [row.studentId, row]),
  );
  const changed = input.entries.filter((entry) => {
    const old = before.get(entry.studentId);
    return !old || old.status !== entry.status || (old.remarks ?? null) !== (entry.remarks ?? null);
  });
  const reason = input.reason?.trim() || null;
  if (changed.length && ctx.user.role === "TEACHER" && !reason) {
    throw new ValidationError("Add a short reason for this correction, then save again.", { reason: ["Say briefly why you are changing this attendance."] });
  }
  if (changed.length) {
    await ctx.db.$transaction(async (tx) => writeMarks(ctx, section.id, section.academicSession.id, input.date, changed, tx as unknown as TenantDb));
    const names = new Map(
      (await ctx.db.student.findMany({ where: { id: { in: changed.map((entry) => entry.studentId) } }, select: { id: true, firstName: true, lastName: true } })).map((row) => [row.id, fullName(row)]),
    );
    const word = (status: string | null | undefined) => (status ? STATUS_WORD[status] ?? status : "Not marked");
    const lines = changed.map((entry) => `${names.get(entry.studentId) ?? "A student"}: ${word(before.get(entry.studentId)?.status)} → ${word(entry.status)}`);
    await recordAudit({
      action: "ATTENDANCE_CORRECTED",
      entityType: "Section",
      entityId: section.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Attendance for ${sectionLabel(section)} on ${formatDate(input.date)} corrected — ${lines.slice(0, 5).join("; ")}${lines.length > 5 ? `; and ${lines.length - 5} more` : ""}${reason ? `. Reason: ${reason}` : ""}.`,
      metadata: {
        reason,
        // Old → new per student, in the shape the audit log shows as a table.
        changes: changed.map((entry) => ({ label: names.get(entry.studentId) ?? entry.studentId, old: word(before.get(entry.studentId)?.status), new: word(entry.status), studentId: entry.studentId })),
      },
    });
  }
  const { deadline } = registerPhase(state.register, state.legacyMarkedAt, input.date);
  return { saved: changed.length, kind: "CORRECTED", deadline };
}

/** "Correction available until 11:00 am" — for messages. */
export function deadlineLabel(deadline: Date | null): string {
  return deadline ? formatSchoolTime(deadline) : "";
}
