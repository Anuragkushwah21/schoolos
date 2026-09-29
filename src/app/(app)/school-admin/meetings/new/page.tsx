import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { MeetingForm } from "@/features/communication/meeting-forms";
import { today, toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { meetingTargetOptions } from "@/server/communication/meetings";
import { extraClassPrefill } from "@/server/support/service";

export const metadata: Metadata = { title: "Schedule meeting" };

export default async function NewMeetingPage(props: PageProps<"/school-admin/meetings/new">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const supportId = param(search.support);
  const [options, extra] = await Promise.all([meetingTargetOptions(ctx), supportId ? extraClassPrefill(ctx, supportId) : Promise.resolve(null)]);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/meetings", label: "Meetings" }}
        title={extra ? `Extra class for ${extra.student}` : "Schedule meeting"}
        description={
          extra
            ? "Invites the student, their parents and their teacher. Pick the day and time; the support record is updated when you save."
            : "Set the time and choose who is invited. Nobody books a slot — everyone invited sees the meeting in their portal as soon as it is saved."
        }
      />
      <MeetingForm
        today={toDateInput(today())}
        {...options}
        prefill={
          extra
            ? {
                supportId: extra.supportId,
                title: extra.title,
                type: "GENERAL",
                audiences: extra.teacherId ? ["STUDENTS", "PARENTS", "TEACHERS"] : ["STUDENTS", "PARENTS"],
                scope: "PEOPLE",
                admissionNumbers: extra.admissionNumber,
                teacherIds: extra.teacherId ? [extra.teacherId] : [],
              }
            : undefined
        }
      />
    </>
  );
}
