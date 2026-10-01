import "server-only";

import type { Route } from "next";

import { fullName } from "@/lib/format";
import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { staffPermissions } from "@/server/auth/staff-access";

/**
 * One search box across the school's people and classes.
 *
 * What comes back depends on who asks, and is decided here — never by the
 * browser:
 *   * School Admin: students, teachers, parents, staff, classes & sections;
 *   * Teacher: students in the sections they teach or lead, and those sections;
 *   * Staff with "View students": students (directory only).
 * Everything is read through `ctx.db`, so another school's records cannot
 * appear whatever is typed.
 */

export type SearchGroup = "students" | "teachers" | "parents" | "staff" | "classes";
export type SearchHit = { group: SearchGroup; id: string; title: string; subtitle: string | null; href: Route };

const PER_GROUP = 5;
export const SEARCH_MIN_LENGTH = 2;

const like = (q: string) => ({ contains: q, mode: "insensitive" as const });

function nameWhere(q: string) {
  // "Rahul Sharma" matches first + last name as well as either on its own.
  const [first, ...rest] = q.split(/\s+/);
  const last = rest.join(" ");
  return {
    OR: [
      { firstName: like(q) },
      { lastName: like(q) },
      ...(first && last ? [{ AND: [{ firstName: like(first) }, { lastName: like(last) }] }] : []),
    ],
  };
}

export async function searchSchool(ctx: TenantContext, raw: string): Promise<SearchHit[]> {
  assertRole(ctx.user, "SCHOOL_ADMIN", "TEACHER", "NON_TEACHING_STAFF");
  const q = raw.trim().slice(0, 60);
  if (q.length < SEARCH_MIN_LENGTH) return [];

  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });

  if (ctx.user.role === "SCHOOL_ADMIN") return adminSearch(ctx, q, session?.id ?? null);
  if (ctx.user.role === "TEACHER") return teacherSearch(ctx, q, session?.id ?? null);
  // Non-teaching staff: only with the student directory granted.
  if (!(await staffPermissions(ctx)).includes("VIEW_STUDENTS")) return [];
  const students = await findStudents(ctx, q, session?.id ?? null, undefined);
  return students.map((row) => ({ ...row, href: `/staff/students?q=${encodeURIComponent(row.title)}` as Route }));
}

async function findStudents(ctx: TenantContext, q: string, sessionId: string | null, sectionIds: string[] | undefined) {
  const rows = await ctx.db.student.findMany({
    where: {
      status: { in: [...CURRENT_STUDENT] },
      OR: [nameWhere(q), { admissionNumber: like(q) }],
      ...(sectionIds ? { enrollments: { some: { academicSessionId: sessionId ?? "__none__", sectionId: { in: sectionIds } } } } : {}),
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: PER_GROUP,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNumber: true,
      enrollments: {
        where: { academicSessionId: sessionId ?? "__none__" },
        take: 1,
        select: { section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
      },
    },
  });
  return rows.map((row) => ({
    group: "students" as const,
    id: row.id,
    title: fullName(row),
    subtitle: [row.enrollments[0] ? sectionLabel(row.enrollments[0].section) : null, row.admissionNumber].filter(Boolean).join(" · "),
  }));
}

async function findSections(ctx: TenantContext, q: string, sessionId: string | null, onlyIds?: string[]) {
  if (!sessionId) return [];
  // "8-A", "Class 8 A" or "8" all find Class 8 – A.
  const [classPart, sectionPart] = q.replace(/^class\s*/i, "").split(/[\s\-–]+/);
  const rows = await ctx.db.section.findMany({
    where: {
      academicSessionId: sessionId,
      ...(onlyIds ? { id: { in: onlyIds } } : {}),
      class: { name: like(classPart ?? q) },
      ...(sectionPart ? { name: { equals: sectionPart.toUpperCase() } } : {}),
    },
    take: PER_GROUP,
    select: {
      id: true,
      name: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
      classTeacher: { select: { firstName: true, lastName: true } },
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });
  return rows
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((row) => ({
      group: "classes" as const,
      id: row.id,
      title: sectionLabel(row),
      subtitle: [`${row._count.enrollments} students`, row.classTeacher ? fullName(row.classTeacher) : null].filter(Boolean).join(" · "),
    }));
}

async function adminSearch(ctx: TenantContext, q: string, sessionId: string | null): Promise<SearchHit[]> {
  const [students, teachers, parents, staff, sections] = await Promise.all([
    findStudents(ctx, q, sessionId, undefined),
    ctx.db.teacher.findMany({
      where: { OR: [nameWhere(q), { employeeId: like(q) }] },
      take: PER_GROUP,
      orderBy: [{ firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        assignments: { where: { academicSessionId: sessionId ?? "__none__" }, select: { subject: { select: { name: true } } }, take: 3 },
      },
    }),
    ctx.db.parent.findMany({
      where: { OR: [nameWhere(q), { phone: like(q.replace(/\s/g, "")) }] },
      take: PER_GROUP,
      orderBy: [{ firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, phone: true, _count: { select: { children: true } } },
    }),
    ctx.db.staffMember.findMany({
      where: { OR: [nameWhere(q), { employeeId: like(q) }] },
      take: PER_GROUP,
      orderBy: [{ firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, role: true, designation: true },
    }),
    findSections(ctx, q, sessionId),
  ]);

  return [
    ...students.map((row) => ({ ...row, href: `/school-admin/students/${row.id}` as Route })),
    ...teachers.map((row) => ({
      group: "teachers" as const,
      id: row.id,
      title: fullName(row),
      subtitle: [...new Set((row.assignments ?? []).map((a) => a.subject.name))].join(", ") || row.employeeId,
      href: `/school-admin/teachers/${row.id}` as Route,
    })),
    ...parents.map((row) => ({
      group: "parents" as const,
      id: row.id,
      title: fullName(row),
      subtitle: `${row.phone} · ${row._count.children} child${row._count.children === 1 ? "" : "ren"}`,
      href: `/school-admin/parents/${row.id}` as Route,
    })),
    ...staff.map((row) => ({
      group: "staff" as const,
      id: row.id,
      title: fullName(row),
      subtitle: row.designation ?? row.role.replace(/_/g, " ").toLowerCase(),
      href: `/school-admin/staff/${row.id}` as Route,
    })),
    ...sections.map((row) => ({ ...row, href: `/school-admin/academics/sections/${row.id}` as Route })),
  ];
}

async function teacherSearch(ctx: TenantContext, q: string, sessionId: string | null): Promise<SearchHit[]> {
  const teacher = await ctx.db.teacher.findFirst({ where: { userId: ctx.user.id }, select: { id: true } });
  if (!teacher || !sessionId) return [];
  // Only the sections this teacher teaches or leads — the same rule as the register.
  const [assigned, led] = await Promise.all([
    ctx.db.teacherSubjectAssignment.findMany({ where: { teacherId: teacher.id, academicSessionId: sessionId }, select: { sectionId: true } }),
    ctx.db.section.findMany({ where: { classTeacherId: teacher.id, academicSessionId: sessionId }, select: { id: true } }),
  ]);
  const sectionIds = [...new Set([...assigned.map((row) => row.sectionId), ...led.map((row) => row.id)])];
  if (!sectionIds.length) return [];
  const [students, sections] = await Promise.all([findStudents(ctx, q, sessionId, sectionIds), findSections(ctx, q, sessionId, sectionIds)]);
  return [
    ...students.map((row) => ({ ...row, href: `/teacher/students/${row.id}` as Route })),
    ...sections.map((row) => ({ ...row, href: `/teacher/classes/${row.id}` as Route })),
  ];
}
