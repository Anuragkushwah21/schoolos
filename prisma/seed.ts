/**
 * Development seed.
 *
 * Creates two fully-populated schools so that tenant isolation can be
 * exercised by hand as well as by the test suite: anything you can see as
 * ABC's admin, you must NOT be able to see as XYZ's.
 *
 * Every person here is invented. Credentials are obviously fake and this
 * script refuses to run against NODE_ENV=production.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import {
  AttendanceStatus,
  DayOfWeek,
  Gender,
  NoticeAudience,
  NoticeStatus,
  ParentRelationship,
  PlanTier,
  PrismaClient,
  SchoolStatus,
  SubscriptionStatus,
  TeacherAttendanceStatus,
  UserRole,
} from "../src/generated/prisma/client";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run the development seed against production.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

/**
 * This seed WIPES every table before it writes. `NODE_ENV` is not enough of a
 * guard once a real database is a comment away in `.env`, so the host has to
 * be local too. Overriding is deliberate and loud.
 */
const host = new URL(connectionString).hostname;
const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

if (!isLocal && process.env.ALLOW_REMOTE_SEED !== "yes-wipe-it") {
  throw new Error(
    [
      `Refusing to seed "${host}": this script deletes every row first.`,
      "",
      "If you really mean to wipe that database, run:",
      "  ALLOW_REMOTE_SEED=yes-wipe-it npm run db:seed",
    ].join("\n"),
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** The one shared development password. Obviously not a real secret. */
const DEV_PASSWORD = "Password123!";

const GRADES: Array<{ name: string; level: number }> = [
  { name: "Nursery", level: -3 },
  { name: "LKG", level: -2 },
  { name: "UKG", level: -1 },
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `Class ${i + 1}`,
    level: i + 1,
  })),
];

const SUBJECTS = [
  { name: "Mathematics", code: "MATH" },
  { name: "Science", code: "SCI" },
  { name: "English", code: "ENG" },
  { name: "Hindi", code: "HIN" },
  { name: "Social Studies", code: "SST" },
  { name: "Computer Science", code: "CS" },
];

const STREAMS = ["Science", "Commerce", "Arts"];

/** Deterministic pseudo-randomness, so reseeding produces the same data. */
function makeRng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function minutes(hour: number, minute = 0) {
  return hour * 60 + minute;
}

