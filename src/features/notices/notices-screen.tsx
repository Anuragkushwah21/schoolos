import { MegaphoneIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { RichText } from "@/components/shared/rich-text";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { markNoticeReadAction } from "@/features/communication/actions";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TenantContext } from "@/server/auth/current-user";
import { myNotices } from "@/server/communication/notices";

/**
 * Notices — information from the school — and nothing else: no events, no
 * meetings. Each shows its title, a short description (expand for the
 * rest), when it was published, who it is for, whether this person has read
 * it, and when it expires. Expired notices are kept below as history.
 */

const AUDIENCE_LABEL: Record<string, string> = {
  ALL: "Everyone",
  TEACHERS: "Teachers",
  STUDENTS: "Students",
  PARENTS: "Parents",
  NON_TEACHING_STAFF: "Staff",
};
const SCOPE_LABEL: Record<string, string> = { SCHOOL: "", CLASS: " · one class", SECTION: " · one section", STUDENTS: " · named students" };

type NoticeRow = Awaited<ReturnType<typeof myNotices>>["live"][number];

function NoticeCard({ notice, expired = false }: { notice: NoticeRow; expired?: boolean }) {
  const unread = !notice.isRead && !expired;
  return (
    <Card className={cn("py-0", unread && "ring-primary/40 ring-2", expired && "opacity-80")}>
      <CardContent className="flex flex-col gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-base font-semibold">{notice.title}</h3>
          {expired ? (
            <StatusBadge status="EXPIRED" />
          ) : unread ? (
            <StatusBadge status="UNREAD" label="Unread" tone="info" />
          ) : (
            <StatusBadge status="READ" label="Read" tone="neutral" />
          )}
        </div>
        <details className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <p className="text-muted-foreground line-clamp-2 text-sm group-open:hidden">{notice.body}</p>
            <span className="text-primary text-xs font-medium group-open:hidden">Read full notice</span>
          </summary>
          <RichText text={notice.body} className="text-sm" />
        </details>
        <dl className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <div>
            <dt className="inline">Published: </dt>
            <dd className="text-foreground inline font-medium">{formatDate(notice.publishAt ?? notice.createdAt)}</dd>
          </div>
          <div>
            <dt className="inline">For: </dt>
            <dd className="text-foreground inline font-medium">
              {AUDIENCE_LABEL[notice.audience] ?? notice.audience}
              {SCOPE_LABEL[notice.scope] ?? ""}
            </dd>
          </div>
          {notice.expiresAt ? (
            <div>
              <dt className="inline">{expired ? "Expired: " : "Expires: "}</dt>
              <dd className="text-foreground inline font-medium">{formatDate(notice.expiresAt)}</dd>
            </div>
          ) : null}
        </dl>
        {unread ? (
          <div>
            <ActionButton action={markNoticeReadAction} fields={{ noticeId: notice.id }} variant="outline">
              Mark as read
            </ActionButton>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export async function NoticesScreen({ ctx }: { ctx: TenantContext }) {
  const { live, history, unread } = await myNotices(ctx);
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            Notices <span className="text-muted-foreground font-normal">· {unread ? `${unread} unread` : "all read"}</span>
          </h2>
          {unread ? (
            <ActionButton action={markNoticeReadAction} fields={{ noticeId: "ALL" }} variant="ghost">
              Mark all as read
            </ActionButton>
          ) : null}
        </div>
        {live.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {live.map((notice) => (
              <NoticeCard key={notice.id} notice={notice} />
            ))}
          </div>
        ) : (
          <EmptyState icon={MegaphoneIcon} tone="amber" title="No notices right now">
            When the school publishes a notice for you, it appears here.
          </EmptyState>
        )}
      </section>
      {history.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Notice history</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {history.map((notice) => (
              <NoticeCard key={notice.id} notice={notice} expired />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
