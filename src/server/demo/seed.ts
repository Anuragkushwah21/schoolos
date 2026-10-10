import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { AttendanceStatus, DayOfWeek, Gender } from "@/generated/prisma/enums";
import { addDays, dayOfWeek, today } from "@/lib/dates";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import { currentAcademicYear } from "@/server/academics/provision";
import { DEFAULT_GRADES, DEFAULT_STREAMS, DEFAULT_SUBJECTS } from "@/server/academics/provision";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/prisma";

import { DEMO_EMAIL_DOMAIN, DEMO_SCHOOL_NAME, DEMO_TTL_MS, type DemoRole } from "./config";

/**
 * One Live Demo sandbox: a complete, fictional "Green Valley Demo School" for
 * one visitor — classes, families, teachers, timetable, a month of attendance,
 * homework, exams (published, and one waiting to be verified), fees with
 * instalments and receipts, notices, a PTM, an event and responsibilities.
 *
 * Every person, receipt and record is invented. Logins use the reserved
 * `.invalid` domain (never deliverable) and random passwords nobody knows:
 * the visitor enters through a server-made session, never a password.
 *
 * Written with `createMany` in one transaction, so a sandbox appears whole or
 * not at all, in a couple of seconds.
 */

const id = () => randomUUID();
const SCHOOL_DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** Deterministic, so every sandbox reads the same. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const TEACHERS = [
  { first: "Anjali", last: "Mehra", subject: "Mathematics" },
  { first: "Rohit", last: "Bansal", subject: "Science" },
  { first: "Sneha", last: "Kapoor", subject: "English" },
  { first: "Vivek", last: "Tiwari", subject: "Social Studies" },
  { first: "Pooja", last: "Saxena", subject: "Hindi" },
  { first: "Karan", last: "Malhotra", subject: "Computer Science" },
];
const SURNAMES = ["Sharma", "Verma", "Gupta", "Yadav", "Chauhan", "Mishra", "Joshi", "Pandey", "Agarwal", "Rathore", "Dubey", "Srivastava"];
const BOYS = ["Aarav", "Vihaan", "Arjun", "Reyansh", "Kabir", "Ishaan", "Dhruv", "Aditya", "Rudra", "Ayaan", "Shaurya", "Krish"];
const GIRLS = ["Ananya", "Diya", "Myra", "Aadhya", "Saanvi", "Kiara", "Ira", "Navya", "Pari", "Riya", "Tara", "Meher"];
const PARENT_FIRST = ["Rakesh", "Sunil", "Manoj", "Deepak", "Ajay", "Sanjay", "Neha", "Kavita", "Ritu", "Pankaj", "Alok", "Shalini"];
/** Two sections each of Class 6, 8 and 10. */
const GRADES = [
  { name: "Class 6", sections: ["A", "B"] },
  { name: "Class 8", sections: ["A", "B"] },
  { name: "Class 10", sections: ["A", "B"] },
];
const PER_SECTION = 6;

export type DemoSandbox = { schoolId: string; expiresAt: Date; users: Record<DemoRole, string> };

