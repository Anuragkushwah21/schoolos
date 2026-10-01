import type { Route } from "next";
import Link from "next/link";
import { ClockIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { deleteSlotAction } from "@/features/timetable/actions";
import { SlotForm } from "@/features/timetable/slot-form";
import { minutesToTime } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import {
  getCurrentSession,
  listSubjects,
  sectionOptions,
} from "@/server/academics/structure";
import { teacherOptions } from "@/server/people/teachers";
import { roomFilterOptions, roomOptions } from "@/server/academics/rooms";
import { orNotFound } from "@/server/page-helpers";
import {
  getRoomTimetable,
  getSectionTimetable,
  getSlot,
  getTeacherTimetable,
} from "@/server/timetable/service";

export const metadata: Metadata = { title: "Timetable" };

export default async function AdminTimetablePage(
  props: PageProps<"/school-admin/timetable">,
) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  if (!session) {
    return (
      <>
        <PageHeader icon={ClockIcon} tone="blue" title="Timetable" />
        <SetupNotice title="Timetable" need="session" />
      </>
    );
  }

  const editId = param(search.edit);
  const editing = editId ? await orNotFound(getSlot(ctx, editId)) : null;

  const [sections, teachers, subjects, rooms, roomChoices] = await Promise.all([
    sectionOptions(ctx, session.id),
    teacherOptions(ctx),
    listSubjects(ctx, { activeOnly: true }),
    roomFilterOptions(ctx),
    roomOptions(ctx, editing?.roomId),
  ]);

  const teacherId = param(search.teacher);
  const teacher = teacherId
    ? teachers.find((t) => t.value === teacherId)
    : undefined;
  const roomParam = param(search.room);
  const room =
    !teacher && roomParam
      ? rooms.find((r) => r.value === roomParam)
      : undefined;
  // Editing a period shows its section's week.
  const sectionId = editing
    ? editing.sectionId
    : teacher || room
      ? undefined
      : (param(search.section) ?? sections[0]?.value);
  const section = sections.find((s) => s.value === sectionId);

  const slots = teacher
    ? await getTeacherTimetable(ctx, teacher.value, session.id)
    : room
      ? await getRoomTimetable(ctx, room.value, session.id)
      : section
        ? await getSectionTimetable(ctx, section.value, session.id)
        : [];

  return (
    <>
      <PageHeader
        icon={ClockIcon}
        tone="blue"
        title="Timetable"
        description={`Weekly periods for ${session.name}. ${pluralize(slots.length, "period")} shown.`}
      />

      <div className="mb-2 flex flex-wrap gap-x-6">
        <FilterBar
          action="/school-admin/timetable"
          selects={[
            {
              name: "section",
              label: "Section",
              defaultValue: section?.value,
              options: sections,
            },
          ]}
        />
        <FilterBar
          action="/school-admin/timetable"
          selects={[
            {
              name: "teacher",
              label: "Teacher",
              defaultValue: teacher?.value,
              allLabel: "View by teacher…",
              options: teachers,
            },
          ]}
        />
        {rooms.length ? (
          <FilterBar
            action="/school-admin/timetable"
            selects={[
              {
                name: "room",
                label: "Room",
                defaultValue: room?.value,
                allLabel: "View by room…",
                options: rooms,
              },
            ]}
          />
        ) : null}
      </div>

      {!sections.length ? (
        <SetupNotice title="Timetable" need="sections">
          A timetable is drawn for one section at a time, and {session.name} has
          none yet.
        </SetupNotice>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="mb-3 font-semibold">
              {teacher
                ? teacher.label
                : room
                  ? `Room ${room.label}`
                  : section?.label}
            </h2>
            <TimetableGrid
              slots={slots.map((slot) => ({
                id: slot.id,
                dayOfWeek: slot.dayOfWeek,
                startMinute: slot.startMinute,
                endMinute: slot.endMinute,
                title: slot.subject.name,
                subtitle:
                  teacher || room
                    ? `${slot.section.class.name} – ${slot.section.name}`
                    : `${slot.teacher.firstName} ${slot.teacher.lastName}`,
                meta: slot.room,
              }))}
              actions={Object.fromEntries(
                slots.map((slot) => [
                  slot.id,
                  <span key={slot.id} className="flex">
                    <Button asChild variant="ghost" size="icon-xs">
                      <Link
                        href={
                          `/school-admin/timetable?edit=${slot.id}#period-form` as Route
                        }
                        aria-label="Edit period"
                      >
                        <PencilIcon aria-hidden />
                      </Link>
                    </Button>
                    <ActionButton
                      key={slot.id}
                      action={deleteSlotAction}
                      fields={{ slotId: slot.id }}
                      variant="ghost"
                      size="icon-xs"
                      confirm={{
                        title: "Remove this period?",
                        description: `${slot.subject.name} will be removed from the weekly timetable.`,
                        confirmLabel: "Remove",
                      }}
                    >
                      <span aria-hidden>×</span>
                      <span className="sr-only">Remove period</span>
                    </ActionButton>
                  </span>,
                ]),
              )}
            />
          </div>

          {section && !teacher && !room ? (
            <Card id="period-form" className="max-w-2xl scroll-mt-24">
              <CardHeader>
                <CardTitle>
                  {editing
                    ? `Edit ${editing.subject.name} period`
                    : "Add a period"}
                </CardTitle>
                <CardDescription>
                  For {section.label}.{" "}
                  {roomChoices.length ? null : (
                    <Link
                      href="/school-admin/academics/rooms"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Add rooms
                    </Link>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SlotForm
                  key={editing?.id ?? "new"}
                  sectionId={section.value}
                  subjects={subjects.map((s) => ({
                    value: s.id,
                    label: s.name,
                  }))}
                  teachers={teachers}
                  rooms={roomChoices}
                  slot={
                    editing
                      ? {
                          id: editing.id,
                          dayOfWeek: editing.dayOfWeek,
                          start: minutesToTime(editing.startMinute),
                          end: minutesToTime(editing.endMinute),
                          subjectId: editing.subjectId,
                          teacherId: editing.teacherId,
                          roomId: editing.roomId,
                          locked: editing.hasRecords,
                        }
                      : undefined
                  }
                  cancelHref={
                    `/school-admin/timetable?section=${section.value}` as Route
                  }
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
