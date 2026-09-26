/**
 * Development helper: add two fully set-up demo schools and a Super Admin.
 *
 * Deliberately NOT `prisma/seed.ts`, which wipes the database. This one only
 * ever touches rows it created itself: two schools whose slug starts with
 * `demo-`, and one Super Admin at a fixed address. Anything else already in the
 * database — your own school, your own accounts — is left exactly as it is.
 *
 * Re-running it replaces the demo data rather than duplicating it.
 *
 *   npm run db:seed:demo
 *
 * Every account shares one password, printed at the end and appended to `.env`
 * as comments. `.env` is gitignored, so it does not leave your machine.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { DayOfWeek, Gender, UserRole } from "../src/generated/prisma/enums";
import { addDays, dateOnly, dayOfWeek, today } from "../src/lib/dates";
import { hashPassword } from "../src/server/auth/password";
import { prisma } from "../src/server/db/prisma";

/** Everything this script creates is findable by these two markers. */
const DEMO_SLUG_PREFIX = "demo-";
const SUPER_ADMIN_EMAIL = "superadmin@schoolos.dev";

/**
 * One password for every demo account, so checking each role in turn does not
 * mean juggling twelve of them. Long enough and mixed enough to satisfy the
 * app's own rules, and obviously not a secret.
 */
const DEMO_PASSWORD = "SchoolOS@2026";

const SESSION_NAME = "2026-27";

// -----------------------------------------------------------------------------
// What the two schools contain
// -----------------------------------------------------------------------------

type TeacherSpec = { first: string; last: string; subject: string };
type ChildSpec = { first: string; gender: Gender; grade: string };
type FamilySpec = { parentFirst: string; surname: string; children: ChildSpec[] };

type SchoolSpec = {
  slug: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  adminFirst: string;
  adminLast: string;
  planTier: "STARTER" | "STANDARD" | "PRO";
  /** Grade name -> how many sections it has. */
  grades: Record<string, number>;
  teachers: TeacherSpec[];
  families: FamilySpec[];
  /** Students given a login, by first name. Student sign-in is not part of V1. */
  studentLogins: string[];
};

const SUBJECTS = [
  { name: "English", code: "ENG" },
  { name: "Mathematics", code: "MATH" },
  { name: "Science", code: "SCI" },
  { name: "Social Studies", code: "SST" },
  { name: "Hindi", code: "HIN" },
  { name: "Computer Science", code: "CS" },
];

