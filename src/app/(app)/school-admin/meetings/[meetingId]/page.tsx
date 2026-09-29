import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteMeetingAction } from "@/features/communication/meeting-actions";
import { CancelMeetingForm, MeetingForm } from "@/features/communication/meeting-forms";
import { MeetingDetails } from "@/features/communication/meeting-views";
import { minutesToTime, today, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getMeetingForAdmin, meetingTargetOptions } from "@/server/communication/meetings";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Meeting" };

export default async function AdminMeetingPage(props: PageProps<"/school-admin/meetings/[meetingId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { meetingId } = await props.params;
  const meeting = await orNotFound(getMeetingForAdmin(ctx, meetingId));
  const options = meeting.canEdit ? await meetingTargetOptions(ctx) : null;

  return (
    <>
      <PageHeader back={{ href: "/school-admin/meetings", label: "Meetings" }} title={meeting.title} actions={<TimeStatusBadge status={meeting.timeStatus} />} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <MeetingDetails meeting={meeting} showCreator />
            </CardContent>
          </Card>
          {meeting.people.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Selected people</CardTitle>
                <CardDescription>For listed students, their guardians are invited when Parents is one of the groups.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {meeting.people.map((person, index) => (
                    <li key={index} className="flex justify-between gap-3 py-2">
                      <span>{person.name}</span>
                      <span className="text-muted-foreground">{person.detail}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {meeting.canCancel ? (
            <Card>
              <CardHeader>
                <CardTitle>Cancel</CardTitle>
                <CardDescription>The meeting stays in everyone&apos;s list, marked cancelled, so nobody turns up for it.</CardDescription>
              </CardHeader>
              <CardContent>
                <CancelMeetingForm meetingId={meeting.id} />
              </CardContent>
            </Card>
          ) : null}
          {meeting.canDelete ? (
            <Card>
              <CardHeader>
                <CardTitle>Delete</CardTitle>
                <CardDescription>Removes this cancelled meeting from every list. Meetings that took place are kept as history and cannot be deleted.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActionButton
                  action={deleteMeetingAction}
                  fields={{ meetingId: meeting.id }}
                  variant="destructive"
                  confirm={{ title: "Delete this meeting?", description: "It disappears from every portal. This cannot be undone.", confirmLabel: "Delete" }}
                >
                  Delete meeting
                </ActionButton>
              </CardContent>
            </Card>
          ) : null}
        </div>
        {options ? (
          <Card>
            <CardHeader>
              <CardTitle>Edit</CardTitle>
              <CardDescription>Changes show in invitees&apos; portals straight away. Once the meeting starts it can no longer be edited.</CardDescription>
            </CardHeader>
            <CardContent>
              <MeetingForm
                today={toDateInput(today())}
                {...options}
                meeting={{
                  id: meeting.id,
                  type: meeting.type,
                  title: meeting.title,
                  description: meeting.description ?? "",
                  date: toDateInput(meeting.date),
                  startMinute: minutesToTime(meeting.startMinute),
                  endMinute: meeting.endMinute === null ? "" : minutesToTime(meeting.endMinute),
                  location: meeting.location ?? "",
                  meetingLink: meeting.meetingLink ?? "",
                  audiences: meeting.audiences,
                  scope: meeting.scope,
                  sectionIds: meeting.sectionIds,
                  teacherIds: meeting.teacherIds,
                  staffIds: meeting.staffIds,
                  admissionNumbers: meeting.admissionNumbers.join(", "),
                }}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
