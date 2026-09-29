import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { ComplaintList } from "@/features/communication/complaint-views";
import { requireTenant } from "@/server/auth/current-user";
import { listComplaints } from "@/server/communication/complaints";

export const metadata: Metadata = { title: "Complaints assigned to me" };

export default async function TeacherComplaintsPage() {
  const ctx = await requireTenant("TEACHER");
  const rows = await listComplaints(ctx);
  return (
    <>
      <PageHeader title="Complaints assigned to me" description="Only complaints the school office has assigned to you appear here." />
      <ComplaintList rows={rows} detailBase="/teacher/complaints" />
    </>
  );
}
