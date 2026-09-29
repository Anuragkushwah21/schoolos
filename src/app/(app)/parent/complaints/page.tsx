import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RaiseComplaintForm } from "@/features/communication/complaint-forms";
import { ComplaintList } from "@/features/communication/complaint-views";
import { requireTenant } from "@/server/auth/current-user";
import { listComplaints } from "@/server/communication/complaints";
import { listMyChildren } from "@/server/parent/access";

export const metadata: Metadata = { title: "Complaints & requests" };

export default async function ParentComplaintsPage() {
  const ctx = await requireTenant("PARENT");
  const [{ children }, rows] = await Promise.all([listMyChildren(ctx), listComplaints(ctx)]);
  return (
    <>
      <PageHeader title="Complaints & requests" description="Raise something with the school office and follow its response." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>New</CardTitle>
          </CardHeader>
          <CardContent>
            <RaiseComplaintForm childOptions={children.map((child) => ({ value: child.id, label: child.name }))} />
          </CardContent>
        </Card>
        <div>
          <ComplaintList rows={rows} closable />
        </div>
      </div>
    </>
  );
}
