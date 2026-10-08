import type { Metadata, Route } from "next";
import Link from "next/link";
import { IdCardIcon, PlusIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkspaceCards } from "@/features/staff/workspace-cards";
import { requireTenant } from "@/server/auth/current-user";
import { staffCountsByRole } from "@/server/operations/staff";

export const metadata: Metadata = { title: "Staff workspaces" };

export default async function StaffWorkspacesPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const counts = await staffCountsByRole(ctx);
  return (
    <>
      <PageHeader
        icon={IdCardIcon}
        tone="blue"
        back={{ href: "/school-admin/staff" as Route, label: "Staff" }}
        title="Staff workspaces"
        description="Open any role's work and do it yourself, as School Admin — no staff account needed. Add people to a role whenever you hire."
        actions={
          <Button asChild>
            <Link href={"/school-admin/staff/new" as Route}>
              <PlusIcon aria-hidden />
              Add staff
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <WorkspaceCards counts={counts} />
        </CardContent>
      </Card>
    </>
  );
}