/** A UTC midnight Date, matching how `@db.Date` columns are stored. */
function dateOnly(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

async function wipe() {
  // Ordered child-to-parent: intra-tenant relations use NO ACTION, so a parent
  // cannot be removed while its children still reference it.
  await prisma.auditLog.deleteMany();
  await prisma.studentAttendance.deleteMany();
  await prisma.teacherAttendance.deleteMany();
  await prisma.classSession.deleteMany();
  await prisma.timetableSlot.deleteMany();
  await prisma.teacherSubjectAssignment.deleteMany();
  await prisma.parentStudent.deleteMany();
  await prisma.studentEnrollment.deleteMany();
  await prisma.admissionApplication.deleteMany();
  await prisma.student.deleteMany();
  await prisma.parent.deleteMany();
  await prisma.section.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.stream.deleteMany();
  await prisma.class.deleteMany();
  await prisma.academicSession.deleteMany();
  await prisma.notice.deleteMany();
  await prisma.event.deleteMany();
  await prisma.schoolPage.deleteMany();
  await prisma.schoolMedia.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.platformOffer.deleteMany();
}

async function seedPlans() {
  const plans = [
    {
      tier: PlanTier.STARTER,
      name: "Starter",
      description: "For small schools getting started.",
      priceMinor: 1500000,
      maxStudents: 300,
      maxTeachers: 25,
      maxAdmins: 2,
      storageMb: 2048,
    },
    {
      tier: PlanTier.STANDARD,
      name: "Standard",
      description: "For growing schools with multiple sections per class.",
      priceMinor: 3500000,
      maxStudents: 1200,
      maxTeachers: 80,
      maxAdmins: 5,
      storageMb: 10240,
    },
    {
      tier: PlanTier.PRO,
      name: "Pro",
      description: "Unlimited scale for large institutions.",
      priceMinor: 7500000,
      maxStudents: null,
      maxTeachers: null,
      maxAdmins: null,
      storageMb: null,
    },
  ];

  return Promise.all(plans.map((data) => prisma.plan.create({ data })));
}

async function seedPlatform(passwordHash: string) {
  const superAdmin = await prisma.user.create({
    data: {
      email: "superadmin@schoolos.test",
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      firstName: "Platform",
      lastName: "Owner",
      schoolId: null,
    },
  });

  await prisma.platformOffer.create({
    data: {
      title: "Launch Offer",
      description: "Complete school management software, first year.",
      priceLabel: "Rs 35,000/year",
      ctaLabel: "Get Started",
      ctaHref: "/register",
      startsAt: dateOnly(2026, 1, 1),
      endsAt: dateOnly(2027, 3, 31),
      isActive: true,
    },
  });

  // An offer that has already lapsed, so the "expired offers stop showing"
  // rule has something to be tested against.
  await prisma.platformOffer.create({
    data: {
      title: "Early Bird 2025",
      description: "Expired promotion retained to verify date filtering.",
      priceLabel: "Rs 25,000/year",
      startsAt: dateOnly(2025, 1, 1),
      endsAt: dateOnly(2025, 12, 31),
      isActive: true,
    },
  });

  return superAdmin;
}

type SchoolSpec = {
  slug: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  adminEmail: string;
  adminFirst: string;
  adminLast: string;
  teachers: Array<{ first: string; last: string; subject: string }>;
  families: Array<{
    surname: string;
    parentFirst: string;
    relationship: ParentRelationship;
    children: Array<{ first: string; gender: Gender; grade: string }>;
  }>;
  rngSeed: number;
};

async function seedSchool(spec: SchoolSpec, passwordHash: string, planId: string) {
  const rng = makeRng(spec.rngSeed);

  const school = await prisma.school.create({
    data: {
      slug: spec.slug,
      name: spec.name,
      shortName: spec.shortName,
      status: SchoolStatus.ACTIVE,
      contactName: `${spec.adminFirst} ${spec.adminLast}`,
      contactEmail: spec.adminEmail,
      contactPhone: "+91-99000-00000",
      about: `${spec.name} is a co-educational school in ${spec.city}. This description is development seed data.`,
      principalName: `${spec.adminFirst} ${spec.adminLast}`,
      principalMessage:
        "We aim to make sure no child loses a day of learning. (Seed content.)",
      establishedYear: 1998,
      affiliationBoard: "CBSE",
      email: `office@${spec.slug}.test`,
      phone: "+91-99000-00001",
      addressLine: "1 Example Road",
      city: spec.city,
      state: spec.state,
      postalCode: "000000",
      contactEmailVerifiedAt: new Date(),
      reviewedAt: new Date(),
    },
  });

  await prisma.subscription.create({
    data: {
      schoolId: school.id,
      planId,
      status: SubscriptionStatus.ACTIVE,
      startsAt: dateOnly(2026, 4, 1),
      endsAt: dateOnly(2027, 3, 31),
    },
  });

  const adminUser = await prisma.user.create({
    data: {
      email: spec.adminEmail,
      passwordHash,
      role: UserRole.SCHOOL_ADMIN,
      firstName: spec.adminFirst,
      lastName: spec.adminLast,
      schoolId: school.id,
    },
  });

  // --- academic sessions: last year (history) and this year (current) ---
  const previousSession = await prisma.academicSession.create({
    data: {
      schoolId: school.id,
      name: "2025-26",
      startDate: dateOnly(2025, 4, 1),
      endDate: dateOnly(2026, 3, 31),
      isCurrent: false,
    },
  });

  const currentSession = await prisma.academicSession.create({
    data: {
      schoolId: school.id,
      name: "2026-27",
      startDate: dateOnly(2026, 4, 1),
      endDate: dateOnly(2027, 3, 31),
      isCurrent: true,
    },
  });

  // --- classes, streams, subjects ---
  const classes = new Map<string, string>();
  for (const grade of GRADES) {
    const created = await prisma.class.create({
      data: { schoolId: school.id, name: grade.name, level: grade.level },
    });
    classes.set(grade.name, created.id);
  }

  const streams = new Map<string, string>();
  for (const name of STREAMS) {
    const created = await prisma.stream.create({
      data: { schoolId: school.id, name },
    });
    streams.set(name, created.id);
  }

  const subjects = new Map<string, string>();
  for (const subject of SUBJECTS) {
    const created = await prisma.subject.create({
      data: { schoolId: school.id, name: subject.name, code: subject.code },
    });
    subjects.set(subject.name, created.id);
  }

  // --- teachers ---
  const teachers = [];
  for (const [index, t] of spec.teachers.entries()) {
    const user = await prisma.user.create({
      data: {
        email: `${t.first}.${t.last}.${spec.slug}@schoolos.test`.toLowerCase(),
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
        email: user.email,
        phone: `+91-98000-000${String(index + 10)}`,
        qualification: "M.Sc., B.Ed.",
        joiningDate: dateOnly(2019, 6, 1),
      },
    });

    teachers.push({ ...teacher, subjectName: t.subject });
  }

  // --- sections for the grades that actually have students ---
  const usedGrades = new Set(
    spec.families.flatMap((f) => f.children.map((c) => c.grade)),
  );

  const sections = new Map<string, string>();
  for (const [index, gradeName] of [...usedGrades].entries()) {
    const classId = classes.get(gradeName);
    if (!classId) continue;

    const grade = GRADES.find((g) => g.name === gradeName);
    // Senior classes carry a stream; junior classes do not.
    const streamId =
      grade && grade.level >= 11 ? (streams.get("Science") ?? null) : null;

    for (const sessionRow of [previousSession, currentSession]) {
      const section = await prisma.section.create({
        data: {
          schoolId: school.id,
          academicSessionId: sessionRow.id,
          classId,
          streamId,
          name: "A",
          capacity: 40,
          classTeacherId: teachers[index % teachers.length]?.id ?? null,
        },
      });

      if (sessionRow.id === currentSession.id) {
        sections.set(gradeName, section.id);
      }
    }
  }

  // --- teacher subject assignments (current session) ---
  for (const teacher of teachers) {
    const subjectId = subjects.get(teacher.subjectName);
    if (!subjectId) continue;

    for (const sectionId of sections.values()) {
      await prisma.teacherSubjectAssignment.create({
        data: {
          schoolId: school.id,
          academicSessionId: currentSession.id,
          teacherId: teacher.id,
          subjectId,
          sectionId,
        },
      });
    }
  }

  // --- families: one parent row per family, linked to every sibling ---
  let admissionCounter = 1;
  const students: Array<{ id: string; sectionId: string }> = [];

  for (const family of spec.families) {
    const parentUser = await prisma.user.create({
      data: {
        email: `${family.parentFirst}.${family.surname}.${spec.slug}@schoolos.test`.toLowerCase(),
        passwordHash,
        role: UserRole.PARENT,
        firstName: family.parentFirst,
        lastName: family.surname,
        schoolId: school.id,
      },
    });

    const parent = await prisma.parent.create({
      data: {
        schoolId: school.id,
        userId: parentUser.id,
        firstName: family.parentFirst,
        lastName: family.surname,
        email: parentUser.email,
        phone: `+91-97000-${String(1000 + admissionCounter)}`,
        occupation: "Self-employed",
      },
    });

    for (const child of family.children) {
      const sectionId = sections.get(child.grade);
      const classId = classes.get(child.grade);
      if (!sectionId || !classId) continue;

      const admissionNumber = `ADM${String(admissionCounter).padStart(4, "0")}`;

      const studentUser = await prisma.user.create({
        data: {
          email: `${child.first}.${family.surname}.${admissionCounter}.${spec.slug}@schoolos.test`.toLowerCase(),
          passwordHash,
          role: UserRole.STUDENT,
          firstName: child.first,
          lastName: family.surname,
          schoolId: school.id,
        },
      });

      const student = await prisma.student.create({
        data: {
          schoolId: school.id,
          userId: studentUser.id,
          admissionNumber,
          firstName: child.first,
          lastName: family.surname,
          gender: child.gender,
          dateOfBirth: dateOnly(2012, ((admissionCounter % 12) + 1), 15),
          admissionDate: dateOnly(2023, 4, 10),
          addressLine: "2 Example Lane",
          city: spec.city,
          state: spec.state,
          emergencyContactName: `${family.parentFirst} ${family.surname}`,
          emergencyContactPhone: parent.phone,
        },
      });

      await prisma.parentStudent.create({
        data: {
          schoolId: school.id,
          parentId: parent.id,
          studentId: student.id,
          relationship: family.relationship,
          isPrimary: true,
        },
      });

      await prisma.studentEnrollment.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          academicSessionId: currentSession.id,
          classId,
          sectionId,
          rollNumber: String(admissionCounter),
          enrolledOn: dateOnly(2026, 4, 5),
        },
      });

      students.push({ id: student.id, sectionId });
      admissionCounter += 1;
    }
  }

  // --- timetable: Monday-Friday, four periods a day, for each section ---
  const periodStarts = [minutes(9), minutes(10), minutes(11), minutes(12)];
  const weekdays = [
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
  ];

  for (const [sectionIndex, sectionId] of [...sections.values()].entries()) {
    for (const [dayIndex, day] of weekdays.entries()) {
      for (const [periodIndex, start] of periodStarts.entries()) {
        // Rotate teachers so no teacher is double-booked at the same
        // day/time across sections — the schema forbids it outright.
        const teacher =
          teachers[(sectionIndex + periodIndex) % teachers.length];
        if (!teacher) continue;

        const subjectId = subjects.get(teacher.subjectName);
        if (!subjectId) continue;

        await prisma.timetableSlot.create({
          data: {
            schoolId: school.id,
            academicSessionId: currentSession.id,
            sectionId,
            subjectId,
            teacherId: teacher.id,
            dayOfWeek: day,
            startMinute: start,
            endMinute: start + 55,
            room: `R${sectionIndex + 1}0${dayIndex + 1}`,
          },
        });
      }
    }
  }

  // --- attendance for the last five weekdays ---
  const today = dateOnly(2026, 9, 18);
  const attendanceDates: Date[] = [];
  for (let offset = 0; attendanceDates.length < 5; offset += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - offset);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) attendanceDates.push(day);
  }

  for (const date of attendanceDates) {
    for (const student of students) {
      const roll = rng();
      const status =
        roll > 0.92
          ? AttendanceStatus.ABSENT
          : roll > 0.87
            ? AttendanceStatus.LATE
            : AttendanceStatus.PRESENT;

      await prisma.studentAttendance.create({
        data: {
          schoolId: school.id,
          academicSessionId: currentSession.id,
          studentId: student.id,
          sectionId: student.sectionId,
          date,
          status,
          markedByUserId: adminUser.id,
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
          status:
            roll > 0.95
              ? TeacherAttendanceStatus.ON_LEAVE
              : TeacherAttendanceStatus.PRESENT,
          checkInTime: new Date(`${date.toISOString().slice(0, 10)}T08:45:00Z`),
          checkOutTime: new Date(`${date.toISOString().slice(0, 10)}T15:30:00Z`),
        },
      });
    }
  }

  // --- notices, events, public pages ---
  await prisma.notice.createMany({
    data: [
      {
        schoolId: school.id,
        title: "Annual Day rehearsals begin Monday",
        body: "Rehearsals will be held during the last period. (Seed content.)",
        audience: NoticeAudience.ALL,
        status: NoticeStatus.PUBLISHED,
        isPublic: true,
        publishAt: dateOnly(2026, 9, 14),
        authorId: adminUser.id,
      },
      {
        schoolId: school.id,
        title: "Staff meeting on Friday",
        body: "All teaching staff to assemble in the staff room. (Seed content.)",
        audience: NoticeAudience.TEACHERS,
        status: NoticeStatus.PUBLISHED,
        isPublic: false,
        publishAt: dateOnly(2026, 9, 16),
        authorId: adminUser.id,
      },
      {
        schoolId: school.id,
        title: "Draft: revised fee schedule",
        body: "Not yet published. (Seed content.)",
        audience: NoticeAudience.PARENTS,
        status: NoticeStatus.DRAFT,
        isPublic: false,
        authorId: adminUser.id,
      },
    ],
  });

  await prisma.event.createMany({
    data: [
      {
        schoolId: school.id,
        title: "Annual Sports Day",
        description: "Track and field events for all classes. (Seed content.)",
        date: dateOnly(2026, 11, 14),
        startMinute: minutes(8),
        endMinute: minutes(14),
        location: "School Ground",
        isPublished: true,
      },
      {
        schoolId: school.id,
        title: "Parent-Teacher Meeting",
        description: "Term one progress review. (Seed content.)",
        date: dateOnly(2026, 10, 10),
        startMinute: minutes(9),
        endMinute: minutes(13),
        location: "Main Block",
        isPublished: true,
      },
    ],
  });

  await prisma.schoolPage.createMany({
    data: [
      {
        schoolId: school.id,
        slug: "about",
        title: "About Us",
        body: `${spec.name} has served ${spec.city} since 1998. (Seed content.)`,
        isPublished: true,
        sortOrder: 1,
      },
      {
        schoolId: school.id,
        slug: "academics",
        title: "Academics",
        body: "We teach Nursery through Class 12, with streams from Class 11. (Seed content.)",
        isPublished: true,
        sortOrder: 2,
      },
      {
        schoolId: school.id,
        slug: "facilities",
        title: "Facilities",
        body: "Library, science labs, computer lab and playground. (Seed content.)",
        isPublished: true,
        sortOrder: 3,
      },
    ],
  });

  await prisma.auditLog.create({
    data: {
      actorId: null,
      schoolId: school.id,
      action: "SCHOOL_APPROVED",
      entityType: "School",
      entityId: school.id,
      summary: `Super Admin approved ${spec.name}.`,
    },
  });

  return { school, adminUser, currentSession, previousSession, students };
}

