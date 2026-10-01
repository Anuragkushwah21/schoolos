import "server-only";

import type { Route } from "next";

import { CURRENT_EMPLOYEE, CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/**
 * How far a school — or one academic session — is from ready to run.
 *
 * Every step is worked out from the school's own data on each request, so it
 * can never disagree with what is actually set up: adding the last section
 * ticks "Sections" without anyone ticking it. The only thing stored is which
 * optional steps the School Admin chose to skip (`School.setupSkipped`).
 *
 * The same list serves a brand-new school on its dashboard and a new session
 * after promotion ("2026–27: 8 sections have no class teacher").
 */

export const SETUP_STEPS = [
  "profile",
  "session",
  "classes",
  "sections",
  "subjects",
  "teachers",
  "students",
  "classTeachers",
  "subjectTeachers",
  "timetable",
  "fees",
] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number];

/** Steps a school may leave for later. The rest are what everything else needs. */
export const OPTIONAL_STEPS: readonly SetupStepKey[] = ["profile", "classTeachers", "subjectTeachers", "timetable", "fees"];

export type SetupStep = {
  key: SetupStepKey;
  state: "done" | "todo" | "skipped";
  optional: boolean;
  /** Numbers for the one-line summary, e.g. `{ missing: 8, total: 12 }`. */
  counts: Record<string, number>;
  href: Route;
};

export type SetupReport = {
  session: { id: string; name: string; isCurrent: boolean } | null;
  steps: SetupStep[];
  /** 0–100: done and skipped steps over all steps. */
  percent: number;
  /** Every required step done, and each optional one done or skipped. */
  complete: boolean;
  next: SetupStep | null;
};

export async function setupReport(ctx: TenantContext, options: { sessionId?: string } = {}): Promise<SetupReport> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const [school, session] = await Promise.all([
    prisma.school.findUnique({
      where: { id: ctx.schoolId },
      select: { phone: true, addressLine: true, email: true, setupSkipped: true },
    }),
    options.sessionId
      ? ctx.db.academicSession.findFirst({ where: { id: options.sessionId }, select: { id: true, name: true, isCurrent: true } })
      : ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, name: true, isCurrent: true } }),
  ]);
  const skipped = new Set(school?.setupSkipped ?? []);

  const sessionId = session?.id ?? null;
  const [classes, sections, subjects, teachers, students, parents, feeHeads, charges] = await Promise.all([
    ctx.db.class.findMany({
      where: { isActive: true },
      select: { id: true, _count: sessionId ? { select: { sections: { where: { academicSessionId: sessionId } } } } : undefined },
    }),
    sessionId
      ? ctx.db.section.findMany({
          where: { academicSessionId: sessionId },
          select: {
            id: true,
            classTeacherId: true,
            _count: { select: { teacherAssignments: true, timetableSlots: true, enrollments: { where: { status: "ACTIVE" } } } },
          },
        })
      : Promise.resolve([]),
    ctx.db.subject.count({ where: { isActive: true } }),
    ctx.db.teacher.count({ where: { status: { in: [...CURRENT_EMPLOYEE] } } }),
    sessionId
      ? ctx.db.studentEnrollment.count({ where: { academicSessionId: sessionId, status: "ACTIVE" } })
      : ctx.db.student.count({ where: { status: { in: [...CURRENT_STUDENT] } } }),
    ctx.db.parent.count(),
    ctx.db.feeHead.count({ where: { isActive: true } }),
    sessionId ? ctx.db.feeCharge.count({ where: { academicSessionId: sessionId } }) : Promise.resolve(0),
  ]);

  const withoutSection = classes.filter((klass) => !(klass._count as { sections?: number } | undefined)?.sections).length;
  // A section with nobody in it does not need a teacher yet.
  const running = sections.filter((section) => section._count.enrollments > 0);
  const noClassTeacher = running.filter((section) => !section.classTeacherId).length;
  const noSubjectTeacher = running.filter((section) => section._count.teacherAssignments === 0).length;
  const noTimetable = running.filter((section) => section._count.timetableSlots === 0).length;

  // Pages that can show another session are sent to this one.
  const forSession = session && !session.isCurrent ? `?session=${session.id}` : "";
  const step = (key: SetupStepKey, done: boolean, counts: Record<string, number>, href: Route): SetupStep => {
    const optional = OPTIONAL_STEPS.includes(key);
    return { key, optional, counts, href, state: done ? "done" : optional && skipped.has(key) ? "skipped" : "todo" };
  };

  const steps: SetupStep[] = [
    step("profile", Boolean(school?.phone && school.addressLine), {}, "/school-admin/website"),
    step("session", Boolean(session), {}, "/school-admin/academics"),
    step("classes", classes.length > 0, { total: classes.length }, "/school-admin/academics/classes"),
    step("sections", sections.length > 0 && withoutSection === 0, { total: sections.length, missing: withoutSection }, `/school-admin/academics/classes${forSession}` as Route),
    step("subjects", subjects > 0, { total: subjects }, "/school-admin/academics"),
    step("teachers", teachers > 0, { total: teachers }, "/school-admin/teachers/new"),
    step("students", students > 0, { total: students, parents }, "/school-admin/students/new"),
    step("classTeachers", running.length > 0 && noClassTeacher === 0, { missing: noClassTeacher, total: running.length }, `/school-admin/academics/class-teachers${forSession}` as Route),
    step("subjectTeachers", running.length > 0 && noSubjectTeacher === 0, { missing: noSubjectTeacher, total: running.length }, "/school-admin/teachers"),
    step("timetable", running.length > 0 && noTimetable === 0, { missing: noTimetable, total: running.length }, "/school-admin/timetable"),
    step("fees", feeHeads > 0 && charges > 0, { heads: feeHeads, charges }, "/school-admin/finance/fees"),
  ];

  const settled = steps.filter((s) => s.state !== "todo").length;
  const requiredDone = steps.every((s) => s.optional || s.state === "done");
  return {
    session,
    steps,
    percent: Math.round((settled / steps.length) * 100),
    complete: requiredDone && settled === steps.length,
    // Required steps first, in order: nothing optional is suggested while
    // something the school cannot run without is still missing.
    next: steps.find((s) => !s.optional && s.state === "todo") ?? steps.find((s) => s.state === "todo") ?? null,
  };
}

/** Skip an optional step for now, or bring it back. Required steps cannot be skipped. */
export async function setSetupStepSkipped(ctx: TenantContext, key: SetupStepKey, skip: boolean): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (!OPTIONAL_STEPS.includes(key)) return;
  const school = await prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { setupSkipped: true } });
  const next = new Set(school.setupSkipped);
  if (skip) next.add(key);
  else next.delete(key);
  await prisma.school.update({ where: { id: ctx.schoolId }, data: { setupSkipped: [...next] } });
  await recordAudit({
    action: "SCHOOL_SETUP_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Setup step "${key}" ${skip ? "skipped for now" : "brought back"}.`,
  });
}
