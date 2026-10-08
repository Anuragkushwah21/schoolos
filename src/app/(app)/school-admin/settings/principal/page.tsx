import type { Metadata } from "next";
import { GraduationCapIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setPrincipalActiveAction } from "@/features/principal/actions";
import { PrincipalForm } from "@/features/principal/forms";
import { formatDateTime } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { listPrincipals } from "@/server/people/principals";

export const metadata: Metadata = { title: "Principal" };

/**
 * The Principal's login. The Principal oversees — attendance, classes,
 * teachers, exams, reports, notices — read-only; admissions, fees, payroll,
 * settings and users stay with the School Admin.
 */
export default async function PrincipalSettingsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const principals = await listPrincipals(ctx);
  return (
    <>
      <PageHeader
        icon={GraduationCapIcon}
        tone="purple"
        back={{ href: "/school-admin/settings", label: "Settings" }}
        title="Principal"
        description="The Principal sees the whole school to oversee it — attendance, classes, teachers, exams and results, reports and notices — but changes nothing. Admissions, fees, payroll, settings and users stay with you."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Principal logins</CardTitle>
            <CardDescription>They choose their own password from the activation email.</CardDescription>
          </CardHeader>
          <CardContent>
            {principals.length ? (
              <ul className="divide-y rounded-lg border">
                {principals.map((principal) => (
                  <li key={principal.id} className="flex flex-wrap items-center gap-3 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{`${principal.firstName} ${principal.lastName}`}</span>
                      <span className="text-muted-foreground block text-xs">{`${principal.email} · ${principal.lastLoginAt ? `last sign-in ${formatDateTime(principal.lastLoginAt)}` : "not signed in yet"}`}</span>
                    </span>
                    {!principal.isActive ? (
                      <StatusBadge status="INACTIVE" label="Login closed" tone="neutral" />
                    ) : principal.activatedAt ? (
                      <StatusBadge status="ACTIVE" label="Active" tone="positive" />
                    ) : (
                      <StatusBadge status="PENDING" label="Waiting for activation" tone="warning" />
                    )}
                    <ActionButton
                      action={setPrincipalActiveAction}
                      fields={{ userId: principal.id, active: principal.isActive ? "" : "on" }}
                      variant={principal.isActive ? "destructive" : "outline"}
                      size="sm"
                      confirm={principal.isActive ? { title: "Close this login?", description: "They are signed out everywhere and cannot sign in until you reopen it.", confirmLabel: "Close login" } : undefined}
                    >
                      {principal.isActive ? "Close login" : "Reopen"}
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No Principal login yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Add a Principal</CardTitle>
          </CardHeader>
          <CardContent>
            <PrincipalForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
