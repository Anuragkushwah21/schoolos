/**
 * The Super Admin manages the platform and the schools as accounts — not a
 * school's day. The audit trail every platform screen reads holds only
 * platform actions (and the Super Admin's own), never a school's attendance,
 * homework, marks, fees or salaries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuditAction } from "@/lib/audit-actions";
import { recordAudit } from "@/server/audit/log";
import { createApiToken } from "@/server/auth/api-token";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { listAuditLog } from "@/server/platform/audit";
import { getSchoolForPlatform } from "@/server/platform/schools";
import { GET as auditRoute } from "@/app/api/v1/platform/audit/route";

import { apiRequest, callApi } from "../helpers/api";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let superAdmin: SessionUser;
let token = "";

const OPERATIONAL: AuditAction[] = [
  "ATTENDANCE_MARKED",
  "STAFF_ATTENDANCE_MARKED",
  "CLASS_ACTIVITY_RECORDED",
  "HOMEWORK_CREATED",
  "STUDENT_REMARK_ADDED",
  "EXPENSE_RECORDED",
  "SALARY_PAID",
  "FEE_PAYMENT_RECORDED",
  "TIMETABLE_UPDATED",
];

beforeAll(async () => {
  ({ schoolA } = await createIsolationFixture());
  const user = await prisma.user.create({
    data: { email: "super@sa-scope.test", passwordHash: "x", role: "SUPER_ADMIN", firstName: "Platform", lastName: "Owner" },
  });
  superAdmin = {
    id: user.id, email: user.email, role: "SUPER_ADMIN", firstName: "Platform", lastName: "Owner",
    schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null,
  };
  token = (await createApiToken(superAdmin, { name: "sa scope", scope: "READ", expiresAt: null })).token;

  for (const action of OPERATIONAL) {
    await recordAudit({
      action,
      entityType: "Test",
      schoolId: schoolA.schoolId,
      actorId: schoolA.adminUserId,
      summary: `sa-scope operational ${action}`,
    });
  }
  await recordAudit({ action: "SCHOOL_APPROVED", entityType: "School", entityId: schoolA.schoolId, schoolId: schoolA.schoolId, actorId: user.id, summary: "sa-scope platform approval" });
  // A Super Admin's own action outside the platform list is still theirs to see.
  await recordAudit({ action: "PASSWORD_RESET", entityType: "User", schoolId: schoolA.schoolId, actorId: user.id, summary: "sa-scope admin password reset" });
}, 60_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { summary: { startsWith: "sa-scope" } } });
  await prisma.apiToken.deleteMany({ where: { userId: superAdmin.id } });
  await prisma.user.deleteMany({ where: { id: superAdmin.id } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("Super Admin sees platform activity only", () => {
  it("audit log: approvals and their own actions, never a school's daily operations", async () => {
    const { rows } = await listAuditLog(superAdmin, { q: "sa-scope" });
    const summaries = rows.map((row) => row.summary);
    expect(summaries).toContain("sa-scope platform approval");
    expect(summaries).toContain("sa-scope admin password reset");
    expect(summaries.filter((s) => s.includes("operational"))).toEqual([]);
  });

  it("school page: platform activity for that school only", async () => {
    const { recentAudit } = await getSchoolForPlatform(superAdmin, schoolA.schoolId);
    const actions = recentAudit.map((row) => row.action);
    expect(actions).toContain("SCHOOL_APPROVED");
    for (const action of OPERATIONAL) expect(actions).not.toContain(action);
  });

  it("API: operational actions cannot be requested, and are absent from results", async () => {
    const refused = await callApi(auditRoute, apiRequest("/api/v1/platform/audit?action=HOMEWORK_CREATED", { token }));
    expect(refused.status).toBe(422);

    const all = await callApi(auditRoute, apiRequest("/api/v1/platform/audit?q=sa-scope", { token }));
    expect(all.status).toBe(200);
    expect(JSON.stringify(all.body)).not.toContain("operational");
  });

  it("the entries still exist — the school's history is untouched", async () => {
    expect(await prisma.auditLog.count({ where: { summary: { startsWith: "sa-scope operational" } } })).toBe(OPERATIONAL.length);
  });
});