export async function createDemoSandbox(now: Date = new Date()): Promise<DemoSandbox> {
  const date0 = today(now);
  const expiresAt = new Date(now.getTime() + DEMO_TTL_MS);
  const tag = randomBytes(5).toString("hex");
  const random = rng(20261009);
  // Nobody knows this password: demo logins are entered through a session only.
  const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
  const email = (who: string) => `${who}.${tag}@${DEMO_EMAIL_DOMAIN}`;
  const year = currentAcademicYear(date0);

  const schoolId = id();
  const sessionId = id();
  const users: Record<DemoRole, string> = { SCHOOL_ADMIN: id(), PRINCIPAL: id(), TEACHER: id(), PARENT: id(), STUDENT: id(), ACCOUNTANT: id() };

  // --- structure ------------------------------------------------------------
  const classIds = new Map(DEFAULT_GRADES.map((grade) => [grade.name, id()]));
  const subjectIds = new Map(DEFAULT_SUBJECTS.map((subject) => [subject.name, id()]));
  const teacherUserIds = TEACHERS.map((_, index) => (index === 0 ? users.TEACHER : id()));
  const teacherIds = TEACHERS.map(() => id());
  const sections = GRADES.flatMap((grade) => grade.sections.map((name) => ({ id: id(), name, grade: grade.name, classId: classIds.get(grade.name)! })));
  // Class teachers: the demo teacher (Anjali Mehra) leads Class 8 A, where the demo family's elder child sits.
  const classTeacherOf = (index: number) => teacherIds[(index + 4) % teacherIds.length]!;

  // --- people ---------------------------------------------------------------
  type Kid = { id: string; first: string; last: string; gender: Gender; sectionId: string; classId: string; roll: number; parentId: string; userId: string | null };
  const parents: Array<{ id: string; userId: string | null; first: string; last: string; phone: string }> = [];
  const kids: Kid[] = [];
  let familyIndex = 0;
  for (const [sectionIndex, section] of sections.entries()) {
    for (let n = 0; n < PER_SECTION; n += 1) {
      const surname = SURNAMES[(sectionIndex * PER_SECTION + n) % SURNAMES.length]!;
      const girl = (sectionIndex + n) % 2 === 0;
      const first = (girl ? GIRLS : BOYS)[(sectionIndex * 2 + n) % 12]!;
      parents.push({ id: id(), userId: null, first: PARENT_FIRST[familyIndex % PARENT_FIRST.length]!, last: surname, phone: `+91 9${String(800000000 + familyIndex * 7919).slice(0, 9)}` });
      const parent = parents[parents.length - 1]!;
      kids.push({ id: id(), first, last: surname, gender: girl ? "FEMALE" : "MALE", sectionId: section.id, classId: section.classId, roll: n + 1, parentId: parent.id, userId: null });
      familyIndex += 1;
    }
  }
  // The demo family: one parent with two children (Class 8 A and Class 6 A); the elder has the student login.
  const class8A = sections.find((row) => row.grade === "Class 8" && row.name === "A")!;
  const class6A = sections.find((row) => row.grade === "Class 6" && row.name === "A")!;
  const elder = kids.find((kid) => kid.sectionId === class8A.id)!;
  const younger = kids.find((kid) => kid.sectionId === class6A.id)!;
  Object.assign(elder, { first: "Ananya", last: "Sharma", gender: "FEMALE", userId: users.STUDENT });
  Object.assign(younger, { first: "Kabir", last: "Sharma", gender: "MALE" });
  const demoParent = parents.find((row) => row.id === elder.parentId)!;
  Object.assign(demoParent, { first: "Rakesh", last: "Sharma", userId: users.PARENT });
  const youngerParentId = younger.parentId;
  younger.parentId = demoParent.id;
  const familyParents = parents.filter((row) => row.id !== youngerParentId);

  const staffId = id();
  const exams = { ut1: "Unit Test 1", hy: "Half-Yearly", ut2: "Unit Test 2" };
  const examSubjects = ["English", "Mathematics", "Science", "Social Studies"];

  await prisma.$transaction(
    async (tx) => {
      await tx.school.create({
        data: {
          id: schoolId,
          slug: `live-demo-${tag}`,
          name: DEMO_SCHOOL_NAME,
          shortName: "Green Valley",
          status: "ACTIVE",
          isDemo: true,
          demoExpiresAt: expiresAt,
          contactName: "Demo Office",
          contactEmail: email("office"),
          contactPhone: "+91 9000000000",
          contactEmailVerifiedAt: now,
          reviewedAt: now,
          about: "A fictional school for the SchoolOS Live Demo. Every person and record here is invented.",
          principalName: "Dr. Neelam Rao",
          establishedYear: 2001,
          affiliationBoard: "CBSE",
          phone: "+91 9000000000",
          addressLine: "12 Sample Road",
          city: "Gwalior",
          state: "Madhya Pradesh",
          postalCode: "474001",
          familyPaymentEnabled: true,
          lateFeeMinor: 100_00,
          lateFeeGraceDays: 7,
          receiptHeaderNote: "DEMO SCHOOL — sample documents with fictional data, not valid for any purpose",
        },
      });
      await tx.organization.create({ data: { name: DEMO_SCHOOL_NAME, ownerId: null, schools: { connect: { id: schoolId } } } });

      await tx.academicSession.create({ data: { id: sessionId, schoolId, name: year.name, startDate: year.startDate, endDate: year.endDate, isCurrent: true } });
      await tx.class.createMany({ data: DEFAULT_GRADES.map((grade) => ({ id: classIds.get(grade.name)!, schoolId, ...grade, isActive: GRADES.some((row) => row.name === grade.name) })) });
      await tx.stream.createMany({ data: DEFAULT_STREAMS.map((name) => ({ schoolId, name })) });
      await tx.subject.createMany({ data: DEFAULT_SUBJECTS.map((subject) => ({ id: subjectIds.get(subject.name)!, schoolId, ...subject })) });

      // Logins: admin, principal, accountant, the six teachers, the demo parent and student.
      const login = (userId: string, role: "SCHOOL_ADMIN" | "PRINCIPAL" | "TEACHER" | "PARENT" | "STUDENT" | "NON_TEACHING_STAFF", who: string, first: string, last: string) => ({
        id: userId,
        schoolId,
        role,
        email: email(who),
        passwordHash,
        firstName: first,
        lastName: last,
        activatedAt: now,
      });
      await tx.user.createMany({
        data: [
          login(users.SCHOOL_ADMIN, "SCHOOL_ADMIN", "admin", "Sunita", "Bhargava"),
          login(users.PRINCIPAL, "PRINCIPAL", "principal", "Neelam", "Rao"),
          login(users.ACCOUNTANT, "NON_TEACHING_STAFF", "accountant", "Mahesh", "Arora"),
          ...TEACHERS.map((teacher, index) => login(teacherUserIds[index]!, "TEACHER", index === 0 ? "teacher" : `teacher${index + 1}`, teacher.first, teacher.last)),
          login(users.PARENT, "PARENT", "parent", demoParent.first, demoParent.last),
          login(users.STUDENT, "STUDENT", "student", elder.first, elder.last),
        ],
      });
      await tx.organization.updateMany({ where: { schools: { some: { id: schoolId } } }, data: { ownerId: users.SCHOOL_ADMIN } });

      await tx.teacher.createMany({
        data: TEACHERS.map((teacher, index) => ({
          id: teacherIds[index]!,
          schoolId,
          userId: teacherUserIds[index]!,
          employeeId: `GV-T${String(index + 1).padStart(2, "0")}`,
          firstName: teacher.first,
          lastName: teacher.last,
          email: email(index === 0 ? "teacher" : `teacher${index + 1}`),
          phone: `+91 98${String(10000000 + index * 1111).slice(0, 8)}`,
          qualification: "M.A., B.Ed.",
          designation: index === 0 ? "Senior Teacher" : "Teacher",
          joiningDate: new Date(Date.UTC(2015 + index, 5, 1)),
        })),
      });
      await tx.staffMember.create({
        data: { id: staffId, schoolId, userId: users.ACCOUNTANT, employeeId: "GV-S01", firstName: "Mahesh", lastName: "Arora", role: "ACCOUNTANT", designation: "Accountant", grants: [...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT], phone: "+91 9811100011", email: email("accountant") },
      });

      await tx.section.createMany({
        data: sections.map((section, index) => ({ id: section.id, schoolId, academicSessionId: sessionId, classId: section.classId, name: section.name, capacity: 40, classTeacherId: classTeacherOf(index) })),
      });
      await tx.classTeacherAssignment.createMany({
        data: sections.map((section, index) => ({ schoolId, academicSessionId: sessionId, sectionId: section.id, teacherId: classTeacherOf(index), fromDate: year.startDate })),
      });
      await tx.teacherSubjectAssignment.createMany({
        data: sections.flatMap((section) => TEACHERS.map((teacher, index) => ({ schoolId, academicSessionId: sessionId, teacherId: teacherIds[index]!, subjectId: subjectIds.get(teacher.subject)!, sectionId: section.id }))),
      });

      // Timetable: five periods a day; section s, period p is taught by teacher (p + s) mod 6 — no teacher is ever in two rooms at once.
      const slots: Array<{ id: string; sectionId: string; teacherId: string; subjectId: string; dayOfWeek: DayOfWeek; startMinute: number }> = [];
      for (const day of SCHOOL_DAYS) {
        for (const [s, section] of sections.entries()) {
          for (let p = 0; p < 5; p += 1) {
            const t = (p + s + SCHOOL_DAYS.indexOf(day)) % TEACHERS.length;
            slots.push({ id: id(), sectionId: section.id, teacherId: teacherIds[t]!, subjectId: subjectIds.get(TEACHERS[t]!.subject)!, dayOfWeek: day, startMinute: 8 * 60 + p * 45 });
          }
        }
      }
      await tx.timetableSlot.createMany({ data: slots.map((slot) => ({ ...slot, schoolId, academicSessionId: sessionId, endMinute: slot.startMinute + 40, room: `Room ${100 + sections.findIndex((row) => row.id === slot.sectionId) + 1}` })) });

      await tx.parent.createMany({ data: familyParents.map((parent) => ({ id: parent.id, schoolId, userId: parent.userId, firstName: parent.first, lastName: parent.last, phone: parent.phone, email: parent.userId ? email("parent") : null, occupation: "Business" })) });
      await tx.student.createMany({
        data: kids.map((kid, index) => ({
          id: kid.id,
          schoolId,
          userId: kid.userId,
          admissionNumber: `GV-${year.startDate.getUTCFullYear()}-${String(index + 1).padStart(4, "0")}`,
          firstName: kid.first,
          lastName: kid.last,
          gender: kid.gender,
          dateOfBirth: new Date(Date.UTC(2010 + (index % 5), index % 12, 10 + (index % 15))),
          admissionDate: new Date(Date.UTC(2021, 3, 5)),
          createdAt: new Date(Date.UTC(2021, 3, 5)),
          bloodGroup: ["A+", "B+", "O+", "AB+"][index % 4],
          addressLine: `${10 + index} Sample Colony`,
          city: "Gwalior",
          state: "Madhya Pradesh",
        })),
      });
      await tx.parentStudent.createMany({ data: kids.map((kid) => ({ schoolId, parentId: kid.parentId, studentId: kid.id, relationship: "FATHER" as const, isPrimary: true })) });
      await tx.studentEnrollment.createMany({ data: kids.map((kid) => ({ schoolId, studentId: kid.id, academicSessionId: sessionId, classId: kid.classId, sectionId: kid.sectionId, rollNumber: String(kid.roll) })) });

      // --- a month of attendance ------------------------------------------------
      const attendance: Array<{ schoolId: string; academicSessionId: string; studentId: string; sectionId: string; date: Date; status: AttendanceStatus; markedByUserId: string }> = [];
      const registers: Array<{ schoolId: string; academicSessionId: string; sectionId: string; date: Date; status: "SUBMITTED"; submittedAt: Date; submittedById: string }> = [];
      const teacherDays: Array<{ schoolId: string; teacherId: string; date: Date; status: "PRESENT" | "LATE" | "ON_LEAVE" }> = [];
      for (let back = 30; back >= 1; back -= 1) {
        const date = addDays(date0, -back);
        if (dayOfWeek(date) === "SUNDAY" || date < year.startDate) continue;
        for (const [s, section] of sections.entries()) registers.push({ schoolId, academicSessionId: sessionId, sectionId: section.id, date, status: "SUBMITTED", submittedAt: date, submittedById: teacherUserIds[(s + 4) % TEACHERS.length]! });
        for (const kid of kids) {
          const roll = random();
          attendance.push({ schoolId, academicSessionId: sessionId, studentId: kid.id, sectionId: kid.sectionId, date, status: roll > 0.94 ? "ABSENT" : roll > 0.9 ? "LATE" : "PRESENT", markedByUserId: users.TEACHER });
        }
        for (const teacherId of teacherIds) {
          const roll = random();
          teacherDays.push({ schoolId, teacherId, date, status: roll > 0.96 ? "ON_LEAVE" : roll > 0.92 ? "LATE" : "PRESENT" });
        }
      }
      await tx.attendanceRegister.createMany({ data: registers });
      await tx.studentAttendance.createMany({ data: attendance });
      await tx.teacherAttendance.createMany({ data: teacherDays });

      // --- homework ---------------------------------------------------------------
      await tx.homework.createMany({
        data: sections.flatMap((section) => [
          { schoolId, academicSessionId: sessionId, sectionId: section.id, subjectId: subjectIds.get("Mathematics")!, teacherId: teacherIds[0]!, title: "Fractions — exercise 3.2, questions 1 to 8", description: "Show every step. Sample homework.", assignedOn: addDays(date0, -1), dueOn: addDays(date0, 2), status: "PUBLISHED" as const },
          { schoolId, academicSessionId: sessionId, sectionId: section.id, subjectId: subjectIds.get("Science")!, teacherId: teacherIds[1]!, title: "Draw and label a plant cell", description: "On an A4 sheet. Sample homework.", assignedOn: addDays(date0, -3), dueOn: addDays(date0, 1), status: "PUBLISHED" as const },
        ]),
      });

      // --- exams: Unit Test 1 and Half-Yearly published; Unit Test 2 submitted, waiting to be verified ---
      const examRows: Array<{ id: string; sectionId: string; name: string; startDate: Date; endDate: Date; status: "PUBLISHED" | "DRAFT" }> = [];
      const offsets = { [exams.ut1]: -70, [exams.hy]: -35, [exams.ut2]: -8 } as Record<string, number>;
      for (const section of sections) {
        for (const name of [exams.ut1, exams.hy, exams.ut2]) {
          const start = addDays(date0, offsets[name]!);
          examRows.push({ id: id(), sectionId: section.id, name, startDate: start, endDate: addDays(start, 3), status: name === exams.ut2 ? "DRAFT" : "PUBLISHED" });
        }
      }
      await tx.exam.createMany({
        data: examRows.map((exam) => ({ ...exam, schoolId, academicSessionId: sessionId, publishedAt: exam.status === "PUBLISHED" ? addDays(exam.endDate, 5) : null, publishedById: exam.status === "PUBLISHED" ? users.SCHOOL_ADMIN : null, verifiedAt: exam.status === "PUBLISHED" ? addDays(exam.endDate, 4) : null, verifiedById: exam.status === "PUBLISHED" ? users.PRINCIPAL : null })),
      });
      const papers: Array<{ id: string; examId: string; sectionId: string; subjectId: string; teacherId: string; name: string; date: Date; maxMarks: number }> = [];
      for (const exam of examRows) {
        for (const [index, subject] of examSubjects.entries()) {
          const teacherIndex = TEACHERS.findIndex((row) => row.subject === subject);
          papers.push({ id: id(), examId: exam.id, sectionId: exam.sectionId, subjectId: subjectIds.get(subject)!, teacherId: teacherIds[teacherIndex]!, name: exam.name, date: addDays(exam.startDate, Math.min(index, 3)), maxMarks: exam.name === exams.hy ? 80 : 25 });
        }
      }
      await tx.assessment.createMany({ data: papers.map((paper) => ({ ...paper, schoolId, academicSessionId: sessionId, marksStatus: "SUBMITTED" as const, submittedAt: addDays(paper.date, 2), submittedById: users.TEACHER })) });
      const results: Array<{ schoolId: string; assessmentId: string; studentId: string; marksObtained: number | null; absent: boolean }> = [];
      for (const paper of papers) {
        for (const kid of kids.filter((row) => row.sectionId === paper.sectionId)) {
          const absent = random() > 0.97;
          // Mostly 45–95%, a few below the pass mark so "needs attention" has something to show.
          const share = 0.45 + random() * 0.5 - (random() > 0.92 ? 0.25 : 0);
          results.push({ schoolId, assessmentId: paper.id, studentId: kid.id, marksObtained: absent ? null : Math.max(0, Math.min(paper.maxMarks, Math.round(paper.maxMarks * share))), absent });
        }
      }
      await tx.assessmentResult.createMany({ data: results });
      await tx.resultScheme.create({ data: { schoolId, academicSessionId: sessionId, name: `Final result ${year.name}`, components: [{ examName: exams.ut1, weight: 30 }, { examName: exams.hy, weight: 70 }], createdById: users.SCHOOL_ADMIN } });
      await tx.studentRemark.createMany({
        data: [
          { schoolId, academicSessionId: sessionId, studentId: elder.id, teacherId: teacherIds[0]!, subjectId: subjectIds.get("Mathematics")!, understanding: "GOOD", participation: "ACTIVE", body: "Ananya works carefully and helps classmates. Keep practising word problems." },
          { schoolId, academicSessionId: sessionId, studentId: younger.id, teacherId: teacherIds[2]!, subjectId: subjectIds.get("English")!, understanding: "AVERAGE", body: "Kabir reads well; spelling needs a little daily practice." },
        ],
      });

      // --- fees: tuition in three instalments, exam and activity fees -----------
      const heads = { tuition: id(), exam: id(), activity: id() };
      await tx.feeHead.createMany({
        data: [
          { id: heads.tuition, schoolId, name: "Tuition fee", note: "Three instalments" },
          { id: heads.exam, schoolId, name: "Examination fee", note: null },
          { id: heads.activity, schoolId, name: "Activity fee", note: "Sports, clubs and events" },
        ],
      });
      const tuitionByGrade: Record<string, number> = { "Class 6": 30_000_00, "Class 8": 36_000_00, "Class 10": 42_000_00 };
      const charges: Array<{ id: string; schoolId: string; academicSessionId: string; studentId: string; feeHeadId: string; amountMinor: number; dueOn: Date; installmentNo: number }> = [];
      const tuitionDue = [addDays(date0, -75), addDays(date0, -15), addDays(date0, 45)];
      for (const kid of kids) {
        const grade = sections.find((row) => row.id === kid.sectionId)!.grade;
        const total = tuitionByGrade[grade]!;
        const part = Math.floor(total / 3);
        tuitionDue.forEach((dueOn, index) => charges.push({ id: id(), schoolId, academicSessionId: sessionId, studentId: kid.id, feeHeadId: heads.tuition, amountMinor: index === 2 ? total - part * 2 : part, dueOn, installmentNo: index + 1 }));
        charges.push({ id: id(), schoolId, academicSessionId: sessionId, studentId: kid.id, feeHeadId: heads.exam, amountMinor: 1_500_00, dueOn: addDays(date0, -40), installmentNo: 1 });
        charges.push({ id: id(), schoolId, academicSessionId: sessionId, studentId: kid.id, feeHeadId: heads.activity, amountMinor: 2_000_00, dueOn: addDays(date0, 20), installmentNo: 1 });
      }
      await tx.feeCharge.createMany({ data: charges });
      // A sibling concession on the younger child's tuition instalment 1.
      const siblingCharge = charges.find((row) => row.studentId === younger.id && row.feeHeadId === heads.tuition && row.installmentNo === 1)!;
      await tx.feeConcession.create({ data: { schoolId, feeChargeId: siblingCharge.id, kind: "PERCENT", value: 1000, discountMinor: Math.round(siblingCharge.amountMinor / 10), originalMinor: siblingCharge.amountMinor, reason: "Sibling concession (10%)", approvedById: users.SCHOOL_ADMIN } });
      // Payments: a spread of paid-up, part-paid and behind.
      const payments: Array<{ schoolId: string; academicSessionId: string; studentId: string; amountMinor: number; paidOn: Date; method: "CASH" | "UPI" | "CHEQUE"; receiptNo: string; recordedById: string }> = [];
      let receipt = 1000;
      for (const [index, kid] of kids.entries()) {
        const owed = charges.filter((row) => row.studentId === kid.id && row.dueOn <= date0).reduce((sum, row) => sum + row.amountMinor, 0);
        const pattern = kid.id === elder.id ? 1 : index % 4;
        const paid = pattern === 0 ? owed : pattern === 1 ? Math.round(owed * 0.6) : pattern === 2 ? Math.round(owed * 0.35) : 0;
        if (paid <= 0) continue;
        receipt += 1;
        payments.push({ schoolId, academicSessionId: sessionId, studentId: kid.id, amountMinor: paid, paidOn: payments.length < 3 ? date0 : addDays(date0, -(5 + (index % 40))), method: index % 3 === 0 ? "CASH" : index % 3 === 1 ? "UPI" : "CHEQUE", receiptNo: `DEMO-${receipt}`, recordedById: index % 2 ? users.ACCOUNTANT : users.SCHOOL_ADMIN });
      }
      await tx.feePayment.createMany({ data: payments });

      // --- school life ----------------------------------------------------------
      await tx.notice.createMany({
        data: [
          { schoolId, title: "Half-yearly results are published", body: "Parents can view report cards in the parent portal. (Sample notice.)", audience: "PARENTS", status: "PUBLISHED", authorId: users.PRINCIPAL, publishAt: addDays(now, -3) },
          { schoolId, title: "Winter uniform from Monday", body: "Students wear the winter uniform from next Monday. (Sample notice.)", audience: "ALL", status: "PUBLISHED", authorId: users.SCHOOL_ADMIN, publishAt: addDays(now, -1) },
          { schoolId, title: "Staff meeting at 2:30 pm on Friday", body: "Agenda: unit test 2 marks and the annual function. (Sample notice.)", audience: "TEACHERS", status: "PUBLISHED", authorId: users.PRINCIPAL, publishAt: addDays(now, -2) },
        ],
      });
      await tx.event.createMany({
        data: [
          { schoolId, title: "Annual Sports Day", description: "Track events, house relays and prize giving. (Sample event.)", date: addDays(date0, 12), startMinute: 9 * 60, endMinute: 13 * 60, location: "School ground", isPublished: true },
          { schoolId, title: "Science Exhibition", description: "Class 6–10 projects. (Sample event.)", date: addDays(date0, 25), startMinute: 10 * 60, endMinute: 14 * 60, location: "Main hall", isPublished: true },
        ],
      });
      await tx.meeting.create({
        data: { schoolId, academicSessionId: sessionId, type: "PTM", title: "Parent-Teacher Meeting — Class 8", description: "Discuss half-yearly results. (Sample meeting.)", date: addDays(date0, 6), startMinute: 10 * 60, endMinute: 12 * 60, location: "Class 8 rooms", audiences: ["PARENTS", "TEACHERS"], scope: "SCHOOL", createdById: users.PRINCIPAL },
      });
      await tx.responsibility.createMany({
        data: [
          { schoolId, title: "Annual Sports Day coordination", description: "Plan events, house teams and the schedule.", type: "SPORTS", assignedToId: users.TEACHER, assignedById: users.PRINCIPAL, startDate: addDays(date0, -5), endDate: addDays(date0, 12), status: "IN_PROGRESS", priority: "HIGH", progressNote: "Ground booked; house captains chosen." },
          { schoolId, title: "Unit Test 2 marks review", description: "Check every paper is submitted before verification.", type: "EXAM_COORDINATOR", assignedToId: teacherUserIds[1]!, assignedById: users.PRINCIPAL, startDate: addDays(date0, -3), endDate: addDays(date0, 3), status: "PENDING", priority: "NORMAL" },
          { schoolId, title: "Science exhibition set-up", type: "SCHOOL_EVENT", assignedToId: teacherUserIds[1]!, assignedById: users.SCHOOL_ADMIN, startDate: addDays(date0, -20), endDate: addDays(date0, -2), status: "COMPLETED", completedAt: addDays(now, -2), priority: "LOW" },
        ],
      });
    },
    { timeout: 60_000, maxWait: 20_000 },
  );

  return { schoolId, expiresAt, users };
}