const SCHOOL_A: SchoolSpec = {
  slug: "abc-public-school",
  name: "ABC Public School",
  shortName: "ABC",
  city: "Indore",
  state: "Madhya Pradesh",
  adminEmail: "admin@abc-public-school.test",
  adminFirst: "Asha",
  adminLast: "Verma",
  rngSeed: 11,
  teachers: [
    { first: "Rahul", last: "Sharma", subject: "Mathematics" },
    { first: "Priya", last: "Nair", subject: "Science" },
    { first: "Imran", last: "Sheikh", subject: "English" },
    { first: "Neha", last: "Gupta", subject: "Hindi" },
  ],
  families: [
    {
      surname: "Kulkarni",
      parentFirst: "Sanjay",
      relationship: ParentRelationship.FATHER,
      children: [
        { first: "Aarav", gender: Gender.MALE, grade: "Class 10" },
        { first: "Ananya", gender: Gender.FEMALE, grade: "Class 8" },
      ],
    },
    {
      surname: "Bose",
      parentFirst: "Rupa",
      relationship: ParentRelationship.MOTHER,
      children: [
        { first: "Ishaan", gender: Gender.MALE, grade: "Class 10" },
        { first: "Meera", gender: Gender.FEMALE, grade: "Class 10" },
        { first: "Kabir", gender: Gender.MALE, grade: "Class 5" },
      ],
    },
    {
      surname: "Menon",
      parentFirst: "Deepak",
      relationship: ParentRelationship.FATHER,
      children: [
        { first: "Diya", gender: Gender.FEMALE, grade: "Class 11" },
        { first: "Sara", gender: Gender.FEMALE, grade: "Class 10" },
      ],
    },
    {
      surname: "Chauhan",
      parentFirst: "Leela",
      relationship: ParentRelationship.GUARDIAN,
      children: [{ first: "Vivaan", gender: Gender.MALE, grade: "Class 8" }],
    },
  ],
};

