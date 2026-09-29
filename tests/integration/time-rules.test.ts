/**
 * Date-driven rules enforced on the server: statuses follow the clock without
 * anyone flipping them, and actions that no longer make sense are refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { noticeSchema } from "@/lib/validation/communication";
import { createExamSchema } from "@/lib/validation/exams";
import { leaveRequestSchema } from "@/lib/validation/leave";
import { noticesFor, saveNotice } from "@/server/communication/notices";
import { prisma } from "@/server/db/prisma";
import { createExams, getMarksSheet, listExams, publishExams, saveMarks } from "@/server/exams/service";
import { applyForLeave, decideLeave, listMyLeave } from "@/server/staff/leave";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;

const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

beforeAll(async () => {
  ({ schoolA } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("exams", () => {
  it("opens marks only on the paper's day and publishes only after it is held", async () => {
    const { ids } = await createExams(
      adminOf(schoolA),
      createExamSchema.parse({
        name: "Next Week Test",
        sectionIds: [schoolA.sectionId],
        startDate: toDateInput(addDays(today(), 5)),
        endDate: toDateInput(addDays(today(), 6)),
        papers: [{ subjectId: schoolA.subjectId, maxMarks: "20" }],
      }),
    );
    const paper = await prisma.assessment.findFirstOrThrow({ where: { examId: ids[0] } });
    expect((await listExams(adminOf(schoolA))).find((row) => row.id === ids[0])?.timeStatus).toBe("UPCOMING");
    expect((await getMarksSheet(teacherOf(schoolA), paper.id)).editable).toBe(false);
    await expect(
      saveMarks(teacherOf(schoolA), paper.id, [{ studentId: schoolA.studentIds[0]!, marks: 10, absent: false, remark: null }]),
    ).rejects.toThrow(/Marks can be entered from that day/);
    await expect(publishExams(adminOf(schoolA), ids)).rejects.toThrow(/still to be held/);
  });
});

describe("notices", () => {
  it("keeps a notice visible all through its hide-after day", async () => {
    await saveNotice(
      adminOf(schoolA),
      noticeSchema.parse({ title: "Last day notice", body: "x", status: "PUBLISHED", audience: "ALL", expiresAt: toDateInput(today()) }),
    );
    expect((await noticesFor(studentOf(schoolA))).map((row) => row.title)).toContain("Last day notice");
  });
});

describe("leave", () => {
  it("shows approved leave as upcoming, on leave or completed by date", async () => {
    const { id } = await applyForLeave(
      teacherOf(schoolA),
      leaveRequestSchema.parse({ type: "CASUAL", startDate: toDateInput(addDays(today(), -1)), endDate: toDateInput(addDays(today(), 1)), reason: "Family" }),
    );
    expect((await listMyLeave(teacherOf(schoolA))).find((row) => row.id === id)?.timeStatus).toBe("PENDING");
    await decideLeave(adminOf(schoolA), { leaveIds: [id], decision: "APPROVED", note: null });
    expect((await listMyLeave(teacherOf(schoolA))).find((row) => row.id === id)?.timeStatus).toBe("ON_LEAVE");
    // Leave that has started can no longer be cancelled by the teacher.
    const row = (await listMyLeave(teacherOf(schoolA))).find((item) => item.id === id);
    expect(row?.cancellable).toBe(false);
  });
});
