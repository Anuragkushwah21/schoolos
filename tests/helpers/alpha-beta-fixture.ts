/**
 * The tenant-audit fixture: two schools whose every record says which school
 * it belongs to.
 *
 *   Alpha Public School — A-Teacher-1, A-Teacher-2, A-Student-1..3
 *   Beta Public School  — B-Teacher-1, B-Teacher-2, B-Student-1..3
 *
 * Both schools are built identically (session, class, section, subject,
 * assignments, a timetable period, a register, fees, an expense, a salary
 * payment, homework, a notice, a parent), so every comparison is like for like
 * and any "A" appearing on a "B" screen is unmistakable.
 */
import { addDays, dayOfWeek, today } from "@/lib/dates";
import { prisma } from "@/server/db/prisma";

export type AuditSchool = {
  key: "A" | "B";
  name: string;
  schoolId: string;
  adminUserId: string;
  academicSessionId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherIds: string[];
  studentIds: string[];
  parentId: string;
  slotId: string;
  homeworkId: string;
  noticeId: string;
  expenseId: string;
  paymentId: string;
  admissionId: string;
};

const PREFIX = "tenant-audit-";
const MARKED_ON = addDays(today(), -2);

async function buildSchool(key: "A" | "B", name: string): Promise<AuditSchool> {
  const tag = key.toLowerCase();
  const school = await prisma.school.create({
    data: {
      slug: `${PREFIX}${tag}`,
      name,
      status: "ACTIVE",
      city: key === "A" ? "Alphaville" : "Betatown",
      contactName: `${key}-Owner`,
      contactEmail: `owner@${PREFIX}${tag}.test`,
      contactPhone: "+91-90000-00000",
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: `admin@${PREFIX}${tag}.test`,
      passwordHash: "not-a-real-hash",
      role: "SCHOOL_ADMIN",
      firstName: `${key}-Admin`,
      lastName: "User",
      schoolId: school.id,
    },
  });

  const session = await prisma.academicSession.create({
    data: {
      schoolId: school.id,
      name: "2026-27",
      startDate: new Date(Date.UTC(2026, 3, 1)),
      endDate: new Date(Date.UTC(2027, 2, 31)),
      isCurrent: true,
    },
  });
  const klass = await prisma.class.create({
    data: { schoolId: school.id, name: `${key}-Class-10`, level: 10 },
  });
  const section = await prisma.section.create({
    data: { schoolId: school.id, academicSessionId: session.id, classId: klass.id, name: `${key}-Section` },
  });
  const subject = await prisma.subject.create({
    data: { schoolId: school.id, name: `${key}-Mathematics`, code: `${key}MATH` },
  });

  const teacherIds: string[] = [];
  for (const n of [1, 2]) {
    const user = await prisma.user.create({
      data: {
        email: `teacher${n}@${PREFIX}${tag}.test`,
        passwordHash: "not-a-real-hash",
        role: "TEACHER",
        firstName: `${key}-Teacher-${n}`,
        lastName: "Staff",
        schoolId: school.id,
      },
    });
    const teacher = await prisma.teacher.create({
      data: {
        schoolId: school.id,
        userId: user.id,
        employeeId: `${key}-EMP-${n}`,
        firstName: `${key}-Teacher-${n}`,
        lastName: "Staff",
      },
    });
    teacherIds.push(teacher.id);
  }
  await prisma.teacherSubjectAssignment.create({
    data: {
      schoolId: school.id,
      academicSessionId: session.id,
      teacherId: teacherIds[0]!,
      subjectId: subject.id,
      sectionId: section.id,
    },
  });

  const parentUser = await prisma.user.create({
    data: {
      email: `parent@${PREFIX}${tag}.test`,
      passwordHash: "not-a-real-hash",
      role: "PARENT",
      firstName: `${key}-Parent`,
      lastName: "Guardian",
      schoolId: school.id,
    },
  });
  const parent = await prisma.parent.create({
    data: {
      schoolId: school.id,
      userId: parentUser.id,
      firstName: `${key}-Parent`,
      lastName: "Guardian",
      phone: "+91-90000-00001",
    },
  });

  const studentIds: string[] = [];
  for (const n of [1, 2, 3]) {
    const student = await prisma.student.create({
      data: {
        schoolId: school.id,
        admissionNumber: `${key}-ADM-${n}`,
        firstName: `${key}-Student-${n}`,
        lastName: "Pupil",
        gender: n % 2 ? "MALE" : "FEMALE",
      },
    });
    studentIds.push(student.id);
    await prisma.studentEnrollment.create({
      data: {
        schoolId: school.id,
        studentId: student.id,
        academicSessionId: session.id,
        classId: klass.id,
        sectionId: section.id,
        rollNumber: String(n),
      },
    });
    await prisma.parentStudent.create({
      data: { schoolId: school.id, parentId: parent.id, studentId: student.id, relationship: "GUARDIAN", isPrimary: n === 1 },
    });
    await prisma.studentAttendance.create({
      data: {
        schoolId: school.id,
        academicSessionId: session.id,
        sectionId: section.id,
        studentId: student.id,
        date: MARKED_ON,
        status: n === 3 ? "ABSENT" : "PRESENT",
        markedByUserId: admin.id,
      },
    });
  }

  const slot = await prisma.timetableSlot.create({
    data: {
      schoolId: school.id,
      academicSessionId: session.id,
      sectionId: section.id,
      subjectId: subject.id,
      teacherId: teacherIds[0]!,
      dayOfWeek: dayOfWeek(today()) === "SUNDAY" ? "MONDAY" : dayOfWeek(today()),
      startMinute: 540,
      endMinute: 585,
    },
  });

  const head = await prisma.feeHead.create({ data: { schoolId: school.id, name: `${key}-Tuition` } });
  await prisma.feeCharge.create({
    data: {
      schoolId: school.id,
      academicSessionId: session.id,
      studentId: studentIds[0]!,
      feeHeadId: head.id,
      amountMinor: 30_000_00,
      dueOn: addDays(today(), 30),
    },
  });
  const payment = await prisma.feePayment.create({
    data: {
      schoolId: school.id,
      academicSessionId: session.id,
      studentId: studentIds[0]!,
      // Different amounts per school, so a combined total is recognisable.
      amountMinor: key === "A" ? 10_000_00 : 7_000_00,
      paidOn: today(),
      receiptNo: `${key}-R-1`,
    },
  });
  const expense = await prisma.expense.create({
    data: {
      schoolId: school.id,
      category: "STATIONERY",
      description: `${key}-Expense`,
      amountMinor: key === "A" ? 1_000_00 : 2_000_00,
      spentOn: today(),
    },
  });
  await prisma.salaryPayment.create({
    data: {
      schoolId: school.id,
      teacherId: teacherIds[0]!,
      amountMinor: key === "A" ? 25_000_00 : 30_000_00,
      paidOn: today(),
      forMonth: new Date(Date.UTC(today().getUTCFullYear(), today().getUTCMonth(), 1)),
    },
  });
  const homework = await prisma.homework.create({
    data: {
      schoolId: school.id,
      academicSessionId: session.id,
      sectionId: section.id,
      subjectId: subject.id,
      teacherId: teacherIds[0]!,
      title: `${key}-Homework`,
      assignedOn: today(),
      dueOn: addDays(today(), 2),
    },
  });
  const notice = await prisma.notice.create({
    data: {
      schoolId: school.id,
      title: `${key}-Notice`,
      body: "Audit notice",
      audience: "ALL",
      status: "PUBLISHED",
      authorId: admin.id,
      publishAt: addDays(today(), -1),
    },
  });
  const admission = await prisma.admissionApplication.create({
    data: {
      schoolId: school.id,
      academicSessionId: session.id,
      applicationNumber: `${key}-APP-1`,
      studentFirstName: `${key}-Applicant`,
      studentLastName: "Hopeful",
      requestedClassId: klass.id,
      parentName: `${key}-Applicant-Parent`,
      parentPhone: "+91-90000-00002",
    },
  });

  return {
    key,
    name,
    schoolId: school.id,
    adminUserId: admin.id,
    academicSessionId: session.id,
    classId: klass.id,
    sectionId: section.id,
    subjectId: subject.id,
    teacherIds,
    studentIds,
    parentId: parent.id,
    slotId: slot.id,
    homeworkId: homework.id,
    noticeId: notice.id,
    expenseId: expense.id,
    paymentId: payment.id,
    admissionId: admission.id,
  };
}

export async function createAlphaBetaFixture() {
  await destroyAlphaBetaFixture();
  const alpha = await buildSchool("A", "Alpha Public School");
  const beta = await buildSchool("B", "Beta Public School");
  return { alpha, beta };
}

export async function destroyAlphaBetaFixture() {
  await prisma.school.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