const SCHOOL_B: SchoolSpec = {
  slug: "xyz-high-school",
  name: "XYZ High School",
  shortName: "XYZ",
  city: "Bhopal",
  state: "Madhya Pradesh",
  adminEmail: "admin@xyz-high-school.test",
  adminFirst: "Farhan",
  adminLast: "Qureshi",
  rngSeed: 29,
  teachers: [
    { first: "Anita", last: "Rao", subject: "Mathematics" },
    { first: "Vikram", last: "Singh", subject: "Social Studies" },
    { first: "Latha", last: "Iyer", subject: "Computer Science" },
  ],
  families: [
    {
      surname: "Pillai",
      parentFirst: "Geeta",
      relationship: ParentRelationship.MOTHER,
      children: [
        { first: "Rohan", gender: Gender.MALE, grade: "Class 9" },
        { first: "Tara", gender: Gender.FEMALE, grade: "Class 7" },
      ],
    },
    {
      surname: "Dsouza",
      parentFirst: "Maria",
      relationship: ParentRelationship.MOTHER,
      children: [{ first: "Alia", gender: Gender.FEMALE, grade: "Class 9" }],
    },
    {
      surname: "Yadav",
      parentFirst: "Ramesh",
      relationship: ParentRelationship.FATHER,
      children: [
        { first: "Arjun", gender: Gender.MALE, grade: "Class 12" },
        { first: "Nisha", gender: Gender.FEMALE, grade: "Class 9" },
      ],
    },
  ],
};

