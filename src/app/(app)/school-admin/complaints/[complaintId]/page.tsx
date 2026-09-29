import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HandleComplaintForm } from "@/features/communication/complaint-forms";
import { ComplaintDetail } from "@/features/communication/complaint-views";
import { requireTenant } from "@/server/auth/current-user";
import { assignableStaff, getComplaint } from "@/server/communication/complaints";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Complaint" };

export default async function AdminComplaintPage(props: PageProps<"/school-admin/complaints/[complaintId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { complaintId } = await props.params;
  const [complaint, staff] = await Promise.all([orNotFound(getComplaint(ctx, complaintId)), assignableStaff(ctx)]);
  return (
    <>
      <PageHeader back={{ href: "/school-admin/complaints", label: "Complaints" }} title={complaint.subject} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <ComplaintDetail complaint={complaint} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Handle</CardTitle>
          </CardHeader>
          <CardContent>
            <HandleComplaintForm
              staff={staff}
              complaint={{ id: complaint.id, status: complaint.status, assignedToId: complaint.assignedTo?.id ?? null, response: complaint.response }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
