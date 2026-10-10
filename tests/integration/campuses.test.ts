/**
 * Owners, campuses and campus requests.
 *
 *   * A single-school owner sees no multi-campus: one campus, nothing to
 *     switch, and a request is refused with the plan's limit.
 *   * With the plan allowing more, a request is checked against the plan
 *     (modules, roles, limits), reviewed, rejected with a reason, or approved
 *     as asked / modified — keeping what was asked beside what was approved —
 *     and only approval creates the campus.
 *   * The Owner switches campuses (checked on every request), sees an All
 *     Campuses summary; a tampered campus id falls back home; another owner's
 *     campus is refused.
 *   * Each campus keeps its own data, roles and limits; disabled modules and
 *     roles are refused; the campus limit cannot be bypassed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { campusRequestSchema } from "@/lib/validation/campuses";
import type { TenantContext } from "@/server/auth/current-user";
import { createSession, hashSessionToken, type SessionUser, validateSessionToken } from "@/server/auth/session";
import {
  approveCampusRequest,
  assertOwnsRequest,
  campusRequestOverview,
  listCampusRequests,
  markCampusRequestUnderReview,
  rejectCampusRequest,
  submitCampusRequest,
} from "@/server/campuses/requests";
import { prisma } from "@/server/db/prisma";
import { createFeeHead } from "@/server/finance/fees";
import { createPrincipal } from "@/server/people/principals";
import { listStudents } from "@/server/people/students";
import { allCampusesSummary, myOrganization, setCampusLimitOverride, switchableCampuses, switchCampus } from "@/server/platform/campuses";
import { forSchool } from "@/server/tenancy/scope";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

const PREFIX = "campus-test";
let schoolA: SeededSchool;
let schoolB: SeededSchool;
let superAdmin: SessionUser;
let ownerToken: string;
let owner: SessionUser;
let planId: string;
let planBefore: { campusLimit: number; availableRoles: string[]; optionalModules: string[]; maxStudents: number | null; roleLimits: unknown };
let newCampusId: string;

const request = (overrides: Record<string, unknown> = {}) =>
  campusRequestSchema.parse({ name: `${PREFIX} XYZ Public School`, city: "Jaipur", state: "Rajasthan", contactName: "Bhanu Pratap", contactEmail: `xyz@${PREFIX}.test`, contactPhone: "+91 98765 43210", modules: ["FINANCE", "TRANSPORT"], roles: ["PRINCIPAL", "ACCOUNTANT"], ...overrides });

const ctxIn = (user: SessionUser, schoolId: string): TenantContext => ({ user: { ...user, schoolId }, schoolId, schoolSlug: "", schoolName: "", db: forSchool(schoolId) });

async function organizationIds() {
  const rows = await prisma.school.findMany({ where: { id: { in: [schoolA.schoolId, schoolB.schoolId] } }, select: { organizationId: true } });
  return rows.flatMap((row) => (row.organizationId ? [row.organizationId] : []));
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  const user = await prisma.user.create({ data: { email: `super@${PREFIX}.test`, passwordHash: "x", role: "SUPER_ADMIN", firstName: "Platform", lastName: "Owner" } });
  superAdmin = { id: user.id, email: user.email, role: "SUPER_ADMIN", firstName: "Platform", lastName: "Owner", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null };
  const plan = await prisma.plan.upsert({ where: { tier: "PRO" }, update: {}, create: { tier: "PRO", slug: "pro", name: "Pro", priceMinor: 100 } });
  planId = plan.id;
  planBefore = { campusLimit: plan.campusLimit, availableRoles: plan.availableRoles, optionalModules: plan.optionalModules, maxStudents: plan.maxStudents, roleLimits: plan.roleLimits };
  ownerToken = (await createSession(schoolA.adminUserId)).token;
  owner = (await validateSessionToken(ownerToken))!;
}, 60_000);

afterAll(async () => {
  await prisma.plan.update({ where: { id: planId }, data: { ...planBefore, roleLimits: planBefore.roleLimits as object } });
  const orgs = await organizationIds();
  await prisma.school.deleteMany({ where: { organizationId: { in: orgs }, id: { notIn: [schoolA.schoolId, schoolB.schoolId] } } });
  await destroyIsolationFixture();
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
  await prisma.$disconnect();
});

describe("a single-school owner", () => {
  it("has one campus and nothing to switch — but may still send a request, told what approval needs", async () => {
    const organization = await myOrganization(owner);
    expect(organization).toMatchObject({ isOwner: true, count: 1, multiCampus: false });
    expect(await switchableCampuses(owner)).toHaveLength(1);
    const overview = await campusRequestOverview(adminOf(schoolA));
    expect(overview.canRequest).toBe(true);
    expect(overview.entitlement).toMatch(/includes 1 campus.*You can still send a request/);
    const { id } = await submitCampusRequest(adminOf(schoolA), request({ name: `${PREFIX} Over Limit` }), {});
    const row = await prisma.campusRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("PENDING");
    expect(row.entitlementNotes[0]).toMatch(/Campus limit: the plan includes 1/);
    // Asking creates nothing, and approval past the limit is refused.
    await expect(approveCampusRequest(superAdmin, id, { modules: [], roles: [], limits: {}, reviewNote: null })).rejects.toThrow(/campus limit \(1\)/);
    expect(await prisma.school.count({ where: { name: `${PREFIX} Over Limit` } })).toBe(0);
    await rejectCampusRequest(superAdmin, id, "Upgrade first");
  });
});

describe("the plan turns multi-campus on, and requests are checked against it", () => {
  it("notes modules, roles and limits beyond the plan — asked for, never granted by asking", async () => {
    await prisma.plan.update({ where: { id: planId }, data: { campusLimit: 3, optionalModules: ["FINANCE", "TRANSPORT"], availableRoles: ["PRINCIPAL", "ACCOUNTANT", "DRIVER"], maxStudents: 1000, roleLimits: {} } });
    await prisma.subscription.create({ data: { schoolId: schoolA.schoolId, planId, status: "ACTIVE", startsAt: new Date() } });
    expect((await myOrganization(owner)).multiCampus).toBe(true);

    const { id } = await submitCampusRequest(adminOf(schoolA), request({ name: `${PREFIX} Beyond Plan`, modules: ["LIBRARY"], roles: ["LIBRARIAN"] }), { STUDENTS: 5000 });
    const row = await prisma.campusRequest.findUniqueOrThrow({ where: { id } });
    expect(row.entitlementNotes.join(" ")).toMatch(/Modules not in the current plan: Library/);
    expect(row.entitlementNotes.join(" ")).toMatch(/Roles not in the current plan: Librarian/);
    expect(row.entitlementNotes.join(" ")).toMatch(/Students: asks for 5000, the plan allows 1000/);
    await rejectCampusRequest(superAdmin, id, "Not now");
  });

  it("a valid request waits for the Super Admin; nobody else can decide it", async () => {
    const { id } = await submitCampusRequest(adminOf(schoolA), request(), { STUDENTS: 500, PRINCIPAL: 1 });
    expect((await prisma.campusRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    // Nothing is created by asking.
    expect(await prisma.school.count({ where: { name: `${PREFIX} XYZ Public School` } })).toBe(0);
    await expect(approveCampusRequest(owner, id, { modules: [], roles: [], limits: {}, reviewNote: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCampusRequests(owner)).rejects.toBeInstanceOf(ForbiddenError);
    // Another owner cannot reach it.
    await expect(assertOwnsRequest(adminOf(schoolB), id)).rejects.toBeInstanceOf(ForbiddenError);
    await markCampusRequestUnderReview(superAdmin, id);
    expect((await prisma.campusRequest.findUniqueOrThrow({ where: { id } })).status).toBe("UNDER_REVIEW");
  });

  it("rejecting needs a reason and is audited", async () => {
    const { id } = await submitCampusRequest(adminOf(schoolA), request({ name: `${PREFIX} Rejected School` }), {});
    await expect(rejectCampusRequest(superAdmin, id, " ")).rejects.toThrow(/reason/);
    await rejectCampusRequest(superAdmin, id, "Documents missing");
    expect(await prisma.campusRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "REJECTED", rejectionReason: "Documents missing", createdSchoolId: null });
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "CAMPUS_REQUEST_REJECTED" } })).toBe(1);
  });

  it("modify & approve keeps the request, stores the approval, and only then creates the campus", async () => {
    const pending = await prisma.campusRequest.findFirstOrThrow({ where: { name: `${PREFIX} XYZ Public School` } });
    const { schoolId, status } = await approveCampusRequest(superAdmin, pending.id, { modules: ["FINANCE"], roles: ["ACCOUNTANT"], limits: { STUDENTS: 400 }, reviewNote: "Transport later" });
    newCampusId = schoolId;
    expect(status).toBe("MODIFIED");
    const row = await prisma.campusRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.requestedModules).toEqual(["FINANCE", "TRANSPORT"]);
    expect(row.requestedRoles).toEqual(["PRINCIPAL", "ACCOUNTANT"]);
    expect(row.approvedModules).toEqual(["FINANCE"]);
    expect(row.createdSchoolId).toBe(schoolId);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { status: true, organizationId: true, optionalModules: true, enabledRoles: true, roleLimits: true, _count: { select: { students: true, academicSessions: true } } } });
    const [orgA] = await prisma.school.findMany({ where: { id: schoolA.schoolId }, select: { organizationId: true } });
    expect(school).toMatchObject({ status: "ACTIVE", organizationId: orgA!.organizationId, optionalModules: ["FINANCE"], enabledRoles: ["ACCOUNTANT"], roleLimits: { STUDENTS: 400 } });
    // Default academic setup only — no fake students.
    expect(school._count).toEqual({ students: 0, academicSessions: 1 });
    expect(await prisma.auditLog.count({ where: { entityId: pending.id, action: "CAMPUS_REQUEST_MODIFIED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: schoolId, action: "CAMPUS_ACTIVATED" } })).toBe(1);
    await expect(approveCampusRequest(superAdmin, pending.id, { modules: [], roles: [], limits: {}, reviewNote: null })).rejects.toThrow(/already/);
  });
});

describe("the owner works across campuses", () => {
  it("switches campus — each campus shows only its own data", async () => {
    expect((await switchableCampuses(owner)).map((campus) => campus.id)).toEqual(expect.arrayContaining([schoolA.schoolId, newCampusId]));
    await switchCampus(owner, ownerToken, newCampusId);
    const switched = (await validateSessionToken(ownerToken))!;
    expect(switched).toMatchObject({ schoolId: newCampusId, homeSchoolId: schoolA.schoolId, role: "SCHOOL_ADMIN" });
    const inNew = ctxIn(switched, newCampusId);
    const listed = JSON.stringify(await listStudents(inNew, {}));
    for (const studentId of schoolA.studentIds) expect(listed).not.toContain(studentId);
    await switchCampus(switched, ownerToken, null);
    expect((await validateSessionToken(ownerToken))!.schoolId).toBe(schoolA.schoolId);
  });

  it("refuses another owner's campus, and a tampered campus id falls back home", async () => {
    await expect(switchCampus(owner, ownerToken, schoolB.schoolId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(switchCampus(owner, ownerToken, "made-up-id")).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.session.updateMany({ where: { tokenHash: hashSessionToken(ownerToken) }, data: { activeSchoolId: schoolB.schoolId } });
    expect((await validateSessionToken(ownerToken))!.schoolId).toBe(schoolA.schoolId);
    await prisma.session.updateMany({ where: { tokenHash: hashSessionToken(ownerToken) }, data: { activeSchoolId: null } });
  });

  it("All Campuses is a summary for the owner only", async () => {
    const summary = await allCampusesSummary(owner);
    expect(summary.totals.campuses).toBe(2);
    expect(summary.totals.students).toBe(3);
    expect(summary.campuses.map((campus) => campus.id)).not.toContain(schoolB.schoolId);
    expect(JSON.stringify(summary)).not.toContain(schoolA.studentIds[0]!);
    // A second School Admin of campus A is not the owner.
    const other = await prisma.user.create({ data: { email: `admin2@${PREFIX}.test`, passwordHash: "x", role: "SCHOOL_ADMIN", firstName: "Second", lastName: "Admin", schoolId: schoolA.schoolId } });
    const otherUser = { ...owner, id: other.id, email: other.email };
    await expect(allCampusesSummary(otherUser)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await switchableCampuses(otherUser)).toEqual([]);
    const token = (await createSession(other.id)).token;
    await expect(switchCampus(otherUser, token, newCampusId)).rejects.toBeInstanceOf(ForbiddenError);
    // School B's owner has no plan with the organization dashboard: refused,
    // and never shown anything of A's organization either way.
    const ownerB = (await validateSessionToken((await createSession(schoolB.adminUserId)).token))!;
    await expect(allCampusesSummary(ownerB)).rejects.toThrow(/Organization dashboard is not part of your plan/);
  });
});

describe("each campus's own roles, modules and limits", () => {
  it("a role or module the campus was not given is refused, whoever asks", async () => {
    const inNew = ctxIn(owner, newCampusId);
    await expect(createPrincipal(inNew, { firstName: "No", lastName: "Role", email: `p-new@${PREFIX}.test`, phone: null })).rejects.toThrow(/Principal role is not part of your school's plan/);
    await prisma.school.update({ where: { id: newCampusId }, data: { optionalModules: [] } });
    await expect(createFeeHead(inNew, { name: "Tuition", note: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a role limit stops one more, with the limit in the message", async () => {
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { roleLimits: { PRINCIPAL: 1 } } });
    await createPrincipal(adminOf(schoolA), { firstName: "First", lastName: "Principal", email: `p1@${PREFIX}.test`, phone: null });
    await expect(createPrincipal(adminOf(schoolA), { firstName: "Second", lastName: "Principal", email: `p2@${PREFIX}.test`, phone: null })).rejects.toThrow(/allows up to 1 principal/);
  });

  it("the campus limit cannot be bypassed: the request is accepted, activation is refused", async () => {
    await setCampusLimitOverride(superAdmin, (await myOrganization(owner)).id, 2);
    const overview = await campusRequestOverview(adminOf(schoolA));
    expect(overview.canRequest).toBe(true);
    expect(overview.entitlement).toMatch(/up to 2 campuses/);
    const { id } = await submitCampusRequest(adminOf(schoolA), request({ name: `${PREFIX} Third` }), {});
    await expect(approveCampusRequest(superAdmin, id, { modules: [], roles: [], limits: {}, reviewNote: null })).rejects.toThrow(/campus limit \(2\)/);
    expect(await prisma.school.count({ where: { name: `${PREFIX} Third` } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "ORGANIZATION_CAMPUS_LIMIT_CHANGED", actorId: superAdmin.id } })).toBe(1);
  });

  it("a Principal and the staff of campus A never see campus B's records", async () => {
    const principal = await prisma.user.findFirstOrThrow({ where: { email: `p1@${PREFIX}.test` } });
    const inA = contextFor(schoolA, principal.id, "PRINCIPAL");
    await prisma.student.create({ data: { schoolId: newCampusId, firstName: "Only", lastName: "InNew", admissionNumber: `${PREFIX}-1` } });
    expect(JSON.stringify(await listStudents(inA, {}))).not.toContain("InNew");
    // A Principal cannot switch campus at all.
    const principalUser = { ...owner, id: principal.id, role: "PRINCIPAL" as const };
    await expect(switchCampus(principalUser, ownerToken, newCampusId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("approving at the limit, with the Super Admin's say-so", () => {
  it("ticking “raise the limit” raises it by exactly one and creates the campus, audited", async () => {
    const organizationId = (await myOrganization(owner)).id;
    const pending = await prisma.campusRequest.findFirstOrThrow({ where: { name: `${PREFIX} Third`, status: "PENDING" }, select: { id: true } });
    const { schoolId } = await approveCampusRequest(superAdmin, pending.id, { modules: [], roles: [], limits: {}, reviewNote: null, raiseLimit: true });
    expect(await prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { organizationId: true } })).toEqual({ organizationId });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).campusLimitOverride).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: "ORGANIZATION_CAMPUS_LIMIT_CHANGED", actorId: superAdmin.id } })).toBe(2);
  });
});
