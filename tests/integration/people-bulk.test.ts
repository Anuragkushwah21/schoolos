/**
 * People and bulk work: a parent is archived (never deleted) only once their
 * children have left; several students are put in a stream within its seats;
 * activation links go to every parent who has not activated — and none of it
 * reaches past the School Admin or across schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { assignStream } from "@/server/people/bulk-students";
import { listParents, parentsAwaitingActivation, resendParentActivations, setParentArchived } from "@/server/people/parents";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";
import { sentMail } from "../helpers/mail";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("archiving a parent", () => {
  it("is refused while a child is still at the school", async () => {
    await expect(setParentArchived(adminOf(schoolA), schoolA.parentId, true, null)).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps the record, closes the login, records it, and hides them from the list until restored", async () => {
    const schoolId = schoolA.schoolId;
    const user = await prisma.user.create({ data: { email: "left.family@people-test.test", passwordHash: "x", role: "PARENT", firstName: "Left", lastName: "Family", schoolId, activatedAt: new Date() } });
    const parent = await prisma.parent.create({ data: { schoolId, userId: user.id, firstName: "Left", lastName: "Family", phone: "9000011111" } });
    const child = await prisma.student.create({ data: { schoolId, admissionNumber: "LEFT-1", firstName: "Gone", lastName: "Family", status: "TRANSFERRED" } });
    await prisma.parentStudent.create({ data: { schoolId, parentId: parent.id, studentId: child.id, relationship: "FATHER" } });

    await expect(setParentArchived(teacherOf(schoolA), parent.id, true, null)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setParentArchived(adminOf(schoolB), parent.id, true, null)).rejects.toBeInstanceOf(NotFoundError);

    await setParentArchived(adminOf(schoolA), parent.id, true, "All children have left");
    expect((await prisma.parent.findUniqueOrThrow({ where: { id: parent.id } })).archivedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(false);
    // The family link and history are untouched.
    expect(await prisma.parentStudent.count({ where: { parentId: parent.id } })).toBe(1);
    expect(await prisma.statusChange.count({ where: { parentId: parent.id, kind: "STATUS", toValue: "ARCHIVED" } })).toBe(1);
    expect((await listParents(adminOf(schoolA), { q: "Left" })).rows.some((row) => row.id === parent.id)).toBe(false);
    expect((await listParents(adminOf(schoolA), { q: "Left", standing: "ARCHIVED" })).rows.some((row) => row.id === parent.id)).toBe(true);

    await setParentArchived(adminOf(schoolA), parent.id, false, null);
    expect((await prisma.parent.findUniqueOrThrow({ where: { id: parent.id } })).archivedAt).toBeNull();
  });
});

describe("bulk: assign a stream", () => {
  it("puts students in a stream within its seats, and only in shared sections", async () => {
    const schoolId = schoolA.schoolId;
    const science = await prisma.stream.create({ data: { schoolId, name: "Science (bulk)" } });
    const arts = await prisma.stream.create({ data: { schoolId, name: "Arts (bulk)" } });
    await prisma.section.update({ where: { id: schoolA.sectionId }, data: { capacity: 40 } });
    await prisma.sectionStream.createMany({
      data: [
        { schoolId, sectionId: schoolA.sectionId, streamId: science.id, capacity: 1 },
        { schoolId, sectionId: schoolA.sectionId, streamId: arts.id, capacity: 30 },
      ],
    });
    const [first, second] = schoolA.studentIds;

    // Two into a one-seat stream: refused, nothing changes.
    await expect(assignStream(adminOf(schoolA), { streamId: science.id, studentIds: [first!, second!] })).rejects.toThrow();
    expect(await prisma.studentEnrollment.count({ where: { studentId: { in: [first!, second!] }, streamId: science.id } })).toBe(0);

    expect(await assignStream(adminOf(schoolA), { streamId: science.id, studentIds: [first!] })).toEqual({ assigned: 1 });
    expect(await assignStream(adminOf(schoolA), { streamId: arts.id, studentIds: [second!] })).toEqual({ assigned: 1 });
    // Already there: nothing to do.
    expect(await assignStream(adminOf(schoolA), { streamId: science.id, studentIds: [first!] })).toEqual({ assigned: 0 });

    await expect(assignStream(teacherOf(schoolA), { streamId: arts.id, studentIds: [first!] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignStream(adminOf(schoolA), { streamId: arts.id, studentIds: [schoolB.studentIds[0]!] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignStream(adminOf(schoolB), { streamId: arts.id, studentIds: [first!] })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("bulk: resend activation links", () => {
  it("sends one fresh link to each parent who has not activated, for the School Admin only", async () => {
    const schoolId = schoolA.schoolId;
    const user = await prisma.user.create({ data: { email: "pending.parent@people-test.test", passwordHash: "x", role: "PARENT", firstName: "Pending", lastName: "Parent", schoolId } });
    await prisma.parent.create({ data: { schoolId, userId: user.id, firstName: "Pending", lastName: "Parent", phone: "9000022222", email: "pending.parent@people-test.test" } });

    const awaiting = await parentsAwaitingActivation(adminOf(schoolA));
    expect(awaiting.some((row) => row.user?.email === "pending.parent@people-test.test")).toBe(true);
    await expect(resendParentActivations(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);

    const before = sentMail.filter((mail) => mail.to === "pending.parent@people-test.test").length;
    const result = await resendParentActivations(adminOf(schoolA));
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(sentMail.filter((mail) => mail.to === "pending.parent@people-test.test").length).toBe(before + 1);
    // School B's resend never reaches School A's parents.
    const beforeB = sentMail.length;
    await resendParentActivations(adminOf(schoolB));
    expect(sentMail.slice(beforeB).some((mail) => mail.to === "pending.parent@people-test.test")).toBe(false);
  });
});
