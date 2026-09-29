import "server-only";

import type { AssetCategory, AssetCondition, AssetStatus, Prisma } from "@/generated/prisma/client";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { parseDateInput, today, toDateInput } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { humanize } from "@/lib/format";
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_STATUSES, type AssetInput } from "@/lib/validation/operations";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";
import type { ReportTable } from "@/server/reports/exports";

/**
 * Assets and inventory: what the school owns, where it is, who has it, and
 * what state it is in. Every status change and reassignment is kept as an
 * `AssetEvent`, so an asset's history can be read back. School Admin only.
 */

const CARD = {
  id: true,
  code: true,
  name: true,
  category: true,
  purchaseDate: true,
  purchaseCostMinor: true,
  quantity: true,
  location: true,
  assignedTo: true,
  condition: true,
  status: true,
  notes: true,
  updatedAt: true,
} as const;

export async function listAssets(
  ctx: TenantContext,
  filters: { q?: string; category?: AssetCategory; status?: AssetStatus; location?: string } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const where: Prisma.AssetWhereInput = {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.location ? { location: { equals: filters.location, mode: "insensitive" } } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { code: { contains: filters.q, mode: "insensitive" } },
            { assignedTo: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  return ctx.db.asset.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], take: 1000, select: CARD });
}

export async function assetLocations(ctx: TenantContext): Promise<string[]> {
  const rows = await ctx.db.asset.findMany({ where: { location: { not: null } }, distinct: ["location"], select: { location: true } });
  return rows.map((row) => row.location!).sort();
}

