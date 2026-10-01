import type { Route } from "next";
import Link from "next/link";
import { DoorOpenIcon } from "lucide-react";
import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteRoomAction,
  setRoomActiveAction,
} from "@/features/rooms/actions";
import { RoomForm } from "@/features/rooms/room-form";
import { pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import {
  ROOM_TYPE_LABEL,
  ROOM_TYPES,
  roomListQuery,
} from "@/lib/validation/rooms";
import { listRooms } from "@/server/academics/rooms";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Rooms" };

export default async function RoomsPage(
  props: PageProps<"/school-admin/academics/rooms">,
) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const filter = roomListQuery.parse({
    q: param(search.q),
    type: param(search.type) || undefined,
    status: param(search.status) || undefined,
  });
  const rooms = await listRooms(ctx, filter);
  const filtered = Boolean(
    filter.q || filter.type || (filter.status && filter.status !== "active"),
  );

  return (
    <>
      <PageHeader
        icon={DoorOpenIcon}
        tone="cyan"
        title="Rooms"
        description="Classrooms, labs and halls. Each timetable period picks its room; a room is never tied to one class."
        actions={
          <Button asChild>
            <Link href="#add-room">Add room</Link>
          </Button>
        }
      />

      <FilterBar
        action="/school-admin/academics/rooms"
        search={{
          name: "q",
          defaultValue: filter.q,
          placeholder: "Room, building or floor",
        }}
        selects={[
          {
            name: "type",
            label: "Type",
            defaultValue: filter.type,
            allLabel: "All types",
            options: ROOM_TYPES.map((value) => ({
              value,
              label: ROOM_TYPE_LABEL[value],
            })),
          },
          {
            name: "status",
            label: "Status",
            defaultValue: filter.status,
            allLabel: "Active",
            options: [
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All rooms" },
            ],
          },
        ]}
      />

      {rooms.length ? (
        <Card className="mb-6 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>This session</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((room) => {
                const href =
                  `/school-admin/academics/rooms/${room.id}` as Route;
                return (
                  <TableRow key={room.id}>
                    <TableCell className="font-medium">
                      <Link href={href} className="hover:underline">
                        {room.name}
                      </Link>
                    </TableCell>
                    <TableCell>{ROOM_TYPE_LABEL[room.type]}</TableCell>
                    <TableCell className="tabular-nums">
                      {room.capacity ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {[room.building, room.floor]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {room.periodsThisSession
                        ? pluralize(room.periodsThisSession, "period")
                        : "Free"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={room.isActive ? "ACTIVE" : "INACTIVE"}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="outline" size="sm">
                          <Link href={href}>View</Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`${href}#edit` as Route}>Edit</Link>
                        </Button>
                        <ActionButton
                          action={setRoomActiveAction}
                          fields={{
                            roomId: room.id,
                            active: room.isActive ? "false" : "true",
                          }}
                          variant="ghost"
                          confirm={
                            room.isActive
                              ? {
                                  title: `Deactivate ${room.name}?`,
                                  description:
                                    "It can no longer be picked for new periods. Periods already in it keep it until you move them.",
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
                            confirm={{
                              title: `Delete ${room.name}?`,
                              description:
                                "Only a room that has never been timetabled can be deleted. Otherwise, deactivate it.",
                              confirmLabel: "Delete",
                            }}
                          >
                            Delete
                          </ActionButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <div className="mb-6">
          <EmptyState
            icon={DoorOpenIcon}
            tone="cyan"
            title={
              filtered ? "No rooms match these filters." : "No rooms added yet."
            }
          >
            {filtered
              ? "Try another search or clear the filters."
              : "Add your classrooms, labs and halls, then pick them when you build the timetable."}
          </EmptyState>
        </div>
      )}

      <Card id="add-room" className="max-w-3xl scroll-mt-24">
        <CardHeader>
          <CardTitle>Add a room</CardTitle>
          <CardDescription>
            Room numbers are unique in your school, ignoring capitals and
            spaces.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoomForm />
        </CardContent>
      </Card>
    </>
  );
}
