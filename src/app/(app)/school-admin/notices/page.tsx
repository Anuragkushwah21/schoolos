import type { Metadata } from "next";
import Link from "next/link";
import { GlobeIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { listNoticesForAdmin } from "@/server/communication/notices";

export const metadata: Metadata = { title: "Notices" };

export default async function AdminNoticesPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const notices = await listNoticesForAdmin(ctx);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Notices"
        description="Announcements for staff, students and parents — and optionally the public website."
        actions={
          <Button asChild>
            <Link href="/school-admin/notices/new">New notice</Link>
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
                const scheduled = notice.status === "PUBLISHED" && notice.publishAt && notice.publishAt > now;
                const expired = notice.status === "PUBLISHED" && notice.expiresAt && notice.expiresAt < now;
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
                      {scheduled ? (
                        <StatusBadge status="PENDING" label="Scheduled" />
                      ) : expired ? (
                        <StatusBadge status="EXPIRED" label="Expired" />
                      ) : (
                        <StatusBadge status={notice.status} />
                      )}
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
        <EmptyState title="No notices yet" />
      )}
    </>
  );
}
