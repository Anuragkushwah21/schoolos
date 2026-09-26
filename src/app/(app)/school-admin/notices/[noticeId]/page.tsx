import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { deleteNoticeAction } from "@/features/communication/actions";
import { NoticeForm } from "@/features/communication/forms";
import { toDateInput } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { getNotice } from "@/server/communication/notices";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Edit notice" };

export default async function EditNoticePage(props: PageProps<"/admin/notices/[noticeId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { noticeId } = await props.params;
  const notice = await orNotFound(getNotice(ctx, noticeId));

  return (
    <>
      <PageHeader
        back={{ href: "/admin/notices", label: "Notices" }}
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
        notice={{
          id: notice.id,
          title: notice.title,
          body: notice.body,
          audience: notice.audience,
          status: notice.status,
          isPublic: notice.isPublic,
          publishAt: notice.publishAt ? toDateInput(notice.publishAt) : "",
          expiresAt: notice.expiresAt ? toDateInput(notice.expiresAt) : "",
        }}
      />
    </>
  );
}
