import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { closureOn } from "@/lib/calendar";
import { addDays, dayOfWeek, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { requireTeacherSelf } from "@/server/auth/teacher-access";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { type SyllabusLevel, buildTree } from "@/server/academics/syllabus";
import { getSchoolCalendar } from "@/server/calendar/holidays";
import { VISIBLE_PAPER } from "@/server/exams/service";

/**
 * Academic progress for one class (section) and subject, computed every time
 * from the records that already exist — the syllabus, lessons and the topics
 * recorded in them, homework and what teachers recorded after checking it,
 * tests with submitted marks, and reviews. Nothing is copied into a report
 * table, so correcting any record corrects every report.
 *
 * Five measures are kept apart and never merged into one score:
 *
 *   1. syllabus coverage — topics recorded as taught / topics in the syllabus
 *      (only when the syllabus is set up; otherwise "not configured");
 *   2. homework submission — submitted or late / students it was for, on
 *      homework already due;
 *   3. homework review — students the teacher has recorded / students it was
 *      for, on homework already due;
 *   4. assessment participation — students with marks / students on the roll;
 *   5. assessment performance — the average of the marks given.
 *
 * A lesson the timetable expected with no record is "lesson record missing" —
 * never "not conducted": the teacher's attendance and the class register are
 * shown beside it as separate evidence for a person to review.
 *
 * Who sees what: a teacher, the classes and subjects they are assigned to; a
 * School Admin or Principal (`academics` VIEW), the whole school.
 */

export type Pair = { sectionId: string; subjectId: string };
const key = (pair: Pair) => `${pair.sectionId}:${pair.subjectId}`;
const RECORDED_TAUGHT = ["COMPLETED", "SUBSTITUTE", "REMOTE"] as const;
const LIVE_REVIEW = ["OPEN", "UPDATE_REQUESTED", "REVISION_RECOMMENDED", "REVISION_PLANNED", "REVISION_DONE"] as const;
/** Score bands for a distribution — descriptive only, not grades. */
export const SCORE_BANDS = [
  { label: "Below 40%", min: 0, max: 40 },
  { label: "40–59%", min: 40, max: 60 },
  { label: "60–79%", min: 60, max: 80 },
  { label: "80% and above", min: 80, max: 101 },
] as const;

// -----------------------------------------------------------------------------
// Scope
// -----------------------------------------------------------------------------

export type ProgressScope = { sessionId: string; leader: boolean; teacherId: string | null; pairs: Pair[] };

/** The class+subject pairs this person may see this session. */
export async function progressScope(ctx: TenantContext): Promise<ProgressScope> {
  const session = await requireCurrentSession(ctx);
  if (ctx.user.role === "TEACHER") {
    const teacher = await requireTeacherSelf(ctx);
    const rows = await ctx.db.teacherSubjectAssignment.findMany({ where: { teacherId: teacher.id, academicSessionId: session.id }, select: { sectionId: true, subjectId: true } });
    return { sessionId: session.id, leader: false, teacherId: teacher.id, pairs: unique(rows) };
  }
  assertCan(ctx, "academics", "VIEW");
  const [assigned, slots] = await Promise.all([
    ctx.db.teacherSubjectAssignment.findMany({ where: { academicSessionId: session.id }, select: { sectionId: true, subjectId: true } }),
    ctx.db.timetableSlot.findMany({ where: { academicSessionId: session.id }, select: { sectionId: true, subjectId: true } }),
  ]);
  return { sessionId: session.id, leader: true, teacherId: null, pairs: unique([...assigned, ...slots]) };
}

function unique(rows: Pair[]): Pair[] {
  const seen = new Map<string, Pair>();
  for (const row of rows) seen.set(key(row), { sectionId: row.sectionId, subjectId: row.subjectId });
  return [...seen.values()];
}

/** Refuse a class+subject outside this person's scope — the same answer whether it exists or not. */
export async function requirePair(ctx: TenantContext, pair: Pair): Promise<ProgressScope> {
  const scope = await progressScope(ctx);
  if (!scope.pairs.some((row) => key(row) === key(pair))) {
    throw scope.leader ? new NotFoundError("That class and subject were not found.") : new ForbiddenError("You do not teach that subject to that class.");
  }
  return scope;
}

// -----------------------------------------------------------------------------
// The computation, for many pairs at once
// -----------------------------------------------------------------------------

export type TopicState = { id: string; title: string; chapter: string; coverage: "COVERED" | "PARTIAL" | null; lastTaughtOn: Date | null };
export type AssessmentStat = {
  id: string;
  name: string;
  date: Date;
  maxMarks: number;
  syllabusItemId: string | null;
  unitId: string | null;
  itemLevel: SyllabusLevel | null;
  itemTitle: string | null;
  roster: number;
  sat: number;
  absent: number;
  exempt: number;
  /** Average of the marks given, as a percentage; null when nobody has marks. */
  averagePercent: number | null;
  bands: number[];
  belowThreshold: boolean;
  reviewId: string | null;
};
export type HomeworkStat = { assigned: number; due: number; expected: number; submitted: number; late: number; missing: number; unchecked: number; submissionRate: number | null; reviewRate: number | null };
export type UnitProgress = {
  id: string;
  title: string;
  plannedFrom: Date | null;
  plannedTo: Date | null;
  topics: TopicState[];
  expected: number;
  covered: number;
  partial: number;
  /** Covered topics / topics in the unit; null when the unit has no topics yet. */
  percent: number | null;
  /** The planned end has passed and not every topic is covered. */
  behind: boolean;
  homework: HomeworkStat;
  assessments: AssessmentStat[];
  readyReview: { id: string; status: string; at: Date } | null;
};
export type MissingRecord = { date: Date; slotId: string; teacherId: string; teacher: string; teacherAttendance: string | null; registerSubmitted: boolean };
export type PairProgress = {
  pair: Pair;
  section: string;
  classId: string;
  subject: string;
  teachers: string[];
  syllabus: { configured: boolean; expected: number; covered: number; partial: number; percent: number | null; units: UnitProgress[]; behind: number };
  lessons: { scheduled: number; completed: number; notConducted: number; cancelled: number; withPartialTopics: number; missingRecords: MissingRecord[] };
  homework: HomeworkStat & { assignedInRange: number; overdueUnchecked: number };
  assessments: AssessmentStat[];
  reviews: ReviewRow[];
  threshold: number;
};
export type ReviewRow = {
  id: string;
  kind: string;
  status: string;
  note: string | null;
  teacherResponse: string | null;
  revisionPlannedOn: Date | null;
  revisionSessionId: string | null;
  revisionDate: Date | null;
  itemTitle: string | null;
  assessment: { id: string; name: string } | null;
  followUp: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function emptyHomework(): HomeworkStat {
  return { assigned: 0, due: 0, expected: 0, submitted: 0, late: 0, missing: 0, unchecked: 0, submissionRate: null, reviewRate: null };
}

function finishHomework(stat: HomeworkStat): HomeworkStat {
  const checked = stat.submitted + stat.late + stat.missing;
  return { ...stat, unchecked: Math.max(0, stat.expected - checked), submissionRate: percent(stat.submitted + stat.late, stat.expected), reviewRate: percent(checked, stat.expected) };
}

/**
 * Progress for each pair, from the source records. `range` bounds the
 * lesson-record checks and the "homework set" count; coverage, homework
 * completion and tests run over the whole session so far.
 */
export async function computeProgress(ctx: TenantContext, scope: ProgressScope, pairs: Pair[], range: { from: Date; to: Date }): Promise<Map<string, PairProgress>> {
  const out = new Map<string, PairProgress>();
  if (!pairs.length) return out;
  const now = today();
  const sessionId = scope.sessionId;
  const pairWhere = pairs.map((pair) => ({ sectionId: pair.sectionId, subjectId: pair.subjectId }));
  const sectionIds = [...new Set(pairs.map((pair) => pair.sectionId))];
  const subjectIds = [...new Set(pairs.map((pair) => pair.subjectId))];
  const to = range.to < now ? range.to : now;

  const [school, sections, subjects, slots, assignments, homework, assessments, reviews, enrollments] = await Promise.all([
    ctx.db.school.findFirst({ select: { academicReviewPercent: true } }),
    ctx.db.section.findMany({ where: { id: { in: sectionIds } }, select: { id: true, classId: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } } }),
    ctx.db.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } }),
    ctx.db.timetableSlot.findMany({ where: { academicSessionId: sessionId, OR: pairWhere }, select: { id: true, sectionId: true, subjectId: true, dayOfWeek: true, teacherId: true, teacher: { select: { firstName: true, lastName: true } } } }),
    ctx.db.teacherSubjectAssignment.findMany({ where: { academicSessionId: sessionId, OR: pairWhere }, select: { sectionId: true, subjectId: true, teacher: { select: { firstName: true, lastName: true } } } }),
    ctx.db.homework.findMany({
      where: { academicSessionId: sessionId, status: "PUBLISHED", OR: pairWhere },
      select: { id: true, sectionId: true, subjectId: true, streamId: true, audience: true, assignedOn: true, dueOn: true, syllabusItemId: true, _count: { select: { targets: true } }, submissions: { select: { status: true } } },
    }),
    ctx.db.assessment.findMany({
      where: { academicSessionId: sessionId, OR: pairWhere, AND: [VISIBLE_PAPER] },
      orderBy: { date: "asc" },
      select: { id: true, name: true, date: true, maxMarks: true, sectionId: true, subjectId: true, streamId: true, syllabusItemId: true, results: { select: { marksObtained: true, absent: true, exempt: true } } },
    }),
    ctx.db.academicReview.findMany({
      where: { academicSessionId: sessionId, OR: pairWhere },
      orderBy: { createdAt: "desc" },
      select: { id: true, sectionId: true, subjectId: true, kind: true, status: true, note: true, teacherResponse: true, revisionPlannedOn: true, revisionSessionId: true, revisionSession: { select: { date: true } }, syllabusItemId: true, syllabusItem: { select: { title: true } }, assessmentId: true, assessment: { select: { id: true, name: true } }, followUpAssessment: { select: { id: true, name: true } }, createdAt: true, updatedAt: true },
    }),
    ctx.db.studentEnrollment.findMany({ where: { academicSessionId: sessionId, sectionId: { in: sectionIds }, status: "ACTIVE", student: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }, select: { sectionId: true, streamId: true, section: { select: { streamId: true } } } }),
  ]);
  const threshold = school?.academicReviewPercent ?? 60;
  const classIds = [...new Set(sections.map((section) => section.classId))];
  const slotIds = slots.map((slot) => slot.id);

  const [items, lessonTopics, sessionsInRange, calendar, teacherMarks, registers] = await Promise.all([
    ctx.db.syllabusItem.findMany({ where: { academicSessionId: sessionId, classId: { in: classIds }, subjectId: { in: subjectIds } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, level: true, parentId: true, title: true, position: true, plannedFrom: true, plannedTo: true, classId: true, subjectId: true } }),
    slotIds.length
      ? ctx.db.lessonTopic.findMany({ where: { classSession: { timetableSlotId: { in: slotIds }, status: { in: [...RECORDED_TAUGHT] } } }, select: { topicId: true, coverage: true, classSession: { select: { date: true, timetableSlotId: true } } } })
      : Promise.resolve([]),
    slotIds.length ? ctx.db.classSession.findMany({ where: { timetableSlotId: { in: slotIds }, date: { gte: range.from, lte: to } }, select: { timetableSlotId: true, date: true, status: true, topics: { where: { coverage: "PARTIAL" }, select: { id: true } } } }) : Promise.resolve([]),
    getSchoolCalendar(ctx, range.from, to),
    ctx.db.teacherAttendance.findMany({ where: { date: { gte: range.from, lte: to }, teacherId: { in: [...new Set(slots.map((slot) => slot.teacherId))] } }, select: { teacherId: true, date: true, status: true } }),
    ctx.db.attendanceRegister.findMany({ where: { sectionId: { in: sectionIds }, date: { gte: range.from, lte: to } }, select: { sectionId: true, date: true, status: true } }),
  ]);

  const recordAt = new Map(sessionsInRange.map((row) => [`${row.timetableSlotId}:${row.date.getTime()}`, row]));
  const markAt = new Map(teacherMarks.map((row) => [`${row.teacherId}:${row.date.getTime()}`, row.status]));
  const registerAt = new Map(registers.map((row) => [`${row.sectionId}:${row.date.getTime()}`, row.status]));
  const rosterOf = (sectionId: string, streamId: string | null) => enrollments.filter((row) => row.sectionId === sectionId && (!streamId || (row.streamId ?? row.section.streamId) === streamId)).length;

  // Dates in range the school is open, once.
  const openDays: Date[] = [];
  for (let day = range.from; day <= to; day = addDays(day, 1)) if (!closureOn(calendar, day)) openDays.push(day);

  for (const pair of pairs) {
    const section = sections.find((row) => row.id === pair.sectionId);
    const subject = subjects.find((row) => row.id === pair.subjectId);
    if (!section || !subject) continue;
    const pairItems = items.filter((item) => item.classId === section.classId && item.subjectId === subject.id);
    const tree = buildTree(pairItems);
    const parentOf = new Map(pairItems.map((item) => [item.id, item.parentId]));
    const levelOf = new Map(pairItems.map((item) => [item.id, item.level as SyllabusLevel]));
    const titleOf = new Map(pairItems.map((item) => [item.id, item.title]));
    const unitOf = (itemId: string | null): string | null => {
      let current = itemId;
      for (let guard = 0; current && guard < 3; guard += 1) {
        if (levelOf.get(current) === "UNIT") return current;
        current = parentOf.get(current) ?? null;
      }
      return null;
    };
    const pairSlots = slots.filter((slot) => slot.sectionId === pair.sectionId && slot.subjectId === pair.subjectId);
    const pairSlotIds = new Set(pairSlots.map((slot) => slot.id));

    // Coverage: the best a topic has been recorded, in this section.
    const coverage = new Map<string, { coverage: "COVERED" | "PARTIAL"; last: Date }>();
    for (const row of lessonTopics) {
      if (!pairSlotIds.has(row.classSession.timetableSlotId)) continue;
      const seen = coverage.get(row.topicId);
      const best = seen?.coverage === "COVERED" || row.coverage === "COVERED" ? "COVERED" : "PARTIAL";
      const last = !seen || row.classSession.date > seen.last ? row.classSession.date : seen.last;
      coverage.set(row.topicId, { coverage: best, last });
    }

    // Lessons in range: expected by the timetable on open days, against records.
    const lessons = { scheduled: 0, completed: 0, notConducted: 0, cancelled: 0, withPartialTopics: 0, missingRecords: [] as MissingRecord[] };
    for (const day of openDays) {
      const weekday = dayOfWeek(day);
      for (const slot of pairSlots) {
        if (slot.dayOfWeek !== weekday) continue;
        lessons.scheduled += 1;
        const record = recordAt.get(`${slot.id}:${day.getTime()}`);
        if (!record || record.status === "SCHEDULED") {
          // Today's lesson may simply not have been written up yet.
          if (day < now) {
            lessons.missingRecords.push({ date: day, slotId: slot.id, teacherId: slot.teacherId, teacher: fullName(slot.teacher), teacherAttendance: markAt.get(`${slot.teacherId}:${day.getTime()}`) ?? null, registerSubmitted: registerAt.get(`${pair.sectionId}:${day.getTime()}`) === "SUBMITTED" });
          }
          continue;
        }
        if ((RECORDED_TAUGHT as readonly string[]).includes(record.status)) lessons.completed += 1;
        else if (record.status === "MISSED") lessons.notConducted += 1;
        else if (record.status === "CANCELLED") lessons.cancelled += 1;
        if (record.topics.length) lessons.withPartialTopics += 1;
      }
    }

    // Homework, per pair and per unit.
    const pairHomework = homework.filter((row) => row.sectionId === pair.sectionId && row.subjectId === pair.subjectId);
    const homeworkStat = (rows: typeof pairHomework): HomeworkStat => {
      const stat = emptyHomework();
      for (const row of rows) {
        stat.assigned += 1;
        if (row.dueOn > now) continue;
        stat.due += 1;
        stat.expected += row.audience === "SELECTED_STUDENTS" ? row._count.targets : rosterOf(row.sectionId, row.streamId);
        for (const mark of row.submissions) {
          if (mark.status === "SUBMITTED") stat.submitted += 1;
          else if (mark.status === "LATE") stat.late += 1;
          else stat.missing += 1;
        }
      }
      return finishHomework(stat);
    };
    const pairHomeworkStat = homeworkStat(pairHomework);
    const overdueUnchecked = pairHomework.filter((row) => row.dueOn < now && row.submissions.length === 0).length;
    const assignedInRange = pairHomework.filter((row) => row.assignedOn >= range.from && row.assignedOn <= range.to).length;

    // Tests with submitted (or published) marks.
    const pairReviews = reviews.filter((row) => row.sectionId === pair.sectionId && row.subjectId === pair.subjectId);
    const stats: AssessmentStat[] = assessments
      .filter((row) => row.sectionId === pair.sectionId && row.subjectId === pair.subjectId)
      .map((row) => {
        const marked = row.results.filter((result) => result.marksObtained !== null && !result.absent && !result.exempt);
        const avg = marked.length && row.maxMarks > 0 ? Math.round((marked.reduce((sum, result) => sum + result.marksObtained!, 0) / marked.length / row.maxMarks) * 1000) / 10 : null;
        const bands = SCORE_BANDS.map((band) => marked.filter((result) => { const p = (result.marksObtained! / row.maxMarks) * 100; return p >= band.min && p < band.max; }).length);
        const itemId = row.syllabusItemId && levelOf.has(row.syllabusItemId) ? row.syllabusItemId : null;
        return {
          id: row.id,
          name: row.name,
          date: row.date,
          maxMarks: row.maxMarks,
          syllabusItemId: itemId,
          unitId: unitOf(itemId),
          itemLevel: itemId ? levelOf.get(itemId)! : null,
          itemTitle: itemId ? titleOf.get(itemId)! : null,
          roster: rosterOf(row.sectionId, row.streamId),
          sat: marked.length,
          absent: row.results.filter((result) => result.absent).length,
          exempt: row.results.filter((result) => result.exempt).length,
          averagePercent: avg,
          bands,
          belowThreshold: avg !== null && avg < threshold,
          reviewId: pairReviews.find((review) => review.kind === "LOW_PERFORMANCE" && review.assessmentId === row.id)?.id ?? null,
        };
      });

    const units: UnitProgress[] = tree.map((unit) => {
      const topics: TopicState[] = unit.chapters.flatMap((chapter) => chapter.topics.map((topic) => ({ id: topic.id, title: topic.title, chapter: chapter.title, coverage: coverage.get(topic.id)?.coverage ?? null, lastTaughtOn: coverage.get(topic.id)?.last ?? null })));
      const covered = topics.filter((topic) => topic.coverage === "COVERED").length;
      const partial = topics.filter((topic) => topic.coverage === "PARTIAL").length;
      const ready = pairReviews.find((review) => review.kind === "UNIT_READY" && review.syllabusItemId === unit.id);
      return {
        id: unit.id,
        title: unit.title,
        plannedFrom: unit.plannedFrom,
        plannedTo: unit.plannedTo,
        topics,
        expected: topics.length,
        covered,
        partial,
        percent: percent(covered, topics.length),
        behind: Boolean(unit.plannedTo && unit.plannedTo < now && covered < topics.length),
        homework: homeworkStat(pairHomework.filter((row) => unitOf(row.syllabusItemId && levelOf.has(row.syllabusItemId) ? row.syllabusItemId : null) === unit.id)),
        assessments: stats.filter((stat) => stat.unitId === unit.id),
        readyReview: ready ? { id: ready.id, status: ready.status, at: ready.createdAt } : null,
      };
    });
    const expected = units.reduce((sum, unit) => sum + unit.expected, 0);
    const covered = units.reduce((sum, unit) => sum + unit.covered, 0);
    const teacherNames = [...new Set([...assignments.filter((row) => row.sectionId === pair.sectionId && row.subjectId === pair.subjectId).map((row) => fullName(row.teacher)), ...pairSlots.map((slot) => fullName(slot.teacher))])];

    out.set(key(pair), {
      pair,
      section: sectionLabel(section),
      classId: section.classId,
      subject: subject.name,
      teachers: teacherNames,
      syllabus: { configured: expected > 0, expected, covered, partial: units.reduce((sum, unit) => sum + unit.partial, 0), percent: percent(covered, expected), units, behind: units.filter((unit) => unit.behind).length },
      lessons,
      homework: { ...pairHomeworkStat, assignedInRange, overdueUnchecked },
      assessments: stats,
      reviews: pairReviews.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        note: row.note,
        teacherResponse: row.teacherResponse,
        revisionPlannedOn: row.revisionPlannedOn,
        revisionSessionId: row.revisionSessionId,
        revisionDate: row.revisionSession?.date ?? null,
        itemTitle: row.syllabusItem?.title ?? null,
        assessment: row.assessment,
        followUp: row.followUpAssessment,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      threshold,
    });
  }
  return out;
}

