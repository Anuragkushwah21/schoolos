import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RaiseComplaintForm } from "@/features/communication/complaint-forms";
import { ComplaintList } from "@/features/communication/complaint-views";
import { requireTenant } from "@/server/auth/current-user";
import { listComplaints } from "@/server/communication/complaints";

export const metadata: Metadata = { title: "Complaints & requests" };

export default async function StudentComplaintsPage() {
  const ctx = await requireTenant("STUDENT");
  const rows = await listComplaints(ctx);
  return (
    <>
      <PageHeader title="Complaints & requests" description="Raise something with the school office and follow its response." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>New</CardTitle>
          </CardHeader>
          <CardContent>
            <RaiseComplaintForm />
          </CardContent>
        </Card>
        <div>
          <ComplaintList rows={rows} closable />
        </div>
      </div>
    </>
  );
}
