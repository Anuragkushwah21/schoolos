/**
 * Builds two complete, independent schools for the isolation suite.
 *
 * Each school gets its own session, class, section, teacher, parent, students,
 * notices and attendance, so the tests compare like with like rather than
 * "populated school vs. empty school".
 */
import { prisma } from "@/server/db/prisma";

export type SeededSchool = {
  schoolId: string;
  adminUserId: string;
  academicSessionId: string;
  classId: string;
  /** The teacher IS assigned to this section (class teacher + subject). */
  sectionId: string;
  /** The teacher is NOT assigned to this one — used for negative RBAC tests. */
  unassignedSectionId: string;
  subjectId: string;
  teacherId: string;
  teacherUserId: string;
  parentUserId: string;
  parentId: string;
  studentIds: string[];
};

/** Prefix for every row this fixture creates, so teardown is unambiguous. */
const FIXTURE_PREFIX = "iso-test-";

async function buildSchool(
  key: string,
  studentNames: string[],
): Promise<SeededSchool> {
  const school = await prisma.school.create({
    data: {
      slug: `${FIXTURE_PREFIX}${key}`,
      name: `Isolation Test School ${key.toUpperCase()}`,
      status: "ACTIVE",
      contactName: "Fixture Contact",
      contactEmail: `contact@${FIXTURE_PREFIX}${key}.test`,
      contactPhone: "+91-90000-00000",
    },
  });

  const adminUser = await prisma.user.create({
    data: {
      email: `admin@${FIXTURE_PREFIX}${key}.test`,
      passwordHash: "not-a-real-hash",
      role: "SCHOOL_ADMIN",
      firstName: "Fixture",
      lastName: "Admin",
      schoolId: school.id,
    },
  });

  const academicSession = await prisma.academicSession.create({
    data: {
      schoolId: school.id,
      name: "2026-27",
      startDate: new Date(Date.UTC(2026, 3, 1)),
      endDate: new Date(Date.UTC(2027, 2, 31)),
      isCurrent: true,
    },
  });

  const klass = await prisma.class.create({
    data: { schoolId: school.id, name: "Class 10", level: 10 },
  });

  const teacherUser = await prisma.user.create({
    data: {
      email: `teacher@${FIXTURE_PREFIX}${key}.test`,
      passwordHash: "not-a-real-hash",
      role: "TEACHER",
      firstName: "Fixture",
      lastName: "Teacher",
      schoolId: school.id,
    },
  });

  const teacher = await prisma.teacher.create({
    data: {
      schoolId: school.id,
      userId: teacherUser.id,
      employeeId: "EMP001",
      firstName: "Fixture",
      lastName: "Teacher",
    },
  });

  const section = await prisma.section.create({
    data: {
      schoolId: school.id,
      academicSessionId: academicSession.id,
      classId: klass.id,
      name: "A",
      classTeacherId: teacher.id,
    },
  });

  // A second section in the same school that this teacher does not teach.
  const unassignedSection = await prisma.section.create({
    data: {
      schoolId: school.id,
      academicSessionId: academicSession.id,
      classId: klass.id,
      name: "B",
    },
  });

  const subject = await prisma.subject.create({
    data: { schoolId: school.id, name: "Mathematics", code: "MATH" },
  });

  await prisma.teacherSubjectAssignment.create({
    data: {
      schoolId: school.id,
      academicSessionId: academicSession.id,
      teacherId: teacher.id,
      subjectId: subject.id,
      sectionId: section.id,
    },
  });

  const parentUser = await prisma.user.create({
    data: {
      email: `parent@${FIXTURE_PREFIX}${key}.test`,
      passwordHash: "not-a-real-hash",
      role: "PARENT",
      firstName: "Fixture",
      lastName: "Parent",
      schoolId: school.id,
    },
  });

  const parent = await prisma.parent.create({
    data: {
      schoolId: school.id,
      userId: parentUser.id,
      firstName: "Fixture",
      lastName: "Parent",
      phone: "+91-90000-00001",
    },
  });

  const studentIds: string[] = [];

  for (const [index, name] of studentNames.entries()) {
    const student = await prisma.student.create({
      data: {
        schoolId: school.id,
        admissionNumber: `ADM${index + 1}`,
        firstName: name,
        lastName: key.toUpperCase(),
        gender: index % 2 === 0 ? "MALE" : "FEMALE",
      },
    });

    await prisma.parentStudent.create({
      data: {
        schoolId: school.id,
        parentId: parent.id,
        studentId: student.id,
        relationship: "GUARDIAN",
        isPrimary: index === 0,
      },
    });

    await prisma.studentEnrollment.create({
      data: {
        schoolId: school.id,
        studentId: student.id,
        academicSessionId: academicSession.id,
        classId: klass.id,
        sectionId: section.id,
        rollNumber: String(index + 1),
      },
    });

    await prisma.studentAttendance.create({
      data: {
        schoolId: school.id,
        academicSessionId: academicSession.id,
        studentId: student.id,
        sectionId: section.id,
        date: new Date(Date.UTC(2026, 8, 18)),
        status: "PRESENT",
        markedByUserId: adminUser.id,
      },
    });

    studentIds.push(student.id);
  }

  await prisma.notice.create({
    data: {
      schoolId: school.id,
      title: `Notice for ${key}`,
      body: "Fixture notice.",
      status: "PUBLISHED",
      authorId: adminUser.id,
    },
  });

  return {
    schoolId: school.id,
    adminUserId: adminUser.id,
    academicSessionId: academicSession.id,
    classId: klass.id,
    sectionId: section.id,
    unassignedSectionId: unassignedSection.id,
    subjectId: subject.id,
    teacherId: teacher.id,
    teacherUserId: teacherUser.id,
    parentUserId: parentUser.id,
    parentId: parent.id,
    studentIds,
  };
}

export async function createIsolationFixture() {
  await destroyIsolationFixture();

  // Deliberately different sizes, so a leak shows up as a wrong count.
  const schoolA = await buildSchool("a", ["Aarav", "Ananya", "Ishaan"]);
  const schoolB = await buildSchool("b", ["Rohan", "Tara"]);

  return { schoolA, schoolB };
}

export async function destroyIsolationFixture() {
  // Deleting the School cascades to everything it owns.
  await prisma.school.deleteMany({
    where: { slug: { startsWith: FIXTURE_PREFIX } },
  });
}