export async function getAsset(ctx: TenantContext, assetId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const asset = await ctx.db.asset.findFirst({
    where: { id: assetId },
    select: {
      ...CARD,
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, summary: true, fromStatus: true, toStatus: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!asset) throw new NotFoundError("That asset was not found.");
  return asset;
}

/** Create or update an asset, writing a history event for what changed. */
export async function saveAsset(ctx: TenantContext, input: AssetInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { assetId, ...data } = input;
  const before = assetId
    ? await ctx.db.asset.findFirst({ where: { id: assetId }, select: { status: true, assignedTo: true, location: true, condition: true } })
    : null;
  if (assetId && !before) throw new NotFoundError("That asset was not found.");

  const changes: string[] = [];
  if (before) {
    if (before.status !== data.status) changes.push(`status ${humanize(before.status)} → ${humanize(data.status)}`);
    if ((before.assignedTo ?? "") !== (data.assignedTo ?? "")) changes.push(`assigned to ${data.assignedTo ?? "nobody"}`);
    if ((before.location ?? "") !== (data.location ?? "")) changes.push(`moved to ${data.location ?? "no location"}`);
    if (before.condition !== data.condition) changes.push(`condition ${humanize(data.condition)}`);
  }

  try {
    const id = await ctx.db.$transaction(async (tx) => {
      let rowId: string;
      if (assetId) {
        await tx.asset.updateMany({ where: { id: assetId }, data });
        rowId = assetId;
      } else {
        rowId = (await tx.asset.create({ data: { ...data, schoolId: ctx.schoolId }, select: { id: true } })).id;
      }
      if (!assetId || changes.length) {
        await tx.assetEvent.create({
          data: {
            schoolId: ctx.schoolId,
            assetId: rowId,
            summary: assetId ? changes.join("; ") : `Added (${data.quantity} × ${data.name})`,
            fromStatus: before?.status ?? null,
            toStatus: data.status,
            actorId: ctx.user.id,
          },
        });
      }
      return rowId;
    });
    await recordAudit({ action: "ASSET_SAVED", entityType: "Asset", entityId: id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Asset ${data.code} ${assetId ? `updated${changes.length ? `: ${changes.join("; ")}` : ""}` : "added"}.` });
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("An asset with that code already exists.");
    throw error;
  }
}

/** Set the status of many assets at once, with a history event for each. */
export async function bulkAssetStatus(ctx: TenantContext, input: { assetIds: string[]; status: AssetStatus; note: string | null }): Promise<{ updated: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const ids = [...new Set(input.assetIds)];
  const assets = await ctx.db.asset.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  if (assets.length !== ids.length) throw new NotFoundError("An asset was not found.");
  const changing = assets.filter((asset) => asset.status !== input.status);

  await ctx.db.$transaction([
    ctx.db.asset.updateMany({ where: { id: { in: changing.map((asset) => asset.id) } }, data: { status: input.status } }),
    ctx.db.assetEvent.createMany({
      data: changing.map((asset) => ({
        schoolId: ctx.schoolId,
        assetId: asset.id,
        summary: `Status ${humanize(asset.status)} → ${humanize(input.status)}${input.note ? ` — ${input.note}` : ""}`,
        fromStatus: asset.status,
        toStatus: input.status,
        actorId: ctx.user.id,
      })),
    }),
  ]);
  await recordAudit({ action: "ASSET_STATUS_CHANGED", entityType: "Asset", entityId: null, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${changing.length} assets set to ${humanize(input.status).toLowerCase()}.`, metadata: { assetIds: changing.map((a) => a.id) } });
  return { updated: changing.length };
}

export const ASSET_IMPORT_COLUMNS = ["Code", "Name", "Category", "Quantity", "Location", "Assigned to", "Condition", "Status", "Purchase date", "Purchase cost (₹)", "Notes"] as const;

export type ImportError = { line: number; message: string };

const pick = <T extends string>(values: readonly T[], raw: string): T | undefined =>
  values.find((value) => value.toLowerCase().replace(/_/g, " ") === raw.toLowerCase().replace(/_/g, " ").trim());

/** Add assets from CSV. Codes must be new; every row is checked before anything is written. */
export async function importAssets(ctx: TenantContext, text: string): Promise<{ created: number; errors: ImportError[] }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  let records;
  try {
    records = readCsvRecords(text, { required: ["Code", "Name", "Category"], maxRows: 2000 });
  } catch (error) {
    if (error instanceof CsvFormatError) return { created: 0, errors: [{ line: 1, message: error.message }] };
    throw error;
  }
  const taken = new Set((await ctx.db.asset.findMany({ select: { code: true } })).map((row) => row.code.toLowerCase()));
  const errors: ImportError[] = [];
  const rows: Array<Prisma.AssetCreateManyInput> = [];

  for (const record of records) {
    const v = record.values;
    const problems: string[] = [];
    const code = v["code"] ?? "";
    if (!code) problems.push("code is missing");
    else if (taken.has(code.toLowerCase())) problems.push(`code ${code} is already used`);
    else taken.add(code.toLowerCase());
    if (!v["name"]) problems.push("name is missing");
    const category = pick(ASSET_CATEGORIES, v["category"] ?? "");
    if (!category) problems.push(`category "${v["category"]}" is not one of ${ASSET_CATEGORIES.map((c) => humanize(c)).join(", ")}`);
    const quantity = v["quantity"] ? Number(v["quantity"]) : 1;
    if (!Number.isInteger(quantity) || quantity < 1) problems.push("quantity must be a whole number of at least 1");
    const condition: AssetCondition | undefined = v["condition"] ? pick(ASSET_CONDITIONS, v["condition"]) : "GOOD";
    if (!condition) problems.push(`condition "${v["condition"]}" is not New, Good, Fair or Poor`);
    const status: AssetStatus | undefined = v["status"] ? pick(ASSET_STATUSES, v["status"]) : "ACTIVE";
    if (!status) problems.push(`status "${v["status"]}" is not recognised`);
    const purchaseRaw = v["purchase date"] ?? "";
    const purchaseDate = purchaseRaw ? parseDateInput(purchaseRaw) : null;
    if (purchaseRaw && !purchaseDate) problems.push("purchase date must be YYYY-MM-DD");
    if (purchaseDate && purchaseDate > today()) problems.push("purchase date is in the future");
    const costRaw = v["purchase cost"] ?? "";
    const cost = costRaw ? Number(costRaw.replace(/[,₹\s]/g, "")) : null;
    if (costRaw && (cost === null || !Number.isFinite(cost) || cost < 0)) problems.push("purchase cost must be a number");
    if (problems.length) {
      errors.push({ line: record.line, message: problems.join("; ") });
      continue;
    }
    rows.push({
      schoolId: ctx.schoolId,
      code,
      name: v["name"]!,
      category: category!,
      quantity,
      location: v["location"] || null,
      assignedTo: v["assigned to"] || null,
      condition: condition!,
      status: status!,
      purchaseDate,
      purchaseCostMinor: cost === null ? null : Math.round(cost * 100),
      notes: v["notes"] || null,
    });
  }
  if (errors.length) return { created: 0, errors };
  if (!rows.length) return { created: 0, errors: [{ line: 1, message: "The file has no rows." }] };

  await ctx.db.$transaction(async (tx) => {
    await tx.asset.createMany({ data: rows });
    const created = await tx.asset.findMany({ where: { code: { in: rows.map((row) => row.code) } }, select: { id: true } });
    await tx.assetEvent.createMany({ data: created.map((asset) => ({ schoolId: ctx.schoolId, assetId: asset.id, summary: "Added by CSV import", actorId: ctx.user.id })) });
  });
  await recordAudit({ action: "ASSETS_IMPORTED", entityType: "School", entityId: ctx.schoolId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${rows.length} assets imported from CSV.` });
  return { created: rows.length, errors: [] };
}

export async function assetsTable(ctx: TenantContext): Promise<ReportTable> {
  const rows = await listAssets(ctx);
  return {
    head: [...ASSET_IMPORT_COLUMNS],
    rows: rows.map((row) => [
      row.code,
      row.name,
      humanize(row.category),
      row.quantity,
      row.location ?? "",
      row.assignedTo ?? "",
      humanize(row.condition),
      humanize(row.status),
      row.purchaseDate ? toDateInput(row.purchaseDate) : "",
      row.purchaseCostMinor === null ? "" : (row.purchaseCostMinor / 100).toFixed(2),
      row.notes ?? "",
    ]),
  };
}

/** Counts by status and by category, for the inventory summary. */
export async function assetSummary(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [byStatus, byCategory] = await Promise.all([
    ctx.db.asset.groupBy({ by: ["status"], _sum: { quantity: true } }),
    ctx.db.asset.groupBy({ by: ["category"], where: { status: { notIn: ["DISPOSED", "LOST"] } }, _sum: { quantity: true } }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._sum.quantity ?? 0])) as Partial<Record<AssetStatus, number>>,
    byCategory: byCategory.map((row) => ({ category: row.category, quantity: row._sum.quantity ?? 0 })).sort((a, b) => b.quantity - a.quantity),
  };
}
