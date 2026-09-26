import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/forms/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteLessonMaterialAction } from "@/features/classwork/actions";
import { ClassActivityForm, LessonMaterialForm } from "@/features/classwork/forms";
import { humanize } from "@/lib/format";
import { DAY_SHORT, addDays, formatDate, formatMinutes, toDateInput, today } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { ACTIVITY_WINDOW_DAYS, getMyActivity } from "@/server/classwork/activities";
import { orNotFound } from "@/server/page-helpers";
import { getTeacherWeek } from "@/server/people/portal";

export const metadata: Metadata = { title: "Class record" };

/**
 * One lesson record, for the teacher scheduled to teach it.
 *
 * Saving goes back through the same upsert the create form uses, so this page
 * holds no update path of its own — the period and date identify the record.
 */
export default async function EditActivityPage(
  props: PageProps<"/teacher/activities/[activityId]">,
) {
  const ctx = await requireTenant("TEACHER");
  const { activityId } = await props.params;

  const [activity, week] = await Promise.all([
    orNotFound(getMyActivity(ctx, activityId)),
    getTeacherWeek(ctx),
  ]);

  const now = today();
  const earliest = addDays(now, -ACTIVITY_WINDOW_DAYS);
  const slot = activity.timetableSlot;
  const header = (
    <PageHeader
      back={{ href: "/teacher/activities", label: "Class records" }}
      title={activity.topic ?? slot.subject.name}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={activity.status} />
          {formatDate(activity.date)} · {formatMinutes(slot.startMinute)}–
          {formatMinutes(slot.endMinute)} · {slot.section.class.name} – {slot.section.name}
        </span>
      }
    />
  );

  // The service refuses an edit outside the window, so the form is not offered
  // for one. The record itself is still worth showing.
  if (activity.date < earliest) {
    return (
      <>
        {header}
        <EmptyState title={`This lesson is more than ${ACTIVITY_WINDOW_DAYS} days old`}>
          {activity.notes ?? "It can no longer be changed here. The school office can correct it."}
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
      <ClassActivityForm
        slots={(week?.slots ?? []).map((option) => ({
          value: option.id,
          dayOfWeek: option.dayOfWeek,
          label: `${DAY_SHORT[option.dayOfWeek]} ${formatMinutes(option.startMinute)} · ${option.subject.name} · ${option.section.class.name} – ${option.section.name}`,
        }))}
        defaultDate={toDateInput(now)}
        earliestDate={toDateInput(earliest)}
        activity={{
          timetableSlotId: slot.id,
          date: toDateInput(activity.date),
          status: activity.status,
          topic: activity.topic,
          notes: activity.notes,
          importantPoints: activity.importantPoints,
        }}
      />

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Study material</CardTitle>
              <CardDescription>
                What the class works from afterwards. Notes and practice work are typed here; a
                document is a link to somewhere the school already hosts it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {activity.materials.length ? (
                <ul className="divide-y rounded-lg border">
                  {activity.materials.map((material) => (
                    <li
                      key={material.id}
                      className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{material.title}</span>
                        <span className="text-muted-foreground block text-xs">
                          {humanize(material.kind)}
                          {material.url ? ` · ${material.url}` : ""}
                        </span>
                      </span>
                      <ActionButton
                        action={deleteLessonMaterialAction}
                        fields={{ materialId: material.id }}
                        variant="ghost"
                        size="xs"
                        pendingLabel="Removing…"
                        confirm={{
                          title: "Remove this material?",
                          description: "Your class will no longer see it against this lesson.",
                          confirmLabel: "Remove",
                        }}
                      >
                        Remove
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing attached yet.</p>
              )}

              <LessonMaterialForm classSessionId={activity.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
