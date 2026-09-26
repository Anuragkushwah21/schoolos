"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import {
  academicSessionSchema,
  classSchema,
  sectionSchema,
  streamSchema,
  subjectSchema,
  updateSectionSchema,
} from "@/lib/validation/school";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  createAcademicSession,
  createClass,
  createSection,
  createStream,
  createSubject,
  deleteSection,
  setClassActive,
  setCurrentSession,
  setStreamActive,
  setSubjectActive,
  updateSection,
} from "@/server/academics/structure";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const REVALIDATE = "/school-admin";

export async function createAcademicSessionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await createAcademicSession(ctx, parseFormData(academicSessionSchema, formData));
      return successResult("Academic session created.");
    },
    { revalidate: REVALIDATE },
  );
}

const sessionIdSchema = z.object({ sessionId: id });

export async function setCurrentSessionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { sessionId } = parseFormData(sessionIdSchema, formData);
      await setCurrentSession(ctx, sessionId);
      return successResult("Current session changed.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function createClassAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await createClass(ctx, parseFormData(classSchema, formData));
      return successResult("Class added.");
    },
    { revalidate: REVALIDATE },
  );
}

const toggleSchema = z.object({ targetId: id, active: z.enum(["true", "false"]) });

export async function toggleClassAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { targetId, active } = parseFormData(toggleSchema, formData);
      await setClassActive(ctx, targetId, active === "true");
      return successResult(active === "true" ? "Class enabled." : "Class disabled.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function createStreamAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { name } = parseFormData(streamSchema, formData);
      await createStream(ctx, name);
      return successResult("Stream added.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function toggleStreamAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { targetId, active } = parseFormData(toggleSchema, formData);
      await setStreamActive(ctx, targetId, active === "true");
      return successResult(active === "true" ? "Stream enabled." : "Stream disabled.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function createSubjectAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await createSubject(ctx, parseFormData(subjectSchema, formData));
      return successResult("Subject added.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function toggleSubjectAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { targetId, active } = parseFormData(toggleSchema, formData);
      await setSubjectActive(ctx, targetId, active === "true");
      return successResult(active === "true" ? "Subject enabled." : "Subject disabled.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function createSectionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      await createSection(ctx, parseFormData(sectionSchema, formData));
      return successResult("Section created.");
    },
    { revalidate: REVALIDATE },
  );
}

export async function updateSectionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { sectionId, ...input } = parseFormData(updateSectionSchema, formData);
      await updateSection(ctx, sectionId, input);
      return successResult("Section saved.");
    },
    { revalidate: REVALIDATE },
  );
}

const sectionIdSchema = z.object({ sectionId: id });

export async function deleteSectionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await admin();
      const { sectionId } = parseFormData(sectionIdSchema, formData);
      await deleteSection(ctx, sectionId);
      return successResult("Section deleted.");
    },
    { revalidate: REVALIDATE, redirectTo: "/school-admin/academics/classes" },
  );
}
