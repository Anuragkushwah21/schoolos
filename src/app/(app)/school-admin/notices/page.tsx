import type { Metadata } from "next";
import Link from "next/link";
import { GlobeIcon, MegaphoneIcon, PlusIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { noticeStatus } from "@/lib/time-status";
import { requireTenant } from "@/server/auth/current-user";
import { listNoticesForAdmin } from "@/server/communication/notices";

export const metadata: Metadata = { title: "Notices" };

export default async function AdminNoticesPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const notices = await listNoticesForAdmin(ctx);
  const now = new Date();

  return (
    <>
      <PageHeader icon={MegaphoneIcon} tone="amber"
        title="Notices"
        description="Announcements for staff, students and parents — and optionally the public website."
        actions={
          <Button asChild>
            <Link href="/school-admin/notices/new">
              <PlusIcon aria-hidden />
              Create notice
            </Link>
          </Button>
        }
      />
      {notices.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Notice</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Dates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notices.map((notice) => {
                const timeStatus = noticeStatus(notice.status, notice.publishAt, notice.expiresAt, today(now));
                return (
                  <TableRow key={notice.id}>
                    <TableCell className="max-w-md whitespace-normal">
                      <Link href={`/school-admin/notices/${notice.id}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
                        {notice.title}
                        {notice.isPublic ? <GlobeIcon className="text-muted-foreground size-3.5" aria-label="On the public website" /> : null}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {notice.author ? `${notice.author.firstName} ${notice.author.lastName}` : "—"}
                      </p>
                    </TableCell>
                    <TableCell>{notice.audience === "ALL" ? "Everyone" : humanize(notice.audience)}</TableCell>
                    <TableCell>
                      <TimeStatusBadge status={timeStatus} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">
                      {notice.publishAt ? formatDate(notice.publishAt) : "—"}
                      {notice.expiresAt ? ` → ${formatDate(notice.expiresAt)}` : ""}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No notices yet."
          action={
            <Button asChild>
              <Link href="/school-admin/notices/new">Create notice</Link>
            </Button>
          }
        >
          Share holidays, exam dates or timing changes with parents, students and staff.
        </EmptyState>
      )}
    </>
  );
}
