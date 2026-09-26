import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { TimetableGrid } from "@/components/shared/timetable-grid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteSlotAction } from "@/features/timetable/actions";
import { SlotForm } from "@/features/timetable/slot-form";
import { pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, listSubjects, sectionOptions } from "@/server/academics/structure";
import { teacherOptions } from "@/server/people/teachers";
import { getSectionTimetable, getTeacherTimetable } from "@/server/timetable/service";

export const metadata: Metadata = { title: "Timetable" };

export default async function AdminTimetablePage(props: PageProps<"/school-admin/timetable">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const session = await getCurrentSession(ctx);

  if (!session) {
    return (
      <>
        <PageHeader title="Timetable" />
        <SetupNotice title="Timetable" need="session" />
      </>
    );
  }

  const [sections, teachers, subjects] = await Promise.all([
    sectionOptions(ctx, session.id),
    teacherOptions(ctx),
    listSubjects(ctx, { activeOnly: true }),
  ]);

  const teacherId = param(search.teacher);
  const teacher = teacherId ? teachers.find((t) => t.value === teacherId) : undefined;
  const sectionId = teacher ? undefined : (param(search.section) ?? sections[0]?.value);
  const section = sections.find((s) => s.value === sectionId);

  const slots = teacher
    ? await getTeacherTimetable(ctx, teacher.value, session.id)
    : section
      ? await getSectionTimetable(ctx, section.value, session.id)
      : [];

  return (
    <>
      <PageHeader
        title="Timetable"
        description={`Weekly periods for ${session.name}. ${pluralize(slots.length, "period")} shown.`}
      />

      <div className="mb-2 flex flex-wrap gap-x-6">
        <FilterBar
          action="/school-admin/timetable"
          selects={[{ name: "section", label: "Section", defaultValue: section?.value, options: sections }]}
        />
        <FilterBar
          action="/school-admin/timetable"
          selects={[
            { name: "teacher", label: "Teacher", defaultValue: teacher?.value, allLabel: "View by teacher…", options: teachers },
          ]}
        />
      </div>

      {!sections.length ? (
        <SetupNotice title="Timetable" need="sections">
          A timetable is drawn for one section at a time, and {session.name} has none yet.
        </SetupNotice>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="mb-3 font-semibold">{teacher ? teacher.label : section?.label}</h2>
            <TimetableGrid
              slots={slots.map((slot) => ({
                id: slot.id,
                dayOfWeek: slot.dayOfWeek,
                startMinute: slot.startMinute,
                endMinute: slot.endMinute,
                title: slot.subject.name,
                subtitle: teacher
                  ? `${slot.section.class.name} – ${slot.section.name}`
                  : `${slot.teacher.firstName} ${slot.teacher.lastName}`,
                meta: slot.room,
              }))}
              actions={Object.fromEntries(
                slots.map((slot) => [
                  slot.id,
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
                  </ActionButton>,
                ]),
              )}
            />
          </div>

          {section && !teacher ? (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Add a period</CardTitle>
                <CardDescription>For {section.label}.</CardDescription>
              </CardHeader>
              <CardContent>
                <SlotForm
                  sectionId={section.value}
                  subjects={subjects.map((s) => ({ value: s.id, label: s.name }))}
                  teachers={teachers}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