async function main() {
  console.log("Seeding development data...");
  await wipe();

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  const plans = await seedPlans();
  const standard = plans.find((p) => p.tier === PlanTier.STANDARD) ?? plans[0]!;
  const starter = plans.find((p) => p.tier === PlanTier.STARTER) ?? plans[0]!;

  await seedPlatform(passwordHash);

  const a = await seedSchool(SCHOOL_A, passwordHash, standard.id);
  const b = await seedSchool(SCHOOL_B, passwordHash, starter.id);

  // A school still awaiting review, so the Super Admin approval queue is not
  // empty on first run.
  await prisma.school.create({
    data: {
      slug: "sunrise-academy",
      name: "Sunrise Academy",
      status: SchoolStatus.PENDING,
      contactName: "Pending Applicant",
      contactEmail: "apply@sunrise-academy.test",
      contactPhone: "+91-96000-00002",
      // Left unverified on purpose: the registration flow has something to
      // demonstrate, and the review screen something to refuse.
      city: "Gwalior",
      state: "Madhya Pradesh",
    },
  });

  const counts = {
    schools: await prisma.school.count(),
    users: await prisma.user.count(),
    students: await prisma.student.count(),
    teachers: await prisma.teacher.count(),
    parents: await prisma.parent.count(),
    timetableSlots: await prisma.timetableSlot.count(),
    studentAttendance: await prisma.studentAttendance.count(),
  };

  console.log("\nSeed complete.");
  console.table(counts);
  console.log(`
  ${a.school.name}: ${SCHOOL_A.adminEmail}
  ${b.school.name}: ${SCHOOL_B.adminEmail}
  Super Admin:      superadmin@schoolos.test
  Password for all: ${DEV_PASSWORD}
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