/** Progress for one class and subject this person may see. */
export async function pairProgress(ctx: TenantContext, pair: Pair, range?: { from: Date; to: Date }): Promise<PairProgress> {
  const scope = await requirePair(ctx, pair);
  const now = today();
  const result = await computeProgress(ctx, scope, [pair], range ?? { from: addDays(now, -30), to: now });
  const progress = result.get(key(pair));
  if (!progress) throw new NotFoundError("That class and subject were not found.");
  return progress;
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------

/**
 * One unit's report for one class: expected and covered topics, lessons that
 * taught them, homework and tests linked to the unit, topic-wise gaps,
 * pending work and the reviews. Built from the same computation as every
 * other view.
 */
export async function unitReport(ctx: TenantContext, pair: Pair, unitId: string) {
  const progress = await pairProgress(ctx, pair);
  const unit = progress.syllabus.units.find((row) => row.id === unitId);
  if (!unit) throw new NotFoundError("That unit was not found in this class's syllabus.");
  const [school, session] = await Promise.all([
    ctx.db.school.findFirst({ select: { name: true } }),
    ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { name: true } }),
  ]);
  const topicIds = new Set(unit.topics.map((topic) => topic.id));
  const lessonRows = await ctx.db.lessonTopic.findMany({
    where: { topicId: { in: [...topicIds] }, classSession: { timetableSlot: { sectionId: pair.sectionId, subjectId: pair.subjectId } } },
    select: { classSessionId: true, coverage: true, classSession: { select: { status: true } } },
  });
  const lessonIds = new Set(lessonRows.map((row) => row.classSessionId));
  const topicAssessments = (topicId: string) => unit.assessments.filter((stat) => stat.syllabusItemId === topicId);
  const gaps = unit.topics
    .map((topic) => {
      const tests = topicAssessments(topic.id).filter((stat) => stat.averagePercent !== null);
      const low = tests.filter((stat) => stat.belowThreshold);
      const reasons = [topic.coverage === null ? "Not recorded as taught" : topic.coverage === "PARTIAL" ? "Only partly covered" : null, low.length ? `Below ${progress.threshold}% in ${low.map((stat) => stat.name).join(", ")}` : null].filter((row): row is string => row !== null);
      return { topic, reasons };
    })
    .filter((row) => row.reasons.length);
  const reviews = progress.reviews.filter((row) => row.kind === "UNIT_READY" ? unit.readyReview?.id === row.id : unit.assessments.some((stat) => stat.id === row.assessment?.id) || row.itemTitle === unit.title);
  return {
    school: school?.name ?? "",
    session: session?.name ?? "",
    section: progress.section,
    subject: progress.subject,
    teachers: progress.teachers,
    threshold: progress.threshold,
    unit,
    lessonsTeachingUnit: lessonIds.size,
    gaps,
    pending: [
      ...unit.topics.filter((topic) => topic.coverage === null).map((topic) => `Teach: ${topic.title}`),
      ...(unit.homework.unchecked ? [`Check homework: ${unit.homework.unchecked} student entries not recorded`] : []),
      ...(unit.assessments.length ? [] : ["No assessment linked to this unit yet"]),
    ],
    reviews,
  };
}