const SCHOOLS: SchoolSpec[] = [
  {
    slug: `${DEMO_SLUG_PREFIX}sunrise`,
    name: "Sunrise Public School",
    shortName: "Sunrise",
    city: "Indore",
    state: "Madhya Pradesh",
    adminFirst: "Meera",
    adminLast: "Joshi",
    planTier: "STANDARD",
    grades: { "Class 5": 1, "Class 8": 1, "Class 10": 2 },
    teachers: [
      { first: "Rahul", last: "Sharma", subject: "Mathematics" },
      { first: "Anita", last: "Verma", subject: "English" },
      { first: "Suresh", last: "Patel", subject: "Science" },
      { first: "Kavita", last: "Nair", subject: "Social Studies" },
      { first: "Imran", last: "Sheikh", subject: "Computer Science" },
    ],
    // Two families have more than one child, which is the case a parent login
    // has to handle: one sign-in, several children.
    families: [
      {
        parentFirst: "Rajesh",
        surname: "Gupta",
        children: [
          { first: "Rahul", gender: Gender.MALE, grade: "Class 10" },
          { first: "Priya", gender: Gender.FEMALE, grade: "Class 8" },
          { first: "Aman", gender: Gender.MALE, grade: "Class 5" },
        ],
      },
      {
        parentFirst: "Sunita",
        surname: "Deshmukh",
        children: [
          { first: "Isha", gender: Gender.FEMALE, grade: "Class 10" },
          { first: "Arjun", gender: Gender.MALE, grade: "Class 5" },
        ],
      },
      { parentFirst: "Vikram", surname: "Singh", children: [{ first: "Neha", gender: Gender.FEMALE, grade: "Class 10" }] },
      { parentFirst: "Farida", surname: "Khan", children: [{ first: "Zoya", gender: Gender.FEMALE, grade: "Class 8" }] },
      { parentFirst: "Anil", surname: "Kumar", children: [{ first: "Rohan", gender: Gender.MALE, grade: "Class 8" }] },
      { parentFirst: "Deepa", surname: "Iyer", children: [{ first: "Kabir", gender: Gender.MALE, grade: "Class 10" }] },
      { parentFirst: "Mohan", surname: "Rao", children: [{ first: "Tara", gender: Gender.FEMALE, grade: "Class 5" }] },
    ],
    studentLogins: ["Rahul", "Isha", "Priya"],
  },
  {
    slug: `${DEMO_SLUG_PREFIX}greenvalley`,
    name: "Green Valley Academy",
    shortName: "Green Valley",
    city: "Pune",
    state: "Maharashtra",
    adminFirst: "Sanjay",
    adminLast: "Kulkarni",
    planTier: "STARTER",
    grades: { "Class 6": 1, "Class 9": 1 },
    teachers: [
      { first: "Priyanka", last: "Bose", subject: "English" },
      { first: "Amit", last: "Chauhan", subject: "Mathematics" },
      { first: "Leena", last: "Thomas", subject: "Science" },
    ],
    families: [
      {
        parentFirst: "Nitin",
        surname: "Pawar",
        children: [
          { first: "Sakshi", gender: Gender.FEMALE, grade: "Class 9" },
          { first: "Yash", gender: Gender.MALE, grade: "Class 6" },
        ],
      },
      { parentFirst: "Asha", surname: "Bhosale", children: [{ first: "Om", gender: Gender.MALE, grade: "Class 9" }] },
      {
        parentFirst: "Ravi",
        surname: "Jadhav",
        children: [
          { first: "Diya", gender: Gender.FEMALE, grade: "Class 6" },
          { first: "Kunal", gender: Gender.MALE, grade: "Class 9" },
        ],
      },
    ],
    studentLogins: [],
  },
];

const GRADE_LEVEL: Record<string, number> = {
  "Class 5": 5,
  "Class 6": 6,
  "Class 8": 8,
  "Class 9": 9,
  "Class 10": 10,
};

/** Deterministic, so two runs produce the same registers. */
function makeRng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const SCHOOL_DAYS: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

type Credential = { role: string; who: string; email: string };

// -----------------------------------------------------------------------------

/**
 * Remove the previous run's demo data, and nothing else.
 *
 * Deleting a School cascades to everything it owns, users included, so the two
 * demo schools come out whole. The Super Admin has no school and is removed by
 * its fixed address.
 */
async function clearPreviousDemo(): Promise<void> {
  const doomed = await prisma.school.findMany({
    where: { slug: { startsWith: DEMO_SLUG_PREFIX } },
    select: { slug: true, name: true },
  });
  for (const school of doomed) {
    console.log(`  removing previous demo school ${school.name} (${school.slug})`);
  }
  await prisma.school.deleteMany({ where: { slug: { startsWith: DEMO_SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: SUPER_ADMIN_EMAIL } });
}

async function seedSuperAdmin(passwordHash: string): Promise<Credential> {
  await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      firstName: "Platform",
      lastName: "Owner",
      // No schoolId: a Super Admin governs schools and belongs to none.
      schoolId: null,
    },
  });
  return { role: "SUPER_ADMIN", who: "Platform Owner", email: SUPER_ADMIN_EMAIL };
}

