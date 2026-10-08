import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ClipboardListIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CampusRequestForm } from "@/features/campuses/forms";
import { NotFoundError } from "@/lib/errors";
import { cleanLimits } from "@/lib/school-roles";
import { requireTenant } from "@/server/auth/current-user";
import { getMyCampusRequest } from "@/server/campuses/requests";

export const metadata: Metadata = { title: "Edit campus request" };

/** Correct a request while it is still pending; afterwards it is read-only. */
export default async function EditCampusRequestPage(props: PageProps<"/school-admin/campuses/requests/[requestId]/edit">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { requestId } = await props.params;
  const row = await getMyCampusRequest(ctx, requestId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (!row.editable) redirect(`/school-admin/campuses/requests/${row.id}` as Route);
  return (
    <>
      <PageHeader back={{ href: `/school-admin/campuses/requests/${row.id}` as Route, label: row.name }} icon={ClipboardListIcon} tone="blue" title="Edit campus request" description="You can change a request until SchoolOS starts reviewing it." />
      <Card className="max-w-4xl">
        <CardContent className="pt-6">
          <CampusRequestForm
            modules={row.plan.modules}
            roles={row.plan.roles}
            limits={row.plan.limits}
            existing={{
              id: row.id,
              name: row.name,
              addressLine: row.addressLine,
              city: row.city,
              state: row.state,
              postalCode: row.postalCode,
              contactName: row.contactName,
              contactEmail: row.contactEmail,
              contactPhone: row.contactPhone,
              affiliationBoard: row.affiliationBoard,
              expectedStudents: row.expectedStudents,
              expectedTeachers: row.expectedTeachers,
              expectedStaff: row.expectedStaff,
              notes: row.notes,
              modules: row.requestedModules,
              roles: row.requestedRoles,
              limits: cleanLimits(row.requestedLimits),
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