/**
 * Before examinations: per subject of a section, what is covered and pending,
 * homework and revision status, test performance, topics that need more
 * teaching, and revision outcomes (original vs follow-up test). It shows the
 * evidence; it never declares a class "exam-ready" — staff decide.
 */
export async function examReadiness(ctx: TenantContext, input: { sectionId: string; subjectId?: string | null }) {
  const scope = await progressScope(ctx);
  const pairs = scope.pairs.filter((pair) => pair.sectionId === input.sectionId && (!input.subjectId || pair.subjectId === input.subjectId));
  if (!pairs.length) throw scope.leader ? new NotFoundError("That class was not found.") : new ForbiddenError("You do not teach that class.");
  const now = today();
  const progress = await computeProgress(ctx, scope, pairs, { from: addDays(now, -30), to: now });
  const followUps = await ctx.db.assessment.findMany({
    where: { id: { in: [...progress.values()].flatMap((row) => row.reviews.map((review) => review.followUp?.id).filter((id): id is string => Boolean(id))) }, AND: [VISIBLE_PAPER] },
    select: { id: true, maxMarks: true, results: { select: { marksObtained: true, absent: true, exempt: true } } },
  });
  const averageOf = (id: string) => {
    const paper = followUps.find((row) => row.id === id);
    if (!paper) return null;
    const marked = paper.results.filter((row) => row.marksObtained !== null && !row.absent && !row.exempt);
    return marked.length && paper.maxMarks ? Math.round((marked.reduce((sum, row) => sum + row.marksObtained!, 0) / marked.length / paper.maxMarks) * 1000) / 10 : null;
  };
  const subjects = [...progress.values()].map((row) => {
    const revisions = row.reviews.filter((review) => review.kind === "LOW_PERFORMANCE" || ["REVISION_RECOMMENDED", "REVISION_PLANNED", "REVISION_DONE"].includes(review.status));
    return {
      pair: row.pair,
      subject: row.subject,
      teachers: row.teachers,
      syllabus: { configured: row.syllabus.configured, percent: row.syllabus.percent, expected: row.syllabus.expected, covered: row.syllabus.covered },
      unitsCompleted: row.syllabus.units.filter((unit) => unit.expected > 0 && unit.covered === unit.expected).map((unit) => unit.title),
      unitsPending: row.syllabus.units.filter((unit) => unit.expected === 0 || unit.covered < unit.expected).map((unit) => ({ title: unit.title, pendingTopics: unit.topics.filter((topic) => topic.coverage !== "COVERED").map((topic) => topic.title), behind: unit.behind })),
      homework: row.homework,
      assessments: row.assessments,
      needsTeaching: row.syllabus.units.flatMap((unit) => [
        ...unit.topics.filter((topic) => topic.coverage !== "COVERED").map((topic) => ({ unit: unit.title, topic: topic.title, reason: topic.coverage === "PARTIAL" ? "Partly covered" : "Not recorded as taught" })),
        ...unit.assessments.filter((stat) => stat.belowThreshold).map((stat) => ({ unit: unit.title, topic: stat.itemTitle ?? unit.title, reason: `${stat.name}: average ${stat.averagePercent}% (below ${row.threshold}%, ${stat.sat} students)` })),
      ]),
      revisions: revisions.map((review) => {
        const original = row.assessments.find((stat) => stat.id === review.assessment?.id)?.averagePercent ?? null;
        const followUp = review.followUp ? averageOf(review.followUp.id) : null;
        return { ...review, originalAverage: original, followUpAverage: followUp };
      }),
      threshold: row.threshold,
    };
  });
  const section = [...progress.values()][0]!.section;
  return { section, subjects, generatedAt: new Date() };
}