async function seedSchool(spec: SchoolSpec, passwordHash: string): Promise<Credential[]> {
  const credentials: Credential[] = [];
  const rng = makeRng(spec.slug.length * 7919);
  const now = today();

  const school = await prisma.school.create({
    data: {
      slug: spec.slug,
      name: spec.name,
      shortName: spec.shortName,
      status: "ACTIVE",
      contactName: `${spec.adminFirst} ${spec.adminLast}`,
      contactEmail: `${spec.adminFirst}.${spec.adminLast}.${spec.slug}@schoolos.dev`.toLowerCase(),
      contactPhone: "+91-99000-00000",
      about: `${spec.name} is a co-educational school in ${spec.city}. Demo data.`,
      principalName: `${spec.adminFirst} ${spec.adminLast}`,
      establishedYear: 1998,
      affiliationBoard: "CBSE",
      email: `office@${spec.slug}.dev`,
      phone: "+91-99000-00001",
      addressLine: "1 Example Road",
      city: spec.city,
      state: spec.state,
      postalCode: "452001",
      contactEmailVerifiedAt: new Date(),
      reviewedAt: new Date(),
    },
  });

  const plan = await prisma.plan.findFirst({ where: { tier: spec.planTier }, select: { id: true } });
  if (plan) {
    await prisma.subscription.create({
      data: {
        schoolId: school.id,
        planId: plan.id,
        status: "ACTIVE",
        startsAt: dateOnly(2026, 4, 1),
      },
    });
  }

  // --- the school administrator ---------------------------------------------
  const adminEmail = `${spec.adminFirst}.${spec.adminLast}.${spec.slug}@schoolos.dev`.toLowerCase();
  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      role: UserRole.SCHOOL_ADMIN,
      firstName: spec.adminFirst,
      lastName: spec.adminLast,
      schoolId: school.id,
    },
  });
  credentials.push({
    role: "SCHOOL_ADMIN",
    who: `${spec.adminFirst} ${spec.adminLast} — ${spec.name}`,
    email: adminEmail,
  });

  // --- the academic year ----------------------------------------------------
  const session = await prisma.academicSession.create({
    data: {
      schoolId: school.id,
      name: SESSION_NAME,
      startDate: dateOnly(2026, 4, 1),
      endDate: dateOnly(2027, 3, 31),
      // Current, so nothing in the app greets this school with a setup notice.
      isCurrent: true,
    },
  });

  const subjects = new Map<string, string>();
  for (const subject of SUBJECTS) {
    const created = await prisma.subject.create({
      data: { schoolId: school.id, name: subject.name, code: subject.code },
    });
    subjects.set(subject.name, created.id);
  }

  // --- teachers -------------------------------------------------------------
  const teachers: Array<{ id: string; first: string; last: string; subject: string }> = [];
  for (const [index, t] of spec.teachers.entries()) {
    const email = `${t.first}.${t.last}.${spec.slug}@schoolos.dev`.toLowerCase();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.TEACHER,
        firstName: t.first,
        lastName: t.last,
        schoolId: school.id,
      },
    });
    const teacher = await prisma.teacher.create({
      data: {
        schoolId: school.id,
        userId: user.id,
        employeeId: `EMP${String(index + 1).padStart(3, "0")}`,
        firstName: t.first,
        lastName: t.last,
        email,
        phone: `+91-98000-00${String(index + 10)}`,
        qualification: "M.Sc., B.Ed.",
        joiningDate: dateOnly(2019, 6, 1),
      },
    });
    teachers.push({ id: teacher.id, first: t.first, last: t.last, subject: t.subject });
    credentials.push({
      role: "TEACHER",
      who: `${t.first} ${t.last} — ${t.subject}, ${spec.shortName}`,
      email,
    });
  }

  // --- classes and sections -------------------------------------------------
  const classes = new Map<string, string>();
  /** Grade name -> its section ids, in order. */
  const sections = new Map<string, string[]>();

  for (const [grade, count] of Object.entries(spec.grades)) {
    const klass = await prisma.class.create({
      data: { schoolId: school.id, name: grade, level: GRADE_LEVEL[grade] ?? 1 },
    });
    classes.set(grade, klass.id);

    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const name = String.fromCharCode(65 + i); // A, B, ...
      const section = await prisma.section.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          classId: klass.id,
          name,
          // Class teacher cycles through the staff, so several teachers have
          // one and the dashboards differ from each other.
          classTeacherId: teachers[ids.length % teachers.length]?.id ?? null,
          capacity: 40,
        },
      });
      ids.push(section.id);
    }
    sections.set(grade, ids);
  }

  const allSections = [...sections.values()].flat();

  // --- who teaches what, where ---------------------------------------------
  // The assignment is also the permission: this is what lets a teacher open a
  // register or set homework for a section.
  for (const sectionId of allSections) {
    for (const teacher of teachers) {
      const subjectId = subjects.get(teacher.subject);
      if (!subjectId) continue;
      await prisma.teacherSubjectAssignment.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          teacherId: teacher.id,
          subjectId,
          sectionId,
        },
      });
    }
  }

  // --- timetable ------------------------------------------------------------
  // Each section gets its own pair of periods per day, so no teacher can ever
  // be in two rooms at once — the clash check would refuse that anyway.
  const PERIOD_MINUTES = 45;
  const DAY_START = 9 * 60;

  for (const day of SCHOOL_DAYS) {
    for (const [sectionIndex, sectionId] of allSections.entries()) {
      for (let p = 0; p < 2; p += 1) {
        const periodIndex = sectionIndex * 2 + p;
        const startMinute = DAY_START + periodIndex * PERIOD_MINUTES;
        const teacher = teachers[(periodIndex + SCHOOL_DAYS.indexOf(day)) % teachers.length];
        if (!teacher) continue;
        const subjectId = subjects.get(teacher.subject);
        if (!subjectId) continue;

        await prisma.timetableSlot.create({
          data: {
            schoolId: school.id,
            academicSessionId: session.id,
            sectionId,
            subjectId,
            teacherId: teacher.id,
            dayOfWeek: day,
            startMinute,
            endMinute: startMinute + PERIOD_MINUTES,
            room: `R${101 + sectionIndex}`,
          },
        });
      }
    }
  }

  // --- families, children and their placements ------------------------------
  let counter = 1;
  const students: Array<{ id: string; sectionId: string; first: string; parentPhone: string }> = [];

  for (const family of spec.families) {
    const parentEmail = `${family.parentFirst}.${family.surname}.${spec.slug}@schoolos.dev`.toLowerCase();
    const parentUser = await prisma.user.create({
      data: {
        email: parentEmail,
        passwordHash,
        role: UserRole.PARENT,
        firstName: family.parentFirst,
        lastName: family.surname,
        schoolId: school.id,
      },
    });
    const parentPhone = `+91-97000-${String(1000 + counter)}`;
    const parent = await prisma.parent.create({
      data: {
        schoolId: school.id,
        userId: parentUser.id,
        firstName: family.parentFirst,
        lastName: family.surname,
        email: parentEmail,
        phone: parentPhone,
        occupation: "Self-employed",
      },
    });

    const childNames = family.children.map((c) => c.first).join(", ");
    credentials.push({
      role: "PARENT",
      who: `${family.parentFirst} ${family.surname} — ${family.children.length} ${family.children.length === 1 ? "child" : "children"} (${childNames}), ${spec.shortName}`,
      email: parentEmail,
    });

    for (const [childIndex, child] of family.children.entries()) {
      const classId = classes.get(child.grade);
      const gradeSections = sections.get(child.grade);
      if (!classId || !gradeSections?.length) continue;
      const sectionId = gradeSections[counter % gradeSections.length]!;

      const wantsLogin = spec.studentLogins.includes(child.first);
      const studentEmail = `${child.first}.${family.surname}.${spec.slug}@schoolos.dev`.toLowerCase();
      const studentUser = wantsLogin
        ? await prisma.user.create({
            data: {
              email: studentEmail,
              passwordHash,
              role: UserRole.STUDENT,
              firstName: child.first,
              lastName: family.surname,
              schoolId: school.id,
            },
          })
        : null;

      if (studentUser) {
        credentials.push({
          role: "STUDENT",
          who: `${child.first} ${family.surname} — ${child.grade}, ${spec.shortName}`,
          email: studentEmail,
        });
      }

      const student = await prisma.student.create({
        data: {
          schoolId: school.id,
          userId: studentUser?.id ?? null,
          admissionNumber: `ADM${String(counter).padStart(4, "0")}`,
          firstName: child.first,
          lastName: family.surname,
          gender: child.gender,
          dateOfBirth: dateOnly(2012, (counter % 12) + 1, 15),
          admissionDate: dateOnly(2023, 4, 10),
          addressLine: "2 Example Lane",
          city: spec.city,
          state: spec.state,
          emergencyContactName: `${family.parentFirst} ${family.surname}`,
          emergencyContactPhone: parentPhone,
        },
      });

      await prisma.parentStudent.create({
        data: {
          schoolId: school.id,
          parentId: parent.id,
          studentId: student.id,
          relationship: childIndex === 0 ? "FATHER" : "GUARDIAN",
          isPrimary: childIndex === 0,
        },
      });

      await prisma.studentEnrollment.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          academicSessionId: session.id,
          classId,
          sectionId,
          rollNumber: String(counter),
        },
      });

      students.push({ id: student.id, sectionId, first: child.first, parentPhone });
      counter += 1;
    }
  }

  // --- a fortnight of registers, so the reports are not empty ---------------
  for (let back = 14; back >= 0; back -= 1) {
    const date = addDays(now, -back);
    if (dayOfWeek(date) === DayOfWeek.SUNDAY) continue;

    for (const student of students) {
      const roll = rng();
      const status = roll > 0.93 ? "ABSENT" : roll > 0.88 ? "LATE" : roll > 0.86 ? "EXCUSED" : "PRESENT";
      await prisma.studentAttendance.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          studentId: student.id,
          sectionId: student.sectionId,
          date,
          status,
          markedByUserId: admin.id,
        },
      });
    }

    for (const teacher of teachers) {
      const roll = rng();
      await prisma.teacherAttendance.create({
        data: {
          schoolId: school.id,
          teacherId: teacher.id,
          date,
          status: roll > 0.95 ? "ON_LEAVE" : roll > 0.92 ? "LATE" : "PRESENT",
        },
      });
    }
  }

  // --- homework, lesson records and remarks --------------------------------
  const firstTeacher = teachers[0];
  if (firstTeacher) {
    const subjectId = subjects.get(firstTeacher.subject)!;
    for (const [index, sectionId] of allSections.entries()) {
      await prisma.homework.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          sectionId,
          subjectId,
          teacherId: firstTeacher.id,
          title: `Exercise ${4 + index}.2 — questions 1 to 5`,
          description: "Show your working. Demo data.",
          assignedOn: addDays(now, -1),
          dueOn: addDays(now, 2 + index),
          status: "PUBLISHED",
        },
      });
    }

    // One structured remark per school, which is what a parent will read.
    const firstStudent = students[0];
    if (firstStudent) {
      await prisma.studentRemark.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          studentId: firstStudent.id,
          teacherId: firstTeacher.id,
          subjectId,
          understanding: "AVERAGE",
          homeworkHabit: "SOMETIMES_MISSING",
          participation: "ACTIVE",
          body: "Answers well in class but hands work in late. Demo data.",
        },
      });
    }

    // --- lessons: written up, with notes and material, plus one planned ----
    // This is what the student portal reads: a class a student can revise, and
    // a class they can prepare for.
    const TAUGHT = [
      {
        topic: "Quadratic equations",
        notes:
          "Derived the quadratic formula and worked through three examples on the board. " +
          "We covered factorising first, then completing the square.",
        importantPoints: "Learn the formula. Practice questions 1-10 from the exercise.",
        materials: [
          {
            kind: "NOTES" as const,
            title: "Quadratic equations — class notes",
            body:
              "ax² + bx + c = 0\n\nx = (-b ± √(b² - 4ac)) / 2a\n\n" +
              "The discriminant b² - 4ac tells you how many real roots there are.",
          },
          {
            kind: "QUESTIONS" as const,
            title: "Important questions",
            body: "1. Solve x² - 5x + 6 = 0\n2. Find the discriminant of 2x² + 3x - 1\n3. Complete the square for x² + 6x + 5",
          },
        ],
      },
      {
        topic: "Factorising revision",
        notes: "Went back over factorising before moving on. Most of the class is comfortable now.",
        importantPoints: "Redo any question you got wrong in the last worksheet.",
        materials: [
          {
            kind: "PRACTICE" as const,
            title: "Practice worksheet",
            body: "Twenty factorising questions, increasing in difficulty. Do at least ten.",
          },
        ],
      },
    ];

    // Written for every section, not just one: otherwise only the students in
    // whichever section happened to match would have anything to revise.
    for (const [index, plan] of TAUGHT.entries()) {
      const when = addDays(now, -(index + 1));
      if (dayOfWeek(when) === DayOfWeek.SUNDAY) continue;

      for (const sectionId of allSections) {
      const slot = await prisma.timetableSlot.findFirst({
        where: { schoolId: school.id, sectionId, dayOfWeek: dayOfWeek(when) },
        select: { id: true, teacherId: true },
      });
      if (!slot) continue;

      const lesson = await prisma.classSession.upsert({
        where: {
          schoolId_timetableSlotId_date: {
            schoolId: school.id,
            timetableSlotId: slot.id,
            date: when,
          },
        },
        create: {
          schoolId: school.id,
          timetableSlotId: slot.id,
          date: when,
          status: "COMPLETED",
          // The teacher the timetable names for that period, so the record is
          // attributed to whoever actually takes the class.
          scheduledTeacherId: slot.teacherId,
          actualTeacherId: slot.teacherId,
          topic: plan.topic,
          notes: plan.notes,
          importantPoints: plan.importantPoints,
        },
        update: {
          topic: plan.topic,
          notes: plan.notes,
          importantPoints: plan.importantPoints,
        },
        select: { id: true },
      });

      for (const material of plan.materials) {
        await prisma.lessonMaterial.create({
          data: {
            schoolId: school.id,
            classSessionId: lesson.id,
            kind: material.kind,
            title: material.title,
            body: material.body,
          },
        });
      }
      }
    }

    // One planned lesson, so "upcoming" is not an empty state.
    for (const sectionId of allSections) {
      for (let ahead = 1; ahead <= 7; ahead += 1) {
      const when = addDays(now, ahead);
      if (dayOfWeek(when) === DayOfWeek.SUNDAY) continue;
      const slot = await prisma.timetableSlot.findFirst({
        where: { schoolId: school.id, sectionId, dayOfWeek: dayOfWeek(when) },
        select: { id: true, teacherId: true },
      });
      if (!slot) continue;

      await prisma.classSession.upsert({
        where: {
          schoolId_timetableSlotId_date: {
            schoolId: school.id,
            timetableSlotId: slot.id,
            date: when,
          },
        },
        create: {
          schoolId: school.id,
          timetableSlotId: slot.id,
          date: when,
          status: "SCHEDULED",
          scheduledTeacherId: slot.teacherId,
          plannedTopic: "Quadratic equations — practice",
          preparation: "Review today's notes and attempt questions 1-5 before the class.",
        },
        update: {
          plannedTopic: "Quadratic equations — practice",
          preparation: "Review today's notes and attempt questions 1-5 before the class.",
        },
      });
      break;
      }
    }
  }

  // --- assessments and marks ------------------------------------------------
  // Three tests per section per subject taught, so the parent portal has a
  // trend to draw rather than a single point.
  const assessmentSubjects = [...subjects.entries()].slice(0, 3);
  for (const [sectionIndex, sectionId] of allSections.entries()) {
    const sectionStudents = students.filter((student) => student.sectionId === sectionId);
    if (sectionStudents.length === 0) continue;

    for (const [subjectName, subjectId] of assessmentSubjects) {
      const teacher = teachers.find((t) => t.subject === subjectName) ?? teachers[0];
      for (let round = 1; round <= 3; round += 1) {
        const maxMarks = 25;
        const assessment = await prisma.assessment.create({
          data: {
            schoolId: school.id,
            academicSessionId: session.id,
            sectionId,
            subjectId,
            teacherId: teacher?.id ?? null,
            name: `Unit test ${round}`,
            // Spread backwards so the newest is the most recent.
            date: addDays(now, -(3 - round) * 9 - 2 - sectionIndex),
            maxMarks,
          },
          select: { id: true },
        });

        for (const student of sectionStudents) {
          const roll = rng();
          // A few children miss a paper, which must read as "not sat" rather
          // than as a zero.
          const sat = roll > 0.08;
          await prisma.assessmentResult.create({
            data: {
              schoolId: school.id,
              assessmentId: assessment.id,
              studentId: student.id,
              marksObtained: sat ? Math.round(9 + rng() * (maxMarks - 9)) : null,
              remarks: sat ? null : "Absent",
            },
          });
        }
      }
    }
  }

  // --- salaries -------------------------------------------------------------
  // Entered for most staff but not all, because "not set yet" is the state the
  // office actually has to work through.
  for (const [index, teacher] of teachers.entries()) {
    if (index === teachers.length - 1) continue;
    await prisma.teacherSalary.create({
      data: {
        schoolId: school.id,
        teacherId: teacher.id,
        salaryType: "MONTHLY",
        amountMinor: (22_000 + index * 3_000) * 100,
        allowancesMinor: 2_000 * 100,
        deductionsMinor: 1_800 * 100,
        effectiveFrom: dateOnly(2026, 4, 1),
        recordedById: admin.id,
      },
    });
  }
  // One raise ahead of its date, so "scheduled" has an example.
  if (teachers[0]) {
    await prisma.teacherSalary.create({
      data: {
        schoolId: school.id,
        teacherId: teachers[0].id,
        salaryType: "MONTHLY",
        amountMinor: 26_000 * 100,
        allowancesMinor: 2_000 * 100,
        deductionsMinor: 1_800 * 100,
        effectiveFrom: addDays(now, 20),
        notes: "Annual review",
        recordedById: admin.id,
      },
    });
  }

  // --- fees ------------------------------------------------------------------
  const FEE_HEADS = [
    { name: "Tuition fee", note: "Charged for the full academic year", amount: 20_000 },
    { name: "Examination fee", note: null, amount: 3_000 },
    { name: "Activity fee", note: "Sports, clubs and events", amount: 2_000 },
    { name: "Transport fee", note: "Only for students using the school bus", amount: 5_000 },
  ];

  const heads = new Map<string, string>();
  for (const head of FEE_HEADS) {
    const created = await prisma.feeHead.create({
      data: { schoolId: school.id, name: head.name, note: head.note },
      select: { id: true },
    });
    heads.set(head.name, created.id);
  }

  // Charged per class, which is how a school bills, and with the amount scaling
  // by year so the figures are not all identical.
  let receiptSeq = 1000;
  for (const student of students) {
    const grade = students.indexOf(student);
    for (const head of FEE_HEADS) {
      // Transport only for some children, so the breakdown differs per family.
      if (head.name === "Transport fee" && grade % 3 !== 0) continue;
      await prisma.feeCharge.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          studentId: student.id,
          feeHeadId: heads.get(head.name)!,
          amountMinor: head.amount * 100,
          dueOn: addDays(now, head.name === "Tuition fee" ? 30 : 60),
        },
      });
    }

    // A spread of positions: some paid in full, some part-paid, some nothing.
    const owed = FEE_HEADS.filter(
      (head) => head.name !== "Transport fee" || grade % 3 === 0,
    ).reduce((sum, head) => sum + head.amount, 0);
    const pattern = grade % 3;
    const instalments = pattern === 0 ? [owed] : pattern === 1 ? [Math.round(owed / 2)] : [];

    for (const [index, amount] of instalments.entries()) {
      receiptSeq += 1;
      await prisma.feePayment.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          studentId: student.id,
          amountMinor: amount * 100,
          paidOn: addDays(now, -(20 - index * 10)),
          method: index === 0 ? "UPI" : "CASH",
          receiptNo: `REC-${receiptSeq}`,
          recordedById: admin.id,
        },
      });
    }
  }

  // --- notices and an event -------------------------------------------------
  await prisma.notice.createMany({
    data: [
      {
        schoolId: school.id,
        title: "Parent-teacher meeting on Saturday",
        body: "Please arrive by 10am. Demo notice.",
        audience: "PARENTS",
        status: "PUBLISHED",
        authorId: admin.id,
        publishAt: addDays(now, -2),
      },
      {
        schoolId: school.id,
        title: "Staff briefing moved to 8:30am",
        body: "For this week only. Demo notice.",
        audience: "TEACHERS",
        status: "PUBLISHED",
        authorId: admin.id,
        publishAt: addDays(now, -1),
      },
    ],
  });

  await prisma.event.create({
    data: {
      schoolId: school.id,
      title: "Annual sports day",
      description: "Demo event.",
      date: addDays(now, 10),
      startMinute: 9 * 60,
      endMinute: 13 * 60,
      location: "School ground",
      isPublished: true,
    },
  });

  const assessmentCount = await prisma.assessment.count({ where: { schoolId: school.id } });
  console.log(
    `  ${spec.name}: ${teachers.length} teachers, ${students.length} students, ` +
      `${spec.families.length} parents, ${allSections.length} sections, ` +
      `${assessmentCount} assessments`,
  );

  return credentials;
}

