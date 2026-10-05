import "server-only";

import { today } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import type { AdmissionPortalInput } from "@/lib/validation/enquiries";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/**
 * The public admission page's own settings: when applications open and
 * close, which classes are on offer, instructions, highlights, a map and
 * website link, and up to ten extra questions of the school's own. The
 * system's questions (child, class, parent, phone) are always asked and
 * cannot be switched off. No settings row means open all year, every
 * active class — as before this existed.
 */

export type CustomField = { key: string; label: string; kind: "TEXT" | "TEXTAREA" | "DATE" | "SELECT"; options: string[]; required: boolean };

export function readCustomFields(value: unknown): CustomField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const field = row as Record<string, unknown>;
    if (typeof field.key !== "string" || typeof field.label !== "string") return [];
    const kind = ["TEXT", "TEXTAREA", "DATE", "SELECT"].includes(field.kind as string) ? (field.kind as CustomField["kind"]) : "TEXT";
    return [{ key: field.key, label: field.label, kind, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === "string") : [], required: field.required === true }];
  });
}

export async function getPortalSettings(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const portal = await ctx.db.admissionPortal.findFirst({ include: { updatedBy: { select: { firstName: true, lastName: true } } } });
  return portal ? { ...portal, customFields: readCustomFields(portal.customFields) } : null;
}

export async function savePortalSettings(ctx: TenantContext, input: AdmissionPortalInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const classes = input.classIds.length ? await ctx.db.class.findMany({ where: { id: { in: input.classIds } }, select: { id: true } }) : [];
  if (classes.length !== new Set(input.classIds).size) throw new ValidationError("Please correct the highlighted fields.", { classIds: ["Choose classes from the list"] });
  const errors: Record<string, string[]> = {};
  const customFields: CustomField[] = input.fields.map((field, index) => {
    const options = field.kind === "SELECT" ? (field.options ?? "").split(/[\n,]/).map((option) => option.trim()).filter(Boolean) : [];
    if (field.kind === "SELECT" && options.length < 2) errors[`fields.${index}.options`] = ["Give at least two choices"];
    return { key: `q${index + 1}`, label: field.label, kind: field.kind, options, required: field.required };
  });
  if (Object.keys(errors).length) throw new ValidationError("Please correct the highlighted fields.", errors);
  const data = {
    opensOn: input.opensOn,
    closesOn: input.closesOn,
    instructions: input.instructions,
    mapUrl: input.mapUrl,
    websiteUrl: input.websiteUrl,
    highlights: (input.highlights ?? "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 12),
    classIds: [...new Set(input.classIds)],
    customFields,
    updatedById: ctx.user.id,
  };
  await ctx.db.admissionPortal.upsert({ where: { schoolId: ctx.schoolId }, create: { schoolId: ctx.schoolId, ...data }, update: data });
  await recordAudit({ action: "ADMISSION_PORTAL_UPDATED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: "Admission portal settings updated." });
}

export type PortalWindow = { state: "OPEN" } | { state: "UNPUBLISHED" } | { state: "NOT_YET"; opensOn: Date } | { state: "CLOSED"; closesOn: Date };

/**
 * Whether the public form takes applications today. Unpublished switches it
 * off whatever the dates say; otherwise the opening and closing dates decide.
 * No settings saved yet means published and open, as it always was.
 */
export function portalWindow(portal: { opensOn: Date | null; closesOn: Date | null; isPublished?: boolean } | null, on: Date = today()): PortalWindow {
  if (portal?.isPublished === false) return { state: "UNPUBLISHED" };
  if (portal?.opensOn && on < portal.opensOn) return { state: "NOT_YET", opensOn: portal.opensOn };
  if (portal?.closesOn && on > portal.closesOn) return { state: "CLOSED", closesOn: portal.closesOn };
  return { state: "OPEN" };
}

/**
 * The public side: the classes on offer (with each one's level, for the
 * stream rule), the school's streams, the window, and the extra questions.
 * Selected for the public — nothing internal.
 */
export async function publicPortal(schoolId: string) {
  const [portal, classes, streams, session] = await Promise.all([
    prisma.admissionPortal.findFirst({ where: { schoolId }, select: { isPublished: true, opensOn: true, closesOn: true, instructions: true, mapUrl: true, websiteUrl: true, highlights: true, classIds: true, customFields: true } }),
    prisma.class.findMany({ where: { schoolId, isActive: true }, orderBy: { level: "asc" }, select: { id: true, name: true, level: true } }),
    prisma.stream.findMany({ where: { schoolId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true, name: true } }),
  ]);
  const offered = portal?.classIds.length ? classes.filter((klass) => portal.classIds.includes(klass.id)) : classes;
  return {
    session,
    classes: offered,
    streams,
    window: portalWindow(portal),
    isPublished: portal?.isPublished ?? true,
    opensOn: portal?.opensOn ?? null,
    closesOn: portal?.closesOn ?? null,
    instructions: portal?.instructions ?? null,
    mapUrl: portal?.mapUrl ?? null,
    websiteUrl: portal?.websiteUrl ?? null,
    highlights: portal?.highlights ?? [],
    customFields: readCustomFields(portal?.customFields),
  };
}

/** Publish or unpublish the public admission form. Settings and dates are kept either way. */
export async function setPortalPublished(ctx: TenantContext, isPublished: boolean): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ctx.db.admissionPortal.upsert({
    where: { schoolId: ctx.schoolId },
    create: { schoolId: ctx.schoolId, isPublished, updatedById: ctx.user.id },
    update: { isPublished, updatedById: ctx.user.id },
  });
  await recordAudit({
    action: "ADMISSION_PORTAL_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: isPublished ? "Online admission form published." : "Online admission form unpublished.",
  });
}

/** Check the answers to the school's extra questions; returns what is stored with each application. */
export function readCustomAnswers(fields: CustomField[], raw: Record<string, string | undefined>) {
  const errors: Record<string, string[]> = {};
  const answers: Array<{ key: string; label: string; value: string }> = [];
  for (const field of fields) {
    const value = (raw[field.key] ?? "").trim().slice(0, field.kind === "TEXTAREA" ? 2000 : 300);
    if (!value) {
      if (field.required) errors[`custom.${field.key}`] = [`Answer "${field.label}"`];
      continue;
    }
    if (field.kind === "SELECT" && !field.options.includes(value)) errors[`custom.${field.key}`] = ["Choose one of the options"];
    else if (field.kind === "DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors[`custom.${field.key}`] = ["Enter a date"];
    else answers.push({ key: field.key, label: field.label, value });
  }
  return { errors, answers };
}