// -----------------------------------------------------------------------------
// The leaders' monitoring view: exceptions first
// -----------------------------------------------------------------------------

export type MonitoringFilters = { sectionId?: string | null; subjectId?: string | null; teacherId?: string | null; from: Date; to: Date };

/**
 * What needs a leader's attention across the school: lesson records missing
 * (with evidence), units behind their plan, tests below the threshold not yet
 * reviewed, units marked ready, open reviews, and per-class coverage and
 * homework figures. School leaders only.
 */
export async function academicMonitoring(ctx: TenantContext, filters: MonitoringFilters) {
  assertCan(ctx, "academics", "VIEW");
  const scope = await progressScope(ctx);
  let pairs = scope.pairs.filter((pair) => (!filters.sectionId || pair.sectionId === filters.sectionId) && (!filters.subjectId || pair.subjectId === filters.subjectId));
  if (filters.teacherId) {
    const mine = await ctx.db.teacherSubjectAssignment.findMany({ where: { teacherId: filters.teacherId, academicSessionId: scope.sessionId }, select: { sectionId: true, subjectId: true } });
    const allowed = new Set(mine.map(key));
    pairs = pairs.filter((pair) => allowed.has(key(pair)));
  }
  const progress = [...(await computeProgress(ctx, scope, pairs, { from: filters.from, to: filters.to })).values()].sort((a, b) => a.section.localeCompare(b.section) || a.subject.localeCompare(b.subject));
  return {
    threshold: progress[0]?.threshold ?? (await academicThreshold(ctx)),
    rows: progress,
    missingRecords: progress.flatMap((row) => row.lessons.missingRecords.map((record) => ({ ...record, pair: row.pair, section: row.section, subject: row.subject }))).filter((record) => !filters.teacherId || record.teacherId === filters.teacherId).sort((a, b) => b.date.getTime() - a.date.getTime()),
    behindUnits: progress.flatMap((row) => row.syllabus.units.filter((unit) => unit.behind).map((unit) => ({ pair: row.pair, section: row.section, subject: row.subject, unit }))),
    lowPerformance: progress.flatMap((row) => row.assessments.filter((stat) => stat.belowThreshold && !stat.reviewId).map((stat) => ({ pair: row.pair, section: row.section, subject: row.subject, stat }))),
    readyUnits: progress.flatMap((row) => row.reviews.filter((review) => review.kind === "UNIT_READY" && review.status === "OPEN").map((review) => ({ pair: row.pair, section: row.section, subject: row.subject, review }))),
    openReviews: progress.flatMap((row) => row.reviews.filter((review) => review.kind !== "UNIT_READY" && (LIVE_REVIEW as readonly string[]).includes(review.status)).map((review) => ({ pair: row.pair, section: row.section, subject: row.subject, review }))),
    notConfigured: progress.filter((row) => !row.syllabus.configured).length,
  };
}

