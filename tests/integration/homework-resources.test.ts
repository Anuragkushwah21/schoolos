/**
 * Homework with study resources — PDFs, videos and links — on the same
 * resource system a completed class uses.
 *
 * Under test: a teacher sets homework with several resources in one save, then
 * edits, replaces and removes them; the student in that section sees the
 * homework and can open every resource; nobody else can — not another school's
 * student, not a colleague, not a parent — and the homework rules that existed
 * before (subject assignment, drafts, overdue) still hold.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { addDays, today } from "@/lib/dates";
import { homeworkSchema, parseHomeworkResources } from "@/lib/validation/classwork";
import { prisma } from "@/server/db/prisma";
import {
  addHomeworkResource,
  createHomework,
  deleteHomework,
  getMyHomework as getTeacherHomework,
  removeHomeworkResource,
  updateHomework,
  updateHomeworkResource,
} from "@/server/classwork/homework";
import { readMaterialFile } from "@/server/classwork/lessons";
import { getMyHomework, getMyHomeworkItem, getMyMaterials } from "@/server/student/me";

import { contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let homeworkId: string;
let colleagueCtx: ReturnType<typeof teacherOf>;

const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const PDF_2 = Buffer.from("%PDF-1.7\n% replaced\n%%EOF\n");
const pdf = (name: string, bytes: Buffer = PDF) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

const homework = (school: SeededSchool, overrides: Partial<Parameters<typeof createHomework>[1]> = {}) => ({
  sectionId: school.sectionId,
  subjectId: school.subjectId,
  title: "Quadratic Equations Practice",
  description: "Chapter 4",
  instructions: "Complete Exercise 4.2, Questions 1-10.",
  assignedOn: today(),
  dueOn: addDays(today(), 2),
  status: "PUBLISHED" as const,
  ...overrides,
});

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());

  const user = await prisma.user.create({
    data: {
      email: "hw-colleague@iso-test-a.test",
      passwordHash: "not-a-real-hash",
      role: "TEACHER",
      firstName: "Other",
      lastName: "Teacher",
      schoolId: schoolA.schoolId,
    },
  });
  await prisma.teacher.create({
    data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "EMP-HW", firstName: "Other", lastName: "Teacher" },
  });
  colleagueCtx = contextFor(schoolA, user.id, "TEACHER");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("setting homework with resources", () => {
  it("creates the homework and every resource in one save", async () => {
    const { id } = await createHomework(teacherOf(schoolA), homework(schoolA), [
      { kind: "DOCUMENT", title: "Chapter Notes", url: null, description: null, file: pdf("Chapter Notes.pdf") },
      { kind: "DOCUMENT", title: "Important Questions", url: null, description: null, file: pdf("Important Questions.pdf") },
      { kind: "VIDEO", title: "Explanation Video", url: "https://www.youtube.com/watch?v=abc", description: null },
      { kind: "LINK", title: "Online Practice", url: "https://example.com/practice", description: "Try 10 questions" },
    ]);
    homeworkId = id;

    const saved = await getTeacherHomework(teacherOf(schoolA), id);
    expect(saved.instructions).toBe("Complete Exercise 4.2, Questions 1-10.");
    expect(saved.resources.map((row) => row.kind)).toEqual(["DOCUMENT", "DOCUMENT", "VIDEO", "LINK"]);
    expect(saved.resources[0]).toMatchObject({ fileName: "Chapter Notes.pdf", url: null });
    expect(saved.resources[3]).toMatchObject({ url: "https://example.com/practice", description: "Try 10 questions" });
  });

  it("refuses a duplicate of the same homework", async () => {
    await expect(createHomework(teacherOf(schoolA), homework(schoolA))).rejects.toBeInstanceOf(ConflictError);
  });

  it("saves nothing when one resource is bad", async () => {
    const before = await prisma.homework.count({ where: { schoolId: schoolA.schoolId } });
    const exe = Buffer.from("MZ\x90\x00 not a pdf");
    await expect(
      createHomework(teacherOf(schoolA), homework(schoolA, { title: "Bad upload" }), [
        { kind: "VIDEO", title: "Fine", url: "https://example.com/v", description: null },
        { kind: "DOCUMENT", title: "Evil", url: null, description: null, file: pdf("evil.pdf", exe) },
      ]),
    ).rejects.toThrow(/not a valid PDF/);
    expect(await prisma.homework.count({ where: { schoolId: schoolA.schoolId } })).toBe(before);
  });

  it("refuses homework for a section or subject the teacher is not assigned", async () => {
    await expect(
      createHomework(teacherOf(schoolA), homework(schoolA, { sectionId: schoolA.unassignedSectionId })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createHomework(colleagueCtx, homework(schoolA, { title: "Not mine" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Another school's section, by id.
    await expect(
      createHomework(teacherOf(schoolA), homework(schoolA, { sectionId: schoolB.sectionId })),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("the form's resource rows", () => {
  it("reads numbered rows and reports a bad address against its own row", () => {
    const form = new FormData();
    form.set("resources.0.kind", "VIDEO");
    form.set("resources.0.title", "Video");
    form.set("resources.0.url", "https://youtu.be/x");
    form.set("resources.3.kind", "LINK");
    form.set("resources.3.title", "Broken");
    form.set("resources.3.url", "not a url");
    form.set("resources.5.kind", "DOCUMENT");
    form.set("resources.5.title", "Notes");
    form.set("resources.5.file", pdf("n.pdf"));

    const { resources, fieldErrors } = parseHomeworkResources(form);
    expect(resources.map((row) => row.kind)).toEqual(["VIDEO", "DOCUMENT"]);
    expect(Object.keys(fieldErrors)).toEqual(["resources.3.url"]);
  });

  it("keeps instructions on the homework itself", () => {
    const parsed = homeworkSchema.parse({
      sectionId: "s",
      subjectId: "t",
      title: "T",
      instructions: "Do Q1-10",
      assignedOn: "2026-09-26",
      dueOn: "2026-09-27",
      status: "PUBLISHED",
    });
    expect(parsed.instructions).toBe("Do Q1-10");
  });
});

describe("editing resources", () => {
  it("adds a resource to existing homework", async () => {
    await addHomeworkResource(teacherOf(schoolA), homeworkId, {
      kind: "LINK",
      title: "Extra",
      url: "https://example.com/extra",
      description: null,
    });
    expect((await getTeacherHomework(teacherOf(schoolA), homeworkId)).resources).toHaveLength(5);
  });

  it("edits a video's address and a link's title and description", async () => {
    const { resources } = await getTeacherHomework(teacherOf(schoolA), homeworkId);
    const video = resources.find((row) => row.kind === "VIDEO")!;
    await updateHomeworkResource(teacherOf(schoolA), video.id, {
      title: "Better video",
      description: "Watch first",
      url: "https://www.youtube.com/watch?v=xyz",
    });
    await expect(
      updateHomeworkResource(teacherOf(schoolA), video.id, { title: "x", description: null, url: "ftp://nope" }),
    ).rejects.toBeInstanceOf(AppError);

    const after = (await getTeacherHomework(teacherOf(schoolA), homeworkId)).resources.find((r) => r.id === video.id);
    expect(after).toMatchObject({ title: "Better video", description: "Watch first", url: "https://www.youtube.com/watch?v=xyz" });
  });

  it("replaces a PDF and serves the new file", async () => {
    const document = (await getTeacherHomework(teacherOf(schoolA), homeworkId)).resources[0]!;
    await updateHomeworkResource(teacherOf(schoolA), document.id, {
      title: "Chapter Notes (v2)",
      description: null,
      url: null,
      file: pdf("Notes v2.pdf", PDF_2),
    });
    const file = await readMaterialFile(studentOf(schoolA), document.id);
    expect(file.fileName).toBe("Notes v2.pdf");
    expect(file.bytes.equals(PDF_2)).toBe(true);
  });

  it("removes one resource and leaves the homework", async () => {
    const { resources } = await getTeacherHomework(teacherOf(schoolA), homeworkId);
    const extra = resources.find((row) => row.title === "Extra")!;
    await removeHomeworkResource(teacherOf(schoolA), extra.id);
    const after = await getTeacherHomework(teacherOf(schoolA), homeworkId);
    expect(after.resources).toHaveLength(4);
    expect(after.title).toBe("Quadratic Equations Practice");
  });

  it("does not let another teacher touch the resources", async () => {
    const [first] = (await getTeacherHomework(teacherOf(schoolA), homeworkId)).resources;
    await expect(removeHomeworkResource(colleagueCtx, first!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateHomeworkResource(colleagueCtx, first!.id, { title: "x", description: null, url: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addHomeworkResource(colleagueCtx, homeworkId, { kind: "LINK", title: "x", url: "https://e.com", description: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(readMaterialFile(colleagueCtx, first!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("what the student sees", () => {
  it("lists the homework with its resource count, and opens it with every resource", async () => {
    const list = await getMyHomework(studentOf(schoolA));
    const entry = [...list.dueSoon, ...list.dueToday, ...list.upcoming].find((row) => row.id === homeworkId);
    expect(entry?.resourceCount).toBe(4);

    const { homework: item } = await getMyHomeworkItem(studentOf(schoolA), homeworkId);
    expect(item).toMatchObject({
      title: "Quadratic Equations Practice",
      instructions: "Complete Exercise 4.2, Questions 1-10.",
      state: "PENDING",
    });
    const video = item.resources.find((row) => row.kind === "VIDEO")!;
    const link = item.resources.find((row) => row.kind === "LINK")!;
    expect(video.url).toBe("https://www.youtube.com/watch?v=xyz");
    expect(link.url).toBe("https://example.com/practice");
    expect(Object.keys(item.resources[0]!)).not.toContain("storageKey");
  });

  it("serves the student the homework PDF", async () => {
    const { homework: item } = await getMyHomeworkItem(studentOf(schoolA), homeworkId);
    const second = item.resources[1]!;
    const file = await readMaterialFile(studentOf(schoolA), second.id);
    expect(file.mimeType).toBe("application/pdf");
    expect(file.bytes.equals(PDF)).toBe(true);
  });

  it("keeps homework resources off the class study-material list", async () => {
    const { materials } = await getMyMaterials(studentOf(schoolA));
    expect(materials).toEqual([]);
  });

  it("answers another school's student with not found, for the homework and its files", async () => {
    const { resources } = await getTeacherHomework(teacherOf(schoolA), homeworkId);
    await expect(getMyHomeworkItem(studentOf(schoolB), homeworkId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readMaterialFile(studentOf(schoolB), resources[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not serve homework files to a parent", async () => {
    const { resources } = await getTeacherHomework(teacherOf(schoolA), homeworkId);
    await expect(
      readMaterialFile(contextFor(schoolA, schoolA.parentUserId, "PARENT"), resources[0]!.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("existing homework behaviour", () => {
  it("hides a draft, and its files, from the student", async () => {
    const current = await getTeacherHomework(teacherOf(schoolA), homeworkId);
    await updateHomework(teacherOf(schoolA), homeworkId, { ...homework(schoolA), status: "DRAFT" });
    await expect(getMyHomeworkItem(studentOf(schoolA), homeworkId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readMaterialFile(studentOf(schoolA), current.resources[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    await updateHomework(teacherOf(schoolA), homeworkId, { ...homework(schoolA), status: "PUBLISHED" });
  });

  it("still marks past-due work as overdue", async () => {
    const { id } = await createHomework(
      teacherOf(schoolA),
      homework(schoolA, { title: "Old work", assignedOn: addDays(today(), -5), dueOn: addDays(today(), -1) }),
    );
    expect((await getMyHomeworkItem(studentOf(schoolA), id)).homework.state).toBe("OVERDUE");
    expect((await getMyHomework(studentOf(schoolA))).overdue.map((row) => row.id)).toContain(id);
  });

  it("deletes the homework with its resources and their files", async () => {
    const { resources } = await getTeacherHomework(teacherOf(schoolA), homeworkId);
    await deleteHomework(teacherOf(schoolA), homeworkId);
    expect(await prisma.lessonMaterial.count({ where: { homeworkId } })).toBe(0);
    await expect(readMaterialFile(contextFor(schoolA, schoolA.adminUserId, "SCHOOL_ADMIN"), resources[0]!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects a resource row with no owner at the database", async () => {
    await expect(
      prisma.lessonMaterial.create({ data: { schoolId: schoolA.schoolId, kind: "LINK", title: "orphan", url: "https://e.com" } }),
    ).rejects.toThrow();
  });
});
