import "server-only";

import type { TransportTripStatus } from "@/generated/prisma/enums";
import { formatMinutes, today } from "@/lib/dates";
import { fullName } from "@/lib/format";
import type { TenantContext } from "@/server/auth/current-user";
import { findChild } from "@/server/parent/access";

/**
 * Today's school transport for one of a parent's children: route, stop, and
 * whether the pickup and the drop have happened — read from the same trip
 * marks the driver or attendant makes (`TransportTripLog`), with the time
 * they marked it.
 *
 * `findChild` checks the guardian link in the database first, so a parent
 * can never read another family's child; the reads below are all for this
 * one student. Nothing about other riders on the route is returned — not
 * their names, stops or marks.
 */

export type TripState = "PENDING" | TransportTripStatus;

export type ChildTransportToday = {
  student: string;
  route: string;
  vehicle: string | null;
  stop: string | null;
  /** The stop's planned times, when the school has set them. */
  scheduled: { pickup: string | null; drop: string | null };
  pickup: { state: TripState; at: Date | null };
  drop: { state: TripState; at: Date | null };
  /** Who drives and attends today: a substitute's name while one is covering. */
  driver: { name: string; phone: string | null; substitute: boolean } | null;
  attendant: { name: string; phone: string | null; substitute: boolean } | null;
};

export async function childTransportToday(ctx: TenantContext, studentId: string): Promise<ChildTransportToday | null> {
  const child = await findChild(ctx, studentId);
  const ride = await ctx.db.studentTransport.findFirst({
    where: { studentId: child.student.id, status: "ACTIVE" },
    select: {
      routeId: true,
      route: {
        select: {
          name: true,
          vehicle: { select: { registrationNo: true } },
          driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
          attendant: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      },
      stop: { select: { name: true, pickupMinute: true, dropMinute: true } },
    },
  });
  if (!ride) return null;

  const date = today();
  const crewIds = [ride.route.driver?.id, ride.route.attendant?.id].filter((value): value is string => !!value);
  const [marks, cover] = await Promise.all([
    // This child's own marks today, and nobody else's.
    ctx.db.transportTripLog.findMany({ where: { studentId: child.student.id, date }, select: { trip: true, status: true, markedAt: true } }),
    crewIds.length
      ? ctx.db.staffSubstitution.findMany({
          where: { originalStaffId: { in: crewIds }, coverRoutes: true, endedAt: null, startDate: { lte: date }, endDate: { gte: date } },
          select: { originalStaffId: true, substitute: { select: { firstName: true, lastName: true, phone: true } } },
        })
      : [],
  ]);
  const mark = (trip: "PICKUP" | "DROP") => {
    const row = marks.find((item) => item.trip === trip);
    return row ? { state: row.status as TripState, at: row.markedAt } : { state: "PENDING" as const, at: null };
  };
  const crew = (person: { id: string; firstName: string; lastName: string; phone: string | null } | null) => {
    if (!person) return null;
    const sub = cover.find((row) => row.originalStaffId === person.id);
    return sub ? { name: fullName(sub.substitute), phone: sub.substitute.phone, substitute: true } : { name: fullName(person), phone: person.phone, substitute: false };
  };
  const time = (minute: number | null | undefined) => (minute === null || minute === undefined ? null : formatMinutes(minute));

  return {
    student: child.student.name,
    route: ride.route.name,
    vehicle: ride.route.vehicle?.registrationNo ?? null,
    stop: ride.stop?.name ?? null,
    scheduled: { pickup: time(ride.stop?.pickupMinute), drop: time(ride.stop?.dropMinute) },
    pickup: mark("PICKUP"),
    drop: mark("DROP"),
    driver: crew(ride.route.driver),
    attendant: crew(ride.route.attendant),
  };
}
