import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HandshakeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { PtmFamiliesPanel } from "@/features/communication/ptm-panel";
import { formatDate, formatMinutes } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/current-user";
import { ptmClassList } from "@/server/communication/ptm";

export const metadata: Metadata = { title: "PTM class list" };

/** A teacher's families for one PTM: their own classes only (checked on the server). */
export default async function TeacherPtmPage(props: PageProps<"/teacher/meetings/[meetingId]">) {
  const ctx = await requireTenant("TEACHER");
  const { meetingId } = await props.params;
  const list = await ptmClassList(ctx, meetingId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  return (
    <>
      <PageHeader
        icon={HandshakeIcon}
        tone="cyan"
        title={list.ptm.title}
        description={`${formatDate(list.ptm.date)} · ${formatMinutes(list.ptm.startMinute)}${list.ptm.endMinute !== null ? `–${formatMinutes(list.ptm.endMinute)}` : ""} · your classes`}
        actions={
          <Link href="/teacher/meetings" className="text-primary text-sm font-medium hover:underline">
            All meetings
          </Link>
        }
      />
      <PtmFamiliesPanel ctx={ctx} meetingId={meetingId} />
    </>
  );
}
