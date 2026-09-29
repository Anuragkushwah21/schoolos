import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HandleComplaintForm } from "@/features/communication/complaint-forms";
import { ComplaintDetail } from "@/features/communication/complaint-views";
import { requireTenant } from "@/server/auth/current-user";
import { getComplaint } from "@/server/communication/complaints";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Complaint" };

export default async function TeacherComplaintPage(props: PageProps<"/teacher/complaints/[complaintId]">) {
  const ctx = await requireTenant("TEACHER");
  const { complaintId } = await props.params;
  // Anything not assigned to this teacher is not found.
  const complaint = await orNotFound(getComplaint(ctx, complaintId));
  return (
    <>
      <PageHeader back={{ href: "/teacher/complaints", label: "Complaints" }} title={complaint.subject} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <ComplaintDetail complaint={complaint} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Respond</CardTitle>
          </CardHeader>
          <CardContent>
            <HandleComplaintForm
              complaint={{ id: complaint.id, status: complaint.status, assignedToId: complaint.assignedTo?.id ?? null, response: complaint.response }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
