import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { deleteNoticeAction } from "@/features/communication/actions";
import { NoticeForm } from "@/features/communication/forms";
import { today, toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getNotice, noticeTargetOptions } from "@/server/communication/notices";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Edit notice" };

export default async function EditNoticePage(props: PageProps<"/school-admin/notices/[noticeId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { noticeId } = await props.params;
  const [notice, options] = await Promise.all([orNotFound(getNotice(ctx, noticeId)), noticeTargetOptions(ctx)]);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/notices", label: "Notices" }}
        title={notice.title}
        actions={
          <ActionButton
            action={deleteNoticeAction}
            fields={{ noticeId: notice.id }}
            variant="destructive"
            confirm={{
              title: "Delete this notice?",
              description: "It disappears everywhere at once. To keep a record, archive it instead.",
              confirmLabel: "Delete",
            }}
          >
            Delete
          </ActionButton>
        }
      />
      <NoticeForm
        minExpiry={toDateInput(notice.expiresAt && notice.expiresAt < today() ? notice.expiresAt : today())}
        notice={{
          id: notice.id,
          title: notice.title,
          body: notice.body,
          audience: notice.audience,
          status: notice.status,
          isPublic: notice.isPublic,
          publishAt: notice.publishAt ? toDateInput(notice.publishAt) : "",
          expiresAt: notice.expiresAt ? toDateInput(notice.expiresAt) : "",
          scope: notice.scope,
          classId: notice.classId,
          sectionId: notice.sectionId,
          admissionNumbers: notice.recipients.map((row) => row.student.admissionNumber).join(", "),
        }}
        classes={options.classes}
        sections={options.sections}
      />
    </>
  );
}