// -----------------------------------------------------------------------------
// Threshold
// -----------------------------------------------------------------------------

export async function academicThreshold(ctx: TenantContext): Promise<number> {
  const school = await ctx.db.school.findFirst({ select: { academicReviewPercent: true } });
  return school?.academicReviewPercent ?? 60;
}

/** The School Admin sets the review threshold (settings EDIT). */
export async function saveAcademicThreshold(ctx: TenantContext, value: number): Promise<void> {
  assertCan(ctx, "settings", "EDIT");
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new AppError("VALIDATION", "Use a whole percentage from 1 to 100.");
  const before = await academicThreshold(ctx);
  if (before === value) return;
  await ctx.db.school.update({ where: { id: ctx.schoolId }, data: { academicReviewPercent: value } });
  await recordAudit({ action: "ACADEMIC_THRESHOLD_CHANGED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Academic review threshold: ${before}% → ${value}%.` });
}

// -----------------------------------------------------------------------------
// Reviews and revision
// -----------------------------------------------------------------------------

/** A teacher says a unit's topics are done and asks for review. One open request per unit and class. */
export async function markUnitReady(ctx: TenantContext, input: Pair & { unitId: string; note: string | null }): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const scope = await requirePair(ctx, input);
  const section = await ctx.db.section.findFirstOrThrow({ where: { id: input.sectionId }, select: { classId: true } });
  const unit = await ctx.db.syllabusItem.findFirst({ where: { id: input.unitId, level: "UNIT", classId: section.classId, subjectId: input.subjectId, academicSessionId: scope.sessionId }, select: { id: true, title: true } });
  if (!unit) throw new NotFoundError("That unit was not found in this class's syllabus.");
  const open = await ctx.db.academicReview.findFirst({ where: { kind: "UNIT_READY", sectionId: input.sectionId, subjectId: input.subjectId, syllabusItemId: unit.id, status: { in: [...LIVE_REVIEW] } }, select: { id: true } });
  if (open) throw new ConflictError("This unit is already waiting for review.");
  const row = await ctx.db.academicReview.create({
    data: { schoolId: ctx.schoolId, academicSessionId: scope.sessionId, sectionId: input.sectionId, subjectId: input.subjectId, kind: "UNIT_READY", syllabusItemId: unit.id, teacherResponse: input.note, createdById: ctx.user.id },
    select: { id: true },
  });
  await recordAudit({ action: "UNIT_MARKED_READY", entityType: "AcademicReview", entityId: row.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Unit "${unit.title}" marked ready for review.` });
  return row;
}

export type LeaderReviewAction = "NOTE" | "UPDATE_REQUESTED" | "REVISION_RECOMMENDED" | "RESOLVED";

/**
 * A leader's review: a note on a class and subject, or — from a test below
 * the threshold — a recommendation to revise. Raising the same test twice
 * updates the one review instead of adding another.
 */
export async function createReview(ctx: TenantContext, input: Pair & { assessmentId?: string | null; syllabusItemId?: string | null; note: string | null; action: LeaderReviewAction }): Promise<{ id: string }> {
  assertCan(ctx, "academics", "EDIT");
  const scope = await requirePair(ctx, input);
  let kind: "NOTE" | "LOW_PERFORMANCE" = "NOTE";
  let itemId: string | null = null;
  if (input.assessmentId) {
    const progress = await pairProgress(ctx, input);
    const stat = progress.assessments.find((row) => row.id === input.assessmentId);
    if (!stat) throw new NotFoundError("That test was not found for this class and subject.");
    if (!stat.belowThreshold) throw new ConflictError(`This test's average is not below the ${progress.threshold}% review threshold.`);
    kind = "LOW_PERFORMANCE";
    itemId = stat.syllabusItemId;
  } else if (input.syllabusItemId) {
    const section = await ctx.db.section.findFirstOrThrow({ where: { id: input.sectionId }, select: { classId: true } });
    const item = await ctx.db.syllabusItem.findFirst({ where: { id: input.syllabusItemId, classId: section.classId, subjectId: input.subjectId, academicSessionId: scope.sessionId }, select: { id: true } });
    if (!item) throw new NotFoundError("That unit or topic was not found in this class's syllabus.");
    itemId = item.id;
  }
  const status = input.action === "NOTE" ? "OPEN" : input.action;
  if (kind === "LOW_PERFORMANCE") {
    const existing = await ctx.db.academicReview.findFirst({ where: { kind: "LOW_PERFORMANCE", assessmentId: input.assessmentId! }, select: { id: true } });
    if (existing) {
      await updateReview(ctx, existing.id, { action: input.action, note: input.note });
      return existing;
    }
  }
  const row = await ctx.db.academicReview.create({
    data: { schoolId: ctx.schoolId, academicSessionId: scope.sessionId, sectionId: input.sectionId, subjectId: input.subjectId, kind, status, syllabusItemId: itemId, assessmentId: input.assessmentId ?? null, note: input.note, createdById: ctx.user.id, ...(status === "RESOLVED" ? { resolvedAt: new Date() } : {}) },
    select: { id: true },
  });
  await recordAudit({ action: "ACADEMIC_REVIEW_CREATED", entityType: "AcademicReview", entityId: row.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Academic review (${kind.toLowerCase().replace("_", " ")}): ${status.toLowerCase().replace("_", " ")}.${input.note ? ` ${input.note}` : ""}` });
  return row;
}

/** A leader moves a review on: ask for an update, recommend revision, or close it (a unit marked ready is "reviewed" when closed). */
export async function updateReview(ctx: TenantContext, reviewId: string, input: { action: LeaderReviewAction; note: string | null }): Promise<void> {
  assertCan(ctx, "academics", "EDIT");
  const review = await ctx.db.academicReview.findFirst({ where: { id: reviewId }, select: { id: true, status: true, note: true } });
  if (!review) throw new NotFoundError("That review was not found.");
  if (review.status === "RESOLVED" && input.action !== "NOTE") throw new ConflictError("This review is closed.");
  const status = input.action === "NOTE" ? review.status : input.action;
  await ctx.db.academicReview.update({
    where: { id: review.id },
    data: { status, note: input.note ?? review.note, updatedById: ctx.user.id, ...(status === "RESOLVED" ? { resolvedAt: new Date() } : {}) },
  });
  await recordAudit({ action: "ACADEMIC_REVIEW_UPDATED", entityType: "AcademicReview", entityId: review.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Academic review ${review.status.toLowerCase().replace("_", " ")} → ${status.toLowerCase().replace("_", " ")}.${input.note ? ` ${input.note}` : ""}` });
}

/**
 * The teacher's side of a review on their class and subject: a reply, a
 * planned revision date, the lesson the revision was taught in (one of their
 * own records for this class and subject), and the follow-up test.
 */
export async function respondToReview(
  ctx: TenantContext,
  reviewId: string,
  input: { response: string | null; revisionPlannedOn?: Date | null; revisionSessionId?: string | null; followUpAssessmentId?: string | null },
): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const review = await ctx.db.academicReview.findFirst({ where: { id: reviewId }, select: { id: true, sectionId: true, subjectId: true, status: true, kind: true, assessment: { select: { date: true } } } });
  if (!review) throw new NotFoundError("That review was not found.");
  await requirePair(ctx, review);
  if (review.status === "RESOLVED") throw new ConflictError("This review is closed.");
  const teacher = await requireTeacherSelf(ctx);
  if (input.revisionPlannedOn && input.revisionPlannedOn < addDays(today(), -7)) throw new AppError("VALIDATION", "Plan the revision for a recent or coming date.");

  let sessionId: string | null | undefined;
  if (input.revisionSessionId) {
    const lesson = await ctx.db.classSession.findFirst({
      where: { id: input.revisionSessionId, timetableSlot: { sectionId: review.sectionId, subjectId: review.subjectId }, status: { in: [...RECORDED_TAUGHT] }, OR: [{ actualTeacherId: teacher.id }, { scheduledTeacherId: teacher.id }] },
      select: { id: true, date: true },
    });
    if (!lesson) throw new AppError("VALIDATION", "Choose one of your recorded lessons for this class and subject.");
    if (review.assessment && lesson.date < review.assessment.date) throw new AppError("VALIDATION", "The revision lesson must come after the test that raised this review.");
    sessionId = lesson.id;
  }
  let followUpId: string | null | undefined;
  if (input.followUpAssessmentId) {
    const paper = await ctx.db.assessment.findFirst({ where: { id: input.followUpAssessmentId, sectionId: review.sectionId, subjectId: review.subjectId }, select: { id: true, date: true } });
    if (!paper) throw new AppError("VALIDATION", "Choose a test for this class and subject.");
    if (review.assessment && paper.date <= review.assessment.date) throw new AppError("VALIDATION", "The follow-up test must come after the original test.");
    followUpId = paper.id;
  }
  const status = sessionId ? "REVISION_DONE" : input.revisionPlannedOn ? "REVISION_PLANNED" : review.status === "UPDATE_REQUESTED" ? "OPEN" : review.status;
  await ctx.db.academicReview.update({
    where: { id: review.id },
    data: {
      teacherResponse: input.response,
      status,
      updatedById: ctx.user.id,
      ...(input.revisionPlannedOn !== undefined ? { revisionPlannedOn: input.revisionPlannedOn } : {}),
      ...(sessionId !== undefined ? { revisionSessionId: sessionId } : {}),
      ...(followUpId !== undefined ? { followUpAssessmentId: followUpId } : {}),
    },
  });
  await recordAudit({ action: "ACADEMIC_REVIEW_UPDATED", entityType: "AcademicReview", entityId: review.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Teacher replied to academic review (${status.toLowerCase().replace("_", " ")}).${input.response ? ` ${input.response}` : ""}` });
}

/** Reviews waiting on this teacher: an update asked for, revision recommended, or a planned revision now due. */
export async function myReviewsToAnswer(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const scope = await progressScope(ctx);
  if (!scope.pairs.length) return [];
  const now = today();
  return ctx.db.academicReview.findMany({
    where: {
      academicSessionId: scope.sessionId,
      OR: scope.pairs.map((pair) => ({ sectionId: pair.sectionId, subjectId: pair.subjectId })),
      AND: [{ OR: [{ status: { in: ["UPDATE_REQUESTED", "REVISION_RECOMMENDED"] } }, { status: "REVISION_PLANNED", revisionPlannedOn: { lte: now } }] }],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, kind: true, status: true, note: true, sectionId: true, subjectId: true, revisionPlannedOn: true, subject: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
  });
}

/** Counts for a leader's alerts: units waiting for review, and low test results nobody has reviewed. */
export async function leaderReviewCounts(ctx: TenantContext): Promise<{ readyUnits: number; lowUnreviewed: number }> {
  assertCan(ctx, "academics", "VIEW");
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) return { readyUnits: 0, lowUnreviewed: 0 };
  const [readyUnits, threshold, papers] = await Promise.all([
    ctx.db.academicReview.count({ where: { academicSessionId: session.id, kind: "UNIT_READY", status: "OPEN" } }),
    academicThreshold(ctx),
    ctx.db.assessment.findMany({
      where: { academicSessionId: session.id, reviewsRaised: { none: { kind: "LOW_PERFORMANCE" } }, AND: [VISIBLE_PAPER] } satisfies Prisma.AssessmentWhereInput,
      select: { maxMarks: true, results: { where: { marksObtained: { not: null }, absent: false, exempt: false }, select: { marksObtained: true } } },
    }),
  ]);
  const lowUnreviewed = papers.filter((paper) => paper.results.length && paper.maxMarks > 0 && (paper.results.reduce((sum, row) => sum + row.marksObtained!, 0) / paper.results.length / paper.maxMarks) * 100 < threshold).length;
  return { readyUnits, lowUnreviewed };
}
