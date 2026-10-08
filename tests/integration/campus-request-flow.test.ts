/**
 * The campus request, end to end, as the people involved see it:
 *
 *   School Admin opens Campus Management → submits a request → it appears in
 *   the Super Admin's queue → corrections are allowed only while pending →
 *   the Super Admin modifies & approves (or rejects) → the requester sees the
 *   status, the approved configuration and the history → the campus is
 *   provisioned exactly once, empty, and campus A's people get no access to it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { campusRequestSchema } from "@/lib/validation/campuses";
import type { SessionUser } from "@/server/auth/session";
import { createSession, validateSessionToken } from "@/server/auth/session";
import {
  approveCampusRequest,
  campusRequestOverview,
  getCampusRequest,
  getMyCampusRequest,
  listCampusRequests,
  markCampusRequestUnderReview,
  rejectCampusRequest,
  submitCampusRequest,
  updateCampusRequest,
} from "@/server/campuses/requests";
import { prisma } from "@/server/db/prisma";
import { ensureOrganization, myOrganization, switchCampus } from "@/server/platform/campuses";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "flow-test";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;

const input = (overrides: Record<string, unknown> = {}) =>
  campusRequestSchema.parse({ name: `${PREFIX} Sunrise Junior`, city: "Indore", state: "Madhya Pradesh", contactName: "Bhanu", contactEmail: `bhanu@${PREFIX}.test`, contactPhone: "+91 98765 43210", modules: ["FINANCE", "TRANSPORT"], roles: ["PRINCIPAL", "ACCOUNTANT"], notes: "Opening in April", ...overrides });

async function orgIds() {
  return (await prisma.school.findMany({ where: { id: { in: [schoolA.schoolId, schoolB.schoolId] } }, select: { organizationId: true } })).flatMap((row) => (row.organizationId ? [row.organizationId] : []));
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  const user = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "Platform", lastName: "Admin" } });
  superAdmin = { id: user.id, email: user.email, role: "SUPER_ADMIN", firstName: "Platform", lastName: "Admin", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  // No live plan: limits come from the organization; campus A has all optional modules and roles.
  await prisma.organization.update({ where: { id: await ensureOrganization(schoolA.schoolId) }, data: { campusLimitOverride: 3 } });
}, 60_000);

afterAll(async () => {
  const orgs = await orgIds();
  await prisma.school.deleteMany({ where: { organizationId: { in: orgs }, id: { notIn: [schoolA.schoolId, schoolB.schoolId] } } });
  await destroyIsolationFixture();
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  await prisma.$disconnect();
});

describe("campus request, end to end", () => {
  let requestId: string;

  it("1–2. the School Admin opens Campus Management and submits a request", async () => {
    const overview = await campusRequestOverview(adminOf(schoolA));
    expect(overview.canRequest).toBe(true);
    expect(overview.plan.modules.length).toBeGreaterThan(0);
    ({ id: requestId } = await submitCampusRequest(adminOf(schoolA), input(), { STUDENTS: 300, PRINCIPAL: 1 }));
    const mine = await getMyCampusRequest(adminOf(schoolA), requestId);
    expect(mine).toMatchObject({ status: "PENDING", editable: true, requestedModules: ["FINANCE", "TRANSPORT"], approvedModules: [] });
    expect(mine.history.map((entry) => entry.action)).toEqual(["CAMPUS_REQUEST_CREATED"]);
  });

  it("refuses a duplicate open request for the same school, and a name that is already a campus", async () => {
    await expect(submitCampusRequest(adminOf(schoolA), input({ name: `${PREFIX} SUNRISE junior` }), {})).rejects.toThrow(/already an open request/);
    await expect(submitCampusRequest(adminOf(schoolA), input({ name: "Isolation Test School A" }), {})).rejects.toThrow(/already one of your schools/);
  });

  it("another school cannot see or change the request", async () => {
    await expect(getMyCampusRequest(adminOf(schoolB), requestId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCampusRequest(adminOf(schoolB), requestId, input(), {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMyCampusRequest(teacherOf(schoolA), requestId)).rejects.toThrow();
  });

  it("can be corrected while pending, and is frozen once the Super Admin takes it up", async () => {
    await updateCampusRequest(adminOf(schoolA), requestId, input({ city: "Bhopal" }), { STUDENTS: 350 });
    expect(await prisma.campusRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ city: "Bhopal", requestedLimits: { STUDENTS: 350 } });

    // 3. In the Super Admin's queue.
    expect((await listCampusRequests(superAdmin, "PENDING")).map((row) => row.id)).toContain(requestId);
    await markCampusRequestUnderReview(superAdmin, requestId);
    await expect(updateCampusRequest(adminOf(schoolA), requestId, input({ city: "Ujjain" }), {})).rejects.toBeInstanceOf(ConflictError);
    expect((await getMyCampusRequest(adminOf(schoolA), requestId)).editable).toBe(false);
  });

  it("4–6. modify & approve: the requester sees the approved configuration; the campus is provisioned once, empty", async () => {
    const detail = await getCampusRequest(superAdmin, requestId);
    expect(detail.organization.schools.map((school) => school.id)).toContain(schoolA.schoolId);

    const { schoolId, status } = await approveCampusRequest(superAdmin, requestId, { modules: ["FINANCE"], roles: ["PRINCIPAL", "ACCOUNTANT"], limits: { STUDENTS: 300, PRINCIPAL: 1 }, reviewNote: "Transport after the first term" });
    expect(status).toBe("MODIFIED");
    await expect(approveCampusRequest(superAdmin, requestId, { modules: [], roles: [], limits: {}, reviewNote: null })).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.campusRequest.count({ where: { createdSchoolId: schoolId } })).toBe(1);
    expect(await prisma.school.count({ where: { name: `${PREFIX} Sunrise Junior` } })).toBe(1);

    const mine = await getMyCampusRequest(adminOf(schoolA), requestId);
    expect(mine).toMatchObject({ status: "MODIFIED", requestedModules: ["FINANCE", "TRANSPORT"], approvedModules: ["FINANCE"], approvedLimits: { STUDENTS: 300, PRINCIPAL: 1 }, reviewNote: "Transport after the first term", createdSchool: { id: schoolId, status: "ACTIVE" } });
    expect(mine.history.map((entry) => entry.action)).toEqual(["CAMPUS_REQUEST_CREATED", "CAMPUS_REQUEST_UPDATED", "CAMPUS_REQUEST_UNDER_REVIEW", "CAMPUS_REQUEST_MODIFIED"]);
    expect(mine.history.at(-1)?.by).toBe("SchoolOS");

    const fresh = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { _count: { select: { students: true, teachers: true, parents: true, users: true, feeCharges: true, studentAttendance: true } } } });
    expect(fresh._count).toEqual({ students: 0, teachers: 0, parents: 0, users: 0, feeCharges: 0, studentAttendance: 0 });
    expect((await myOrganization((await validateSessionToken((await createSession(schoolA.adminUserId)).token))!)).schools.map((school) => school.id)).toContain(schoolId);
  });

  it("a rejection, with its reason, is what the requester sees", async () => {
    const { id } = await submitCampusRequest(adminOf(schoolA), input({ name: `${PREFIX} Hill View` }), {});
    await rejectCampusRequest(superAdmin, id, "Land documents are pending");
    const mine = await getMyCampusRequest(adminOf(schoolA), id);
    expect(mine).toMatchObject({ status: "REJECTED", rejectionReason: "Land documents are pending", editable: false, createdSchool: null });
    await expect(updateCampusRequest(adminOf(schoolA), id, input({ name: `${PREFIX} Hill View` }), {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("7–8. existing data is untouched, and only the owner reaches the new campus", async () => {
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId } })).toBe(3);
    const created = await prisma.school.findFirstOrThrow({ where: { name: `${PREFIX} Sunrise Junior` }, select: { id: true } });
    // Campus A's teacher and a second admin keep only campus A.
    const teacher = await validateSessionToken((await createSession(schoolA.teacherUserId)).token);
    expect(teacher?.schoolId).toBe(schoolA.schoolId);
    const second = await prisma.user.create({ data: { email: `admin2@${PREFIX}.test`, passwordHash: "x", role: "SCHOOL_ADMIN", firstName: "Second", lastName: "Admin", schoolId: schoolA.schoolId } });
    const token = (await createSession(second.id)).token;
    const secondUser = (await validateSessionToken(token))!;
    await expect(switchCampus(secondUser, token, created.id)).rejects.toThrow(/only switch to your own/);
    // The owner can.
    const ownerToken = (await createSession(schoolA.adminUserId)).token;
    const ownerUser = (await validateSessionToken(ownerToken))!;
    await switchCampus(ownerUser, ownerToken, created.id);
    expect((await validateSessionToken(ownerToken))?.schoolId).toBe(created.id);
    // A teacher of A placed in A cannot be addressed in the new campus.
    const inNew = contextFor({ ...schoolA, schoolId: created.id }, schoolA.teacherUserId, "TEACHER");
    expect(await inNew.db.teacher.count()).toBe(0);
  });
});