// -----------------------------------------------------------------------------
// The credential block written into .env
// -----------------------------------------------------------------------------

const BLOCK_START = "# --- DEMO LOGINS (generated by npm run db:seed:demo) ---";
const BLOCK_END = "# --- end demo logins ---";

function renderBlock(credentials: Credential[]): string {
  const lines = [
    BLOCK_START,
    "# Development accounts only. This file is gitignored.",
    `# Every account below uses the same password: ${DEMO_PASSWORD}`,
    "#",
    "# Sign in at /login — you land on your own dashboard automatically:",
    "#   SUPER_ADMIN  -> /super-admin/dashboard",
    "#   SCHOOL_ADMIN -> /school-admin/dashboard",
    "#   TEACHER      -> /teacher/dashboard",
    "#   PARENT       -> /parent/dashboard",
    "#",
  ];

  const order = ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT"];
  for (const role of order) {
    const group = credentials.filter((c) => c.role === role);
    if (!group.length) continue;
    lines.push(`# ${role}`);
    for (const c of group) lines.push(`#   ${c.email}   (${c.who})`);
    lines.push("#");
  }

  lines.push("# Student sign-in is not part of V1; the two above exist only so the");
  lines.push("# read-only student area can be checked.");
  lines.push(BLOCK_END);
  return lines.join("\n");
}

