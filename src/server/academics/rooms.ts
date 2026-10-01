import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { pluralize } from "@/lib/format";
import { ROOM_TYPE_LABEL, type RoomInput, type RoomTypeValue } from "@/lib/validation/rooms";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { getCurrentSession } from "@/server/academics/structure";
import { isForeignKeyViolation, isUniqueViolation } from "@/server/db/errors";

/**
 * The school's rooms.
 *
 * A room is never tied to a class: each timetable period picks its room, and
 * the timetable refuses two periods in one room at once (see
 * `server/timetable/service.ts`). A room any period has ever used — this
 * session or an earlier one — is history, so it can be deactivated but not
 * deleted.
 */

/** "Lab 1", " lab  1 " and "LAB 1" are the same room. */
export function roomKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export type RoomFilter = { q?: string; type?: RoomTypeValue; status?: "active" | "inactive" | "all" };

export async function listRooms(ctx: TenantContext, filter: RoomFilter = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  const q = filter.q?.trim();
  const where: Prisma.RoomWhereInput = {
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.status === "inactive" ? { isActive: false } : filter.status === "all" ? {} : { isActive: true }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { building: { contains: q, mode: "insensitive" } },
            { floor: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const rows = await ctx.db.room.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      capacity: true,
      building: true,
      floor: true,
      isActive: true,
      _count: { select: { timetableSlots: true } },
    },
  });
  const thisSession = session
    ? await ctx.db.timetableSlot.groupBy({
        by: ["roomId"],
        where: { academicSessionId: session.id, roomId: { in: rows.map((row) => row.id) } },
        _count: { _all: true },
      })
    : [];
  const perRoom = new Map(thisSession.map((row) => [row.roomId, row._count._all]));
  return rows
    .map(({ _count, ...room }) => ({ ...room, periodsEver: _count.timetableSlots, periodsThisSession: perRoom.get(room.id) ?? 0 }))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export type RoomRow = Awaited<ReturnType<typeof listRooms>>[number];

export async function getRoom(ctx: TenantContext, roomId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const room = await ctx.db.room.findFirst({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      type: true,
      capacity: true,
      building: true,
      floor: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { timetableSlots: true } },
    },
  });
  if (!room) throw new NotFoundError("That room was not found.");
  const { _count, ...rest } = room;
  return { ...rest, periodsEver: _count.timetableSlots };
}

/** "R101 · Science lab · 40 seats" — for the timetable's room picker. */
export function roomLabel(room: { name: string; type: RoomTypeValue; capacity: number | null; isActive?: boolean }): string {
  return [
    room.name,
    room.type === "CLASSROOM" ? null : ROOM_TYPE_LABEL[room.type],
    room.capacity ? `${room.capacity} seats` : null,
    room.isActive === false ? "inactive" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Rooms a period can be put in: the active ones, plus `keepId` — the room a
 * period already has, even if it has since been deactivated, so editing the
 * period does not silently drop it.
 */
export async function roomOptions(ctx: TenantContext, keepId?: string | null) {
  const rooms = await ctx.db.room.findMany({
    where: keepId ? { OR: [{ isActive: true }, { id: keepId }] } : { isActive: true },
    select: { id: true, name: true, type: true, capacity: true, isActive: true },
  });
  return rooms
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((room) => ({ value: room.id, label: roomLabel(room) }));
}

/** Every room, active or not, for viewing the timetable by room. */
export async function roomFilterOptions(ctx: TenantContext) {
  const rooms = await ctx.db.room.findMany({ select: { id: true, name: true, isActive: true } });
  return rooms
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((room) => ({ value: room.id, label: room.isActive ? room.name : `${room.name} (inactive)` }));
}

function roomData(input: RoomInput) {
  const name = cleanName(input.name);
  return {
    name,
    nameKey: roomKey(name),
    type: input.type,
    capacity: input.capacity,
    building: input.building,
    floor: input.floor,
    description: input.description,
  };
}

function duplicate(name: string) {
  return new ConflictError(`A room called "${cleanName(name)}" already exists. Use a different number or name.`);
}

export async function createRoom(ctx: TenantContext, input: RoomInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const data = roomData(input);
  if (await ctx.db.room.count({ where: { nameKey: data.nameKey } })) throw duplicate(data.name);
  try {
    const room = await ctx.db.room.create({ data: { schoolId: ctx.schoolId, ...data }, select: { id: true } });
    await recordAudit({
      action: "ROOM_CREATED",
      entityType: "Room",
      entityId: room.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Room ${data.name} added.`,
    });
    return room.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate(data.name);
    throw error;
  }
}

/** Edit a room. A new name is carried onto every period that uses it. */
export async function updateRoom(ctx: TenantContext, roomId: string, input: RoomInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const current = await ctx.db.room.findFirst({ where: { id: roomId }, select: { id: true, name: true } });
  if (!current) throw new NotFoundError("That room was not found.");
  const data = roomData(input);
  if (await ctx.db.room.count({ where: { nameKey: data.nameKey, id: { not: roomId } } })) throw duplicate(data.name);

  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.room.updateMany({ where: { schoolId: ctx.schoolId, id: roomId }, data });
      if (data.name !== current.name) {
        await tx.timetableSlot.updateMany({ where: { schoolId: ctx.schoolId, roomId }, data: { room: data.name } });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate(data.name);
    throw error;
  }
  await recordAudit({
    action: "ROOM_UPDATED",
    entityType: "Room",
    entityId: roomId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: data.name === current.name ? `Room ${data.name} updated.` : `Room ${current.name} renamed to ${data.name}.`,
  });
}

/**
 * Switch a room on or off. An inactive room cannot be picked for new periods;
 * periods already in it keep it until the admin moves them. Returns how many
 * periods this session still use it, so the page can say so.
 */
export async function setRoomActive(ctx: TenantContext, roomId: string, active: boolean): Promise<number> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const room = await ctx.db.room.findFirst({ where: { id: roomId }, select: { id: true, name: true } });
  if (!room) throw new NotFoundError("That room was not found.");
  await ctx.db.room.updateMany({ where: { id: roomId }, data: { isActive: active } });
  const session = await getCurrentSession(ctx);
  const inUse = session ? await ctx.db.timetableSlot.count({ where: { roomId, academicSessionId: session.id } }) : 0;
  await recordAudit({
    action: "ROOM_UPDATED",
    entityType: "Room",
    entityId: roomId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Room ${room.name} ${active ? "activated" : "deactivated"}.`,
  });
  return inUse;
}

/** Delete a room nobody has ever timetabled. Anything else is history. */
export async function deleteRoom(ctx: TenantContext, roomId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const room = await ctx.db.room.findFirst({
    where: { id: roomId },
    select: { id: true, name: true, _count: { select: { timetableSlots: true } } },
  });
  if (!room) throw new NotFoundError("That room was not found.");
  if (room._count.timetableSlots) {
    throw new ConflictError(
      `Room ${room.name} is used by ${pluralize(room._count.timetableSlots, "timetable period")} (this or an earlier session), so it is kept as history. Deactivate it instead.`,
    );
  }
  try {
    await ctx.db.room.deleteMany({ where: { id: roomId } });
  } catch (error) {
    // A period was put in it a moment ago.
    if (isForeignKeyViolation(error)) throw new ConflictError(`Room ${room.name} has just been timetabled, so it is kept. Deactivate it instead.`);
    throw error;
  }
  await recordAudit({
    action: "ROOM_DELETED",
    entityType: "Room",
    entityId: roomId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Room ${room.name} deleted.`,
  });
}
