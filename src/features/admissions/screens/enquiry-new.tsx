import type { Route } from "next";
import { ContactRoundIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EnquiryForm } from "@/features/admissions/enquiry-form";
import { today, toDateInput } from "@/lib/dates";
import { listClasses, listStreams } from "@/server/academics/structure";
import { enquiryAssignees } from "@/server/admissions/enquiries";
import type { TenantContext } from "@/server/auth/current-user";

import type { DeskScope } from "./scope";


/** A walk-in, phone call or referral: the parent once, then each child. */
export async function NewEnquiryScreen({ ctx, scope }: { ctx: TenantContext; scope: DeskScope }) {
  const [classes, streams, assignees] = await Promise.all([listClasses(ctx, { activeOnly: true }), listStreams(ctx, { activeOnly: true }), enquiryAssignees(ctx)]);
  return (
    <>
      <PageHeader
        back={{ href: scope.base as Route, label: scope.admin ? "Walk-in admissions" : "Enquiries" }}
        icon={ContactRoundIcon}
        tone="purple"
        title="New enquiry"
        description="One family, one or more children. This is an enquiry, not an admission — no student or fee is created."
      />
      <EnquiryForm
        classes={classes.map((row) => ({ value: row.id, label: row.name, level: row.level }))}
        streams={streams.map((row) => ({ value: row.id, label: row.name }))}
        assignees={assignees}
        today={toDateInput(today())}
        allowFees={scope.canFees}
      />
    </>
  );
}
