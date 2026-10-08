import type { Metadata, Route } from "next";
import Link from "next/link";
import { Building2Icon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CampusRequestForm } from "@/features/campuses/forms";
import { requireTenant } from "@/server/auth/current-user";
import { campusRequestOverview } from "@/server/campuses/requests";

export const metadata: Metadata = { title: "Request new school/campus" };

/** Ask SchoolOS for another campus. Nothing is created until the Super Admin approves. */
export default async function CampusRequestPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const overview = await campusRequestOverview(ctx);
  return (
    <>
      <PageHeader icon={Building2Icon} tone="blue" title="Request New School/Campus" description="Tell SchoolOS about the new school. It is reviewed and, once approved, appears under My Schools with its own students, staff and data." />
      {overview.entitlement ? (
        <div className="bg-info-soft text-info-strong mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
          <span>{overview.entitlement}</span>
          <Button asChild size="sm" variant="outline">
            <Link href={"/school-admin/plan" as Route}>Upgrade Plan</Link>
          </Button>
        </div>
      ) : null}
      <Card className="max-w-4xl">
        <CardContent className="pt-6">
          <CampusRequestForm modules={overview.plan.modules} roles={overview.plan.roles} limits={overview.plan.limits} />
        </CardContent>
      </Card>
    </>
  );
}
