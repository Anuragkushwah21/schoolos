/**
 * Salaries, fees and the family behind a student.
 *
 * Three things under test. That the arithmetic is right — charged minus paid,
 * with an overpayment reading as paid rather than as a credit. That a parent sees
 * exactly their own children's fees and nothing else. And that salary, the most
 * sensitive figure in the application, is reachable only by the office and by the
 * teacher it belongs to.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, today } from "@/lib/dates";
import { prisma } from "@/server/db/prisma";
import { createSection, updateSection, classTeacherHistory } from "@/server/academics/structure";
import { assignSubject, createTeacher, unassignSubject } from "@/server/people/teachers";
import { createStudent, linkGuardian } from "@/server/people/students";
import { getParentWithChildren, listParents, parentOptions } from "@/server/people/parents";
import {
  chargeSection,
  chargeStudent,
  createFeeHead,
  getStudentFees,
  listFeePositions,
  recordPayment,
  removePayment,
  summarise,
} from "@/server/finance/fees";
import { getMySalary, getTeacherSalary, listSalaries, setSalary } from "@/server/finance/salary";
import { createStudentSchema } from "@/lib/validation/school";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

let tuitionId: string;
let examId: string;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const admin = adminOf(schoolA);

  tuitionId = (await createFeeHead(admin, { name: "Tuition fee", note: "Per year" })).id;
  examId = (await createFeeHead(admin, { name: "Examination fee", note: null })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the fee arithmetic", () => {
  it("adds up charges and payments, and never shows a negative balance", () => {
    const charges = [
      { amountMinor: 2_000_000, dueOn: today() },
      { amountMinor: 300_000, dueOn: addDays(today(), 30) },
    ];

    expect(summarise(charges, [])).toMatchObject({
      chargedMinor: 2_300_000,
      paidMinor: 0,
      pendingMinor: 2_300_000,
      status: "PENDING",
    });

    expect(summarise(charges, [{ amountMinor: 1_000_000 }])).toMatchObject({
      paidMinor: 1_000_000,
      pendingMinor: 1_300_000,
      status: "PARTIAL",
    });

    expect(summarise(charges, [{ amountMinor: 2_300_000 }])).toMatchObject({
      pendingMinor: 0,
      status: "PAID",
      // Nothing is owed, so nothing is due — the date is not the last charge's.
      dueOn: null,
    });

    // An overpayment reads as paid in full rather than as a negative balance,
    // because a credit is a different product decision than this one.
    expect(summarise(charges, [{ amountMinor: 9_999_999 }])).toMatchObject({
      pendingMinor: 0,
      status: "PAID",
    });

    expect(summarise([], [])).toMatchObject({ status: "NONE", pendingMinor: 0 });
  });

  it("calls a charge overdue only once its date has passed", () => {
    const past = summarise([{ amountMinor: 100, dueOn: addDays(today(), -1) }], []);
    const future = summarise([{ amountMinor: 100, dueOn: addDays(today(), 1) }], []);
    expect(past.overdue).toBe(true);
    expect(future.overdue).toBe(false);
  });
});

describe("charging and collecting", () => {
  it("charges a whole class, one row per child", async () => {
    const admin = adminOf(schoolA);
    const { charged } = await chargeSection(admin, {
      sectionId: schoolA.sectionId,
      feeHeadId: tuitionId,
      amountMinor: 2_000_000,
      dueOn: addDays(today(), 30),
    });
    expect(charged).toBe(schoolA.studentIds.length);

    const account = await getStudentFees(admin, schoolA.studentIds[0]!);
    expect(account.summary.chargedMinor).toBe(2_000_000);
    expect(account.summary.status).toBe("PENDING");
  });

  it("corrects a charge rather than billing the family twice", async () => {
    const admin = adminOf(schoolA);
    await chargeStudent(admin, {
      studentId: schoolA.studentIds[0]!,
      feeHeadId: tuitionId,
      amountMinor: 1_500_000,
      dueOn: addDays(today(), 30),
      notes: "Sibling discount",
    });

    const account = await getStudentFees(admin, schoolA.studentIds[0]!);
    // One tuition row, at the corrected amount — not two.
    expect(account.charges.filter((c) => c.feeHead.name === "Tuition fee")).toHaveLength(1);
    expect(account.summary.chargedMinor).toBe(1_500_000);
  });

  it("records a payment and moves the family to partially paid", async () => {
    const admin = adminOf(schoolA);
    await chargeStudent(admin, {
      studentId: schoolA.studentIds[0]!,
      feeHeadId: examId,
      amountMinor: 300_000,
      dueOn: addDays(today(), 10),
      notes: null,
    });

    await recordPayment(admin, {
      studentId: schoolA.studentIds[0]!,
      amountMinor: 1_000_000,
      paidOn: today(),
      method: "UPI",
      receiptNo: "REC-9001",
      notes: null,
    });

    const account = await getStudentFees(admin, schoolA.studentIds[0]!);
    expect(account.summary).toMatchObject({
      chargedMinor: 1_800_000,
      paidMinor: 1_000_000,
      pendingMinor: 800_000,
      status: "PARTIAL",
    });
    expect(account.payments[0]).toMatchObject({ receiptNo: "REC-9001", method: "UPI" });
  });

  it("refuses a duplicate receipt number and a future payment", async () => {
    const admin = adminOf(schoolA);
    await expect(
      recordPayment(admin, {
        studentId: schoolA.studentIds[1]!,
        amountMinor: 100,
        paidOn: today(),
        method: "CASH",
        receiptNo: "REC-9001",
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      recordPayment(admin, {
        studentId: schoolA.studentIds[1]!,
        amountMinor: 100,
        paidOn: addDays(today(), 1),
        method: "CASH",
        receiptNo: "REC-9002",
        notes: null,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("puts the amount back when a receipt is removed", async () => {
    const admin = adminOf(schoolA);
    const before = await getStudentFees(admin, schoolA.studentIds[0]!);
    const payment = before.payments.find((p) => p.receiptNo === "REC-9001")!;

    await removePayment(admin, payment.id);

    const after = await getStudentFees(admin, schoolA.studentIds[0]!);
    expect(after.summary.paidMinor).toBe(before.summary.paidMinor - payment.amountMinor);
    expect(after.summary.pendingMinor).toBe(before.summary.pendingMinor + payment.amountMinor);
  });

  it("lists the school's position, and filters it by status", async () => {
    const admin = adminOf(schoolA);
    const all = await listFeePositions(admin);
    expect(all.rows.length).toBe(schoolA.studentIds.length);
    // The totals are the sum of the same rows the table shows.
    expect(all.totals?.chargedMinor).toBe(
      all.rows.reduce((sum, row) => sum + row.summary.chargedMinor, 0),
    );
    // Each row carries the parent, because that is who rings up about fees.
    expect(all.rows.every((row) => row.parentName !== null)).toBe(true);

    const pending = await listFeePositions(admin, { status: "PENDING" });
    expect(pending.rows.every((row) => row.summary.status === "PENDING")).toBe(true);
  });

  it("is closed to teachers, parents and students", async () => {
    for (const ctx of [teacherOf(schoolA), parentOf(schoolA), studentOf(schoolA)]) {
      await expect(listFeePositions(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getStudentFees(ctx, schoolA.studentIds[0]!)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        recordPayment(ctx, {
          studentId: schoolA.studentIds[0]!,
          amountMinor: 100,
          paidOn: today(),
          method: "CASH",
          receiptNo: "REC-HACK",
          notes: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createFeeHead(ctx, { name: "Nope", note: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("cannot charge a student in another school", async () => {
    await expect(
      chargeStudent(adminOf(schoolA), {
        studentId: schoolB.studentIds[0]!,
        feeHeadId: tuitionId,
        amountMinor: 100,
        dueOn: today(),
        notes: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps each school's ledger to itself", async () => {
    const a = await listFeePositions(adminOf(schoolA));
    const b = await listFeePositions(adminOf(schoolB));
    const bIds = b.rows.map((row) => row.studentId);
    for (const row of a.rows) expect(bIds).not.toContain(row.studentId);
    // School B has been charged nothing, so its total is its own.
    expect(b.totals?.chargedMinor).toBe(0);
  });
});

describe("what a parent can see of fees", () => {
  it("sees their own child's charges, payments and totals", async () => {
    const { getChildFees } = await import("@/server/parent/child");
    const data = await getChildFees(parentOf(schoolA), schoolA.studentIds[0]!);

    // The same arithmetic the office sees, from the same rows.
    const office = await getStudentFees(adminOf(schoolA), schoolA.studentIds[0]!);
    expect(data.summary).toEqual(office.summary);
    expect(data.charges.map((c) => c.feeHead.name).sort()).toEqual(
      office.charges.map((c) => c.feeHead.name).sort(),
    );
  });

  it("can switch between children and gets different figures", async () => {
    const { getChildFees } = await import("@/server/parent/child");
    // The second child was charged tuition by the class-wide action but has had
    // no payment and no discount, so the two differ.
    const first = await getChildFees(parentOf(schoolA), schoolA.studentIds[0]!);
    const second = await getChildFees(parentOf(schoolA), schoolA.studentIds[1]!);
    expect(first.summary.chargedMinor).not.toBe(second.summary.chargedMinor);
  });

  it("cannot reach a child who is not theirs, in this school or another", async () => {
    const { getChildFees } = await import("@/server/parent/child");
    const stranger = await prisma.student.create({
      data: {
        schoolId: schoolA.schoolId,
        admissionNumber: "ADM6100",
        firstName: "Not",
        lastName: "Theirs",
      },
    });
    await prisma.studentEnrollment.create({
      data: {
        schoolId: schoolA.schoolId,
        studentId: stranger.id,
        academicSessionId: schoolA.academicSessionId,
        classId: schoolA.classId,
        sectionId: schoolA.sectionId,
        rollNumber: "61",
      },
    });

    await expect(getChildFees(parentOf(schoolA), stranger.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getChildFees(parentOf(schoolA), schoolB.studentIds[0]!),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a student see their own fees and nobody else's, once the school allows it", async () => {
    const { getMyFees } = await import("@/server/student/me");
    // Off by default: parents see fees, students do not.
    expect(await getMyFees(studentOf(schoolA))).toBeNull();
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { showFeesToStudents: true } });

    const mine = (await getMyFees(studentOf(schoolA)))!;
    expect(mine.me.student.id).toBe(schoolA.studentIds[0]);

    const office = await getStudentFees(adminOf(schoolA), schoolA.studentIds[0]!);
    expect(mine.summary).toEqual(office.summary);

    // There is no id to change: the read starts from the session.
    await expect(getMyFees(parentOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { showFeesToStudents: false } });
  });
});

describe("teacher salary", () => {
  let teacherId: string;

  beforeAll(async () => {
    const created = await createTeacher(adminOf(schoolA), {
      firstName: "Salaried",
      lastName: "Teacher",
      email: "salaried@finance-test.test",
      gender: null,
      employeeId: null,
      phone: null,
      qualification: null,
      designation: "Senior Teacher",
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
    });
    teacherId = created.teacherId;
  });

  it("creates a teacher without a salary, which stays optional", async () => {
    const salary = await getTeacherSalary(adminOf(schoolA), teacherId);
    expect(salary.current).toBeNull();
    expect(salary.history).toHaveLength(0);

    // And they appear on the salaries screen as work still to do.
    const list = await listSalaries(adminOf(schoolA));
    expect(list.rows.find((row) => row.teacherId === teacherId)?.current).toBeNull();
    expect(list.totals.missing).toBeGreaterThan(0);
  });

  it("records a salary, and a raise keeps the old figure as history", async () => {
    const admin = adminOf(schoolA);
    await setSalary(admin, {
      teacherId,
      salaryType: "MONTHLY",
      amountMinor: 2_500_000,
      allowancesMinor: 200_000,
      deductionsMinor: 100_000,
      effectiveFrom: addDays(today(), -30),
      notes: null,
    });

    const first = await getTeacherSalary(admin, teacherId);
    expect(first.current).toMatchObject({ amountMinor: 2_500_000, netMinor: 2_600_000 });

    await setSalary(admin, {
      teacherId,
      salaryType: "MONTHLY",
      amountMinor: 3_000_000,
      allowancesMinor: 200_000,
      deductionsMinor: 100_000,
      effectiveFrom: today(),
      notes: "Annual review",
    });

    const after = await getTeacherSalary(admin, teacherId);
    expect(after.current?.amountMinor).toBe(3_000_000);
    // The old figure survives the raise.
    expect(after.history).toHaveLength(2);
    expect(after.history.map((row) => row.amountMinor)).toContain(2_500_000);
  });

  it("treats a future date as scheduled rather than current", async () => {
    const admin = adminOf(schoolA);
    await setSalary(admin, {
      teacherId,
      salaryType: "MONTHLY",
      amountMinor: 3_500_000,
      allowancesMinor: 0,
      deductionsMinor: 0,
      effectiveFrom: addDays(today(), 30),
      notes: null,
    });

    const salary = await getTeacherSalary(admin, teacherId);
    // Not yet in effect, so the current figure has not moved.
    expect(salary.current?.amountMinor).toBe(3_000_000);
    const list = await listSalaries(admin);
    expect(list.rows.find((row) => row.teacherId === teacherId)?.scheduled?.amountMinor).toBe(
      3_500_000,
    );
  });

  it("refuses a salary of zero and deductions larger than the pay", async () => {
    const admin = adminOf(schoolA);
    for (const bad of [
      { amountMinor: 0, deductionsMinor: 0 },
      { amountMinor: 100_000, deductionsMinor: 900_000 },
    ]) {
      await expect(
        setSalary(admin, {
          teacherId,
          salaryType: "MONTHLY",
          allowancesMinor: 0,
          effectiveFrom: addDays(today(), 60),
          notes: null,
          ...bad,
        }),
      ).rejects.toBeInstanceOf(AppError);
    }
  });

  it("lets a teacher see their own figure and no colleague's", async () => {
    const own = await getMySalary(teacherOf(schoolA));
    // The fixture's teacher has no salary; the read works and says so.
    expect(own.current).toBeNull();

    // And there is no teacher id to pass, so there is nothing to change.
    await expect(getTeacherSalary(teacherOf(schoolA), teacherId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("is invisible to parents and students entirely", async () => {
    for (const ctx of [parentOf(schoolA), studentOf(schoolA)]) {
      await expect(getTeacherSalary(ctx, teacherId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listSalaries(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getMySalary(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setSalary(ctx, {
          teacherId,
          salaryType: "MONTHLY",
          amountMinor: 9_900_000,
          allowancesMinor: 0,
          deductionsMinor: 0,
          effectiveFrom: today(),
          notes: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("cannot set a salary for another school's teacher", async () => {
    await expect(
      setSalary(adminOf(schoolA), {
        teacherId: schoolB.teacherId,
        salaryType: "MONTHLY",
        amountMinor: 100_000,
        allowancesMinor: 0,
        deductionsMinor: 0,
        effectiveFrom: today(),
        notes: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("assigning teachers to classes and subjects", () => {
  it("assigns, changes and removes a class teacher, keeping the history", async () => {
    const admin = adminOf(schoolA);
    const second = await createTeacher(admin, {
      firstName: "Second",
      lastName: "ClassTeacher",
      email: "second.ct@finance-test.test",
      gender: null,
      employeeId: null,
      phone: null,
      qualification: null,
      designation: null,
      dateOfBirth: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      joiningDate: null,
    });

    // The fixture's teacher is already class teacher, so this is a change.
    await updateSection(admin, schoolA.sectionId, {
      name: "A",
      streamId: null,
      capacity: null,
      classTeacherId: second.teacherId,
    });

    let history = await classTeacherHistory(admin, schoolA.sectionId);
    expect(history[0]).toMatchObject({ teacherId: second.teacherId, current: true });

    // Removing one closes the open row and opens nothing.
    await updateSection(admin, schoolA.sectionId, {
      name: "A",
      streamId: null,
      capacity: null,
      classTeacherId: null,
    });

    history = await classTeacherHistory(admin, schoolA.sectionId);
    expect(history.every((row) => row.current === false)).toBe(true);
    // The change is not destroyed by the removal.
    expect(history.some((row) => row.teacherId === second.teacherId)).toBe(true);

    // And reassigning is allowed at any time — a teacher is not bound to a class.
    await updateSection(admin, schoolA.sectionId, {
      name: "A",
      streamId: null,
      capacity: null,
      classTeacherId: schoolA.teacherId,
    });
    history = await classTeacherHistory(admin, schoolA.sectionId);
    expect(history[0]).toMatchObject({ teacherId: schoolA.teacherId, current: true });
  });

  it("assigns and removes a subject for any class, section and teacher", async () => {
    const admin = adminOf(schoolA);
    const other = await prisma.subject.create({
      data: { schoolId: schoolA.schoolId, name: "Geography", code: "GEO" },
    });
    const section = await createSection(admin, {
      academicSessionId: schoolA.academicSessionId,
      classId: schoolA.classId,
      name: "C",
      streamId: null,
      classTeacherId: null,
      capacity: null,
    }).catch(() => null);

    const sectionId =
      section ??
      (
        await prisma.section.findFirstOrThrow({
          where: { schoolId: schoolA.schoolId, name: "C" },
          select: { id: true },
        })
      ).id;

    await assignSubject(admin, {
      teacherId: schoolA.teacherId,
      subjectId: other.id,
      sectionId: typeof sectionId === "string" ? sectionId : schoolA.sectionId,
    });

    const assignment = await prisma.teacherSubjectAssignment.findFirstOrThrow({
      where: { teacherId: schoolA.teacherId, subjectId: other.id },
      select: { id: true },
    });

    // Removable at any time, which is what keeps assignment flexible.
    await unassignSubject(admin, assignment.id);
    await expect(
      prisma.teacherSubjectAssignment.count({ where: { id: assignment.id } }),
    ).resolves.toBe(0);
  });
});

describe("parents as families", () => {
  it("requires a parent when admitting a student", () => {
    // The schema has no "none": a child cannot be admitted with nobody
    // responsible for them.
    const withoutParent = createStudentSchema.safeParse({
      firstName: "No",
      lastName: "Parent",
      sectionId: schoolA.sectionId,
      guardianMode: "new",
    });
    expect(withoutParent.success).toBe(false);

    const withParent = createStudentSchema.safeParse({
      firstName: "Has",
      lastName: "Parent",
      sectionId: schoolA.sectionId,
      guardianMode: "new",
      parentFirstName: "A",
      parentLastName: "Guardian",
      parentPhone: "+91 90000 00001",
      relationship: "FATHER",
    });
    expect(withParent.success).toBe(true);
  });

  it("links a second and third child to the same parent, not three accounts", async () => {
    const admin = adminOf(schoolA);
    const parentsBefore = await prisma.parent.count({ where: { schoolId: schoolA.schoolId } });

    const sibling = await createStudent(
      admin,
      createStudentSchema.parse({
        firstName: "Second",
        lastName: "Sibling",
        sectionId: schoolA.sectionId,
        guardianMode: "existing",
        existingParentId: schoolA.parentId,
        relationship: "FATHER",
      }),
    );

    await linkGuardian(admin, {
      studentId: sibling,
      guardianMode: "existing",
      existingParentId: schoolA.parentId,
      parentFirstName: null,
      parentLastName: null,
      parentPhone: null,
      parentEmail: null,
      occupation: null,
      relationship: "GUARDIAN",
      isPrimary: false,
    }).catch(() => {
      // Already linked by the admission itself, which is the correct outcome.
    });

    // No new parent row: the family stays one account.
    await expect(prisma.parent.count({ where: { schoolId: schoolA.schoolId } })).resolves.toBe(
      parentsBefore,
    );

    const family = await getParentWithChildren(admin, schoolA.parentId);
    expect(family.childCount).toBeGreaterThan(schoolA.studentIds.length);
    expect(family.children.map((child) => child.id)).toContain(sibling);
  });

  it("shows every child with their class and relationship", async () => {
    const family = await getParentWithChildren(adminOf(schoolA), schoolA.parentId);
    expect(family.name).toBeTruthy();
    expect(family.phone).toBeTruthy();
    for (const child of family.children) {
      expect(child.relationship).toBeTruthy();
      expect(child.sectionLabel).toBeTruthy();
    }
  });

  it("finds a parent by their own details and by a child's", async () => {
    const admin = adminOf(schoolA);
    const family = await getParentWithChildren(admin, schoolA.parentId);

    const byPhone = await listParents(admin, { q: family.phone });
    expect(byPhone.rows.map((row) => row.id)).toContain(schoolA.parentId);

    const child = family.children[0]!;
    const byChild = await listParents(admin, { q: child.name.split(" ")[0]! });
    expect(byChild.rows.map((row) => row.id)).toContain(schoolA.parentId);

    // The picker labels them with the phone and the child count, so two people
    // with the same name can be told apart.
    const options = await parentOptions(admin, family.phone);
    expect(options[0]?.label).toContain(family.phone);
  });

  it("keeps parents inside their own school, and away from other roles", async () => {
    const a = await listParents(adminOf(schoolA));
    const b = await listParents(adminOf(schoolB));
    const bIds = b.rows.map((row) => row.id);
    for (const row of a.rows) expect(bIds).not.toContain(row.id);

    await expect(
      getParentWithChildren(adminOf(schoolA), schoolB.parentId),
    ).rejects.toBeInstanceOf(NotFoundError);

    for (const ctx of [teacherOf(schoolA), parentOf(schoolA), studentOf(schoolA)]) {
      await expect(listParents(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getParentWithChildren(ctx, schoolA.parentId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});