/** Replace any previous block rather than stacking a new one under it. */
function writeCredentialsToEnv(credentials: Credential[]): void {
  const path = ".env";
  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    console.log("  no .env found — printing the logins instead");
    return;
  }

  const block = renderBlock(credentials);
  const startIndex = existing.indexOf(BLOCK_START);

  if (startIndex === -1) {
    appendFileSync(path, `\n\n${block}\n`);
  } else {
    const endIndex = existing.indexOf(BLOCK_END);
    const after = endIndex === -1 ? "" : existing.slice(endIndex + BLOCK_END.length);
    writeFileSync(path, `${existing.slice(0, startIndex)}${block}${after}`);
  }
  console.log(`  logins written to ${path}`);
}

// -----------------------------------------------------------------------------

async function main() {
  console.log("Adding demo data. Nothing outside the demo schools is touched.\n");

  await clearPreviousDemo();

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const credentials: Credential[] = [await seedSuperAdmin(passwordHash)];

  for (const spec of SCHOOLS) {
    credentials.push(...(await seedSchool(spec, passwordHash)));
  }

  writeCredentialsToEnv(credentials);

  const kept = await prisma.school.findMany({
    where: { slug: { not: { startsWith: DEMO_SLUG_PREFIX } } },
    select: { name: true },
  });

  console.log(`\nPassword for every demo account: ${DEMO_PASSWORD}\n`);
  for (const role of ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT"]) {
    for (const c of credentials.filter((x) => x.role === role)) {
      console.log(`  ${role.padEnd(13)} ${c.email.padEnd(46)} ${c.who}`);
    }
  }
  if (kept.length) {
    console.log(`\nLeft untouched: ${kept.map((s) => s.name).join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
