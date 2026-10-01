/**
 * Setup progress, the notification center, global search, CSV import preview,
 * teacher import, the school data export and the new report exports — each
 * checked for what it shows and for staying inside its own school.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { today } from "@/lib/dates";
import { markAlertsRead, notificationCenter } from "@/server/alerts/center";
import { setSetupStepSkipped, setupReport } from "@/server/academics/setup";
import { prisma } from "@/server/db/prisma";
import { exportSchoolData } from "@/server/export/school-data";
import { importStudents } from "@/server/people/bulk-students";
import { importTeachers } from "@/server/people/teacher-import";
import { feePaymentsTable, substituteClassesTable } from "@/server/reports/exports";
import { searchSchool } from "@/server/search/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("school setup", () => {
  it("works progress out from the data, and only optional steps can be skipped", async () => {
    const admin = adminOf(schoolA);
    const report = await setupReport(admin);
    const state = Object.fromEntries(report.steps.map((step) => [step.key, step.state]));
    expect(state).toMatchObject({ session: "done", classes: "done", teachers: "done", students: "done", timetable: "todo", fees: "todo" });
    // Section B of the fixture is empty, so it does not need a class teacher yet; A has one.
    expect(report.steps.find((step) => step.key === "classTeachers")?.state).toBe("done");
    expect(report.complete).toBe(false);

    await setSetupStepSkipped(admin, "timetable", true);
    await setSetupStepSkipped(admin, "students", true); // required: ignored
    const after = await setupReport(admin);
    expect(after.steps.find((step) => step.key === "timetable")?.state).toBe("skipped");
    expect(after.steps.find((step) => step.key === "students")?.state).toBe("done");
    expect(after.percent).toBeGreaterThan(report.percent);
    // The skip belongs to school A only.
    expect((await setupReport(adminOf(schoolB))).steps.find((step) => step.key === "timetable")?.state).toBe("todo");
    await expect(setupReport(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("notification center", () => {
  it("counts unread, marks one or all read, and keeps read state per person", async () => {
    const parent = contextFor(schoolA, schoolA.parentUserId, "PARENT");
    // A notice gives everyone at least one alert.
    await prisma.notice.create({
      data: { schoolId: schoolA.schoolId, title: "Sports day", body: "Friday.", status: "PUBLISHED", audience: "ALL", authorId: schoolA.adminUserId },
    });
    const first = await notificationCenter(parent);
    expect(first.unread).toBeGreaterThan(0);
    const one = first.alerts[0]!;
    await markAlertsRead(parent, { keys: [one.key] });
    const second = await notificationCenter(parent);
    expect(second.alerts.find((alert) => alert.key === one.key)?.read).toBe(true);
    expect(second.unread).toBe(first.unread - 1);

    await markAlertsRead(parent, { all: true });
    expect((await notificationCenter(parent)).unread).toBe(0);
    // The teacher's own read state is untouched.
    expect((await notificationCenter(teacherOf(schoolA))).unread).toBeGreaterThan(0);
    // A key from someone else's feed is ignored rather than stored.
    await markAlertsRead(parent, { keys: ["not-a-real-key"] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: schoolA.parentUserId } })).readAlertKeys).not.toContain("not-a-real-key");
  });

  it("gives the School Admin their own to-do alerts", async () => {
    await prisma.leaveRequest.create({
      data: { schoolId: schoolA.schoolId, teacherId: schoolA.teacherId, type: "SICK", startDate: today(), endDate: today(), reason: "Fever" },
    });
    const { alerts } = await notificationCenter(adminOf(schoolA));
    expect(alerts.some((alert) => alert.kind === "leave")).toBe(true);
    expect((await notificationCenter(adminOf(schoolB))).alerts.some((alert) => alert.kind === "leave")).toBe(false);
  });
});

describe("global search", () => {
  it("finds the school's own people and classes, and nothing of another school", async () => {
    const hits = await searchSchool(adminOf(schoolA), "Aarav");
    expect(hits.some((hit) => hit.group === "students" && hit.title.startsWith("Aarav"))).toBe(true);
    expect(await searchSchool(adminOf(schoolB), "Aarav")).toEqual([]);
    const sections = await searchSchool(adminOf(schoolA), "10-A");
    expect(sections.some((hit) => hit.group === "classes" && hit.id === schoolA.sectionId)).toBe(true);
    expect(await searchSchool(adminOf(schoolA), "a")).toEqual([]);
  });

  it("limits a teacher to the sections they teach", async () => {
    const own = await searchSchool(teacherOf(schoolA), "Ananya");
    expect(own.every((hit) => hit.href.startsWith("/teacher/"))).toBe(true);
    expect(own.some((hit) => hit.group === "students")).toBe(true);
    // Teachers never get teacher, parent or staff results.
    expect((await searchSchool(teacherOf(schoolA), "Fixture")).some((hit) => hit.group !== "students" && hit.group !== "classes")).toBe(false);
    await expect(searchSchool(contextFor(schoolA, schoolA.parentUserId, "PARENT"), "Aarav")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("CSV import preview", () => {
  const header = "Admission no.,First name,Last name,Gender,Date of birth,Class,Section,Roll no.,Guardian first name,Guardian last name,Guardian phone,Guardian email,Relationship";

  it("checks without writing, then imports only the valid rows", async () => {
    const csv = [
      header,
      "P1,Kiran,Rao,Girl,2014-02-01,Class 10,A,60,Sunil,Rao,9811100001,,Father",
      "ADM1,Taken,Number,Boy,2014-02-01,Class 10,A,,Kiran,Das,9822200002,,Mother", // admission no. exists
      "P3,Meena,Joshi,,2014-02-01,Class 10,B,,,,+91 90000 00001,,Guardian", // known guardian, no gender: warnings
    ].join("\n");
    const before = await prisma.student.count({ where: { schoolId: schoolA.schoolId } });

    const check = await importStudents(adminOf(schoolA), csv, { mode: "check" });
    expect(check).toMatchObject({ total: 3, valid: 2, created: 0 });
    expect(check.errors.map((error) => error.line)).toEqual([3]);
    expect(check.warnings.length).toBeGreaterThanOrEqual(2);
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);

    // Strict import refuses the file; valid-only imports the two good rows.
    expect((await importStudents(adminOf(schoolA), csv)).created).toBe(0);
    const imported = await importStudents(adminOf(schoolA), csv, { mode: "import", validOnly: true });
    expect(imported.created).toBe(2);
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId } })).toBe(before + 2);
  });

  it("imports teachers with logins, refusing an email already in use", async () => {
    const csv = ["Employee ID,First name,Last name,Email,Phone,Gender,Qualification,Designation,Joining date", ",Anita,Verma,anita.verma@iso-test-a.test,,Female,,,", ",Dup,Email,teacher@iso-test-a.test,,,,,"].join("\n");
    const check = await importTeachers(adminOf(schoolA), csv, { mode: "check" });
    expect(check).toMatchObject({ valid: 1, created: 0 });
    expect(check.errors[0]?.message).toMatch(/already has a SchoolOS login/);
    const done = await importTeachers(adminOf(schoolA), csv, { mode: "import", validOnly: true });
    expect(done.created).toBe(1);
    // No password comes back: the teacher activates the login from the email.
    expect(done.invites[0]).toMatchObject({ email: "anita.verma@iso-test-a.test", delivered: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "anita.verma@iso-test-a.test" }, include: { teacher: true } });
    expect(user).toMatchObject({ role: "TEACHER", schoolId: schoolA.schoolId, activatedAt: null });
    await expect(importTeachers(teacherOf(schoolA), csv)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("school data export", () => {
  it("contains only this school's rows and no credentials", async () => {
    const data = await exportSchoolData(adminOf(schoolA));
    const text = JSON.stringify(data);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("not-a-real-hash");
    expect(data.tables).not.toHaveProperty("ApiToken");
    const students = data.tables.Student as Array<{ id: string; schoolId: string }>;
    expect(students.every((row) => row.schoolId === schoolA.schoolId)).toBe(true);
    expect(students.some((row) => schoolB.studentIds.includes(row.id))).toBe(false);
    await expect(exportSchoolData(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("report exports", () => {
  it("read from the source rows, inside the school", async () => {
    const from = today();
    const payments = await feePaymentsTable(adminOf(schoolA), from, from);
    expect(payments.head).toContain("Status");
    const subs = await substituteClassesTable(adminOf(schoolB), from, from);
    expect(subs.rows).toEqual([]);
    await expect(feePaymentsTable(teacherOf(schoolA), from, from)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
