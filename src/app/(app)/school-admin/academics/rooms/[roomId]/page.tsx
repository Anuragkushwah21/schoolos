import type { Route } from "next";
import Link from "next/link";
import { DoorOpenIcon } from "lucide-react";
import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteRoomAction, setRoomActiveAction } from "@/features/rooms/actions";
import { RoomForm } from "@/features/rooms/room-form";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { ROOM_TYPE_LABEL } from "@/lib/validation/rooms";
import { getRoom } from "@/server/academics/rooms";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getRoomTimetable } from "@/server/timetable/service";

export const metadata: Metadata = { title: "Room" };

export default async function RoomPage(props: PageProps<"/school-admin/academics/rooms/[roomId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { roomId } = await props.params;
  const room = await orNotFound(getRoom(ctx, roomId));
  const session = await getCurrentSession(ctx);
  const slots = session ? await getRoomTimetable(ctx, room.id, session.id) : [];

  const details: Array<[string, React.ReactNode]> = [
    ["Type", ROOM_TYPE_LABEL[room.type]],
    ["Capacity", room.capacity ? `${room.capacity} seats` : "Not set"],
    ["Building", room.building ?? "—"],
    ["Floor", room.floor ?? "—"],
    ["Status", <StatusBadge key="status" status={room.isActive ? "ACTIVE" : "INACTIVE"} />],
    ["Timetable use", room.periodsEver ? `${pluralize(slots.length, "period")} this session · ${pluralize(room.periodsEver, "period")} in all sessions` : "Never timetabled"],
    ["Added", formatDate(room.createdAt)],
  ];

  return (
    <>
      <PageHeader
        icon={DoorOpenIcon}
        tone="cyan"
        title={`Room ${room.name}`}
        description={room.description ?? undefined}
        back={{ href: "/school-admin/academics/rooms", label: "Rooms" }}
        actions={
          <>
            <ActionButton
              action={setRoomActiveAction}
              fields={{ roomId: room.id, active: room.isActive ? "false" : "true" }}
              variant="outline"
              size="default"
              confirm={
                room.isActive
                  ? {
                      title: `Deactivate ${room.name}?`,
                      description: "It can no longer be picked for new periods. Periods already in it keep it until you move them.",
                      confirmLabel: "Deactivate",
                    }
                  : undefined
              }
            >
              {room.isActive ? "Deactivate" : "Activate"}
            </ActionButton>
            {room.periodsEver ? null : (
              <ActionButton
                action={deleteRoomAction}
                fields={{ roomId: room.id }}
                variant="destructive"
                size="default"
                confirm={{ title: `Delete ${room.name}?`, description: "This room has never been timetabled, so it can be removed for good.", confirmLabel: "Delete" }}
              >
                Delete
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            {room.periodsEver ? (
              <CardDescription>Used in the timetable, so it is kept as history: it can be deactivated, not deleted.</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card id="edit" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Edit room</CardTitle>
            <CardDescription>A new name shows on every timetable that uses this room.</CardDescription>
          </CardHeader>
          <CardContent>
            <RoomForm room={room} />
          </CardContent>
        </Card>
      </div>

      <section className="mt-8" aria-labelledby="room-week">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="room-week" className="font-semibold">
            {session ? `Week in this room — ${session.name}` : "Week in this room"}
          </h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`/school-admin/timetable?room=${room.id}` as Route}>Open in timetable</Link>
          </Button>
        </div>
        {slots.length ? (
          <TimetableGrid
            slots={slots.map((slot) => ({
              id: slot.id,
              dayOfWeek: slot.dayOfWeek,
              startMinute: slot.startMinute,
              endMinute: slot.endMinute,
              title: slot.subject.name,
              subtitle: `${slot.section.class.name} – ${slot.section.name}${slot.section.stream ? ` (${slot.section.stream.name})` : ""}`,
              meta: `${slot.teacher.firstName} ${slot.teacher.lastName}`,
            }))}
          />
        ) : (
          <p className="text-muted-foreground text-sm">No periods in this room this session — it is free all week.</p>
        )}
      </section>
    </>
  );
}
