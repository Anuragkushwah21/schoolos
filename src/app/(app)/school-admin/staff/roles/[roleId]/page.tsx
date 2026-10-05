import type { Metadata, Route } from "next";
import Link from "next/link";
import { PlusIcon, UsersIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setRoleArchivedAction } from "@/features/staff/access-actions";
import { RoleProfileForm } from "@/features/staff/access-forms";
import { PermissionMatrix } from "@/features/staff/permission-matrix";
import { fullName } from "@/lib/format";
import { type BaseStaffRole, STAFF_ROLE_MODULES, STAFF_ROLE_NAMES, grantDef } from "@/lib/staff-access";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getRoleProfile } from "@/server/staff/roles";

export const metadata: Metadata = { title: "Role" };

const BASE_ROLE_OPTIONS = (Object.keys(STAFF_ROLE_NAMES) as BaseStaffRole[]).map((value) => ({ value, label: STAFF_ROLE_NAMES[value] }));

/**
 * One role: what it can do (as a module × action table), the staff in it,
 * and the permissions new staff start with — which the admin can push to
 * everyone already in the role. Each person's own permissions are on their
 * profile.
 */
export default async function RolePage(props: PageProps<"/school-admin/staff/roles/[roleId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { roleId } = await props.params;
  const role = await orNotFound(getRoleProfile(ctx, roleId));
  const current = role.staff.filter((person) => (CURRENT_EMPLOYEE as readonly string[]).includes(person.status));
  const former = role.staff.filter((person) => !current.includes(person));
  const modulesFirst = STAFF_ROLE_MODULES[role.baseRole as BaseStaffRole] ?? [];

  return (
    <>
      <PageHeader
        icon={UsersIcon}
        tone="purple"
        back={{ href: "/school-admin/staff", label: "Non-teaching staff" }}
        title={role.name}
        description={[role.isCustom ? `Custom role · works like ${STAFF_ROLE_NAMES[role.baseRole as BaseStaffRole].toLowerCase()}` : "Built-in role", `${current.length} current staff`, role.description].filter(Boolean).join(" · ")}
        actions={
          <Button asChild>
            <Link href="/school-admin/staff#add-staff">
              <PlusIcon aria-hidden />
              Add staff
            </Link>
          </Button>
        }
      />
      {role.archivedAt ? <p className="bg-warning-soft text-warning-strong mb-4 rounded-xl px-4 py-3 text-sm">This role is archived: new staff cannot be added to it.</p> : null}

      <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What new {role.name.toLowerCase()} staff can do</CardTitle>
              <CardDescription>
                The role&apos;s default permissions. &quot;Limited&quot; means the server narrows it — a driver sees only the students on their own route.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <PermissionMatrix grants={role.defaultGrants} baseRole={role.baseRole} />
              {role.defaultGrants.length ? (
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {role.defaultGrants.map((key) => (
                    <li key={key} className="bg-primary-soft text-primary-strong rounded-full px-2.5 py-1 font-medium">
                      {grantDef(key)?.label ?? key}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Only the common staff pages: profile, attendance, leave, notices, events and meetings.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Staff in this role</CardTitle>
              <CardDescription>Open someone for their profile, own permissions, work and substitutes.</CardDescription>
            </CardHeader>
            <CardContent>
              {current.length ? (
                <ul className="divide-y text-sm">
                  {current.map((person) => (
                    <li key={person.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <Link href={`/school-admin/staff/${person.id}` as Route} className="font-medium hover:underline">
                          {fullName(person)}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {person.employeeId}
                          {person.department ? ` · ${person.department}` : ""}
                          {person.phone ? ` · ${person.phone}` : ""}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">{person.grants.length} permissions</span>
                      {person.userId ? null : <StatusBadge status="INACTIVE" tone="neutral" label="No login" />}
                      <StatusBadge status={person.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={`No ${role.name.toLowerCase()} staff yet`}>Add someone from the Staff page and choose this role.</EmptyState>
              )}
              {former.length ? (
                <details className="mt-4 text-sm">
                  <summary className="text-muted-foreground cursor-pointer">{former.length} former</summary>
                  <ul className="mt-2 divide-y">
                    {former.map((person) => (
                      <li key={person.id} className="flex items-center gap-3 py-2">
                        <Link href={`/school-admin/staff/${person.id}` as Route} className="flex-1 hover:underline">
                          {fullName(person)}
                        </Link>
                        <StatusBadge status={person.status} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Edit role</CardTitle>
            <CardDescription>
              {role.isCustom ? "Name, what it works like, and" : "What it does, and"} the permissions new staff in it start with.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RoleProfileForm role={{ ...role, staffCount: current.length }} baseRoles={BASE_ROLE_OPTIONS} modulesFirst={modulesFirst} />
            {role.isCustom ? (
              <ActionButton
                action={setRoleArchivedAction}
                fields={{ roleId: role.id, archived: role.archivedAt ? "false" : "true" }}
                variant="ghost"
                size="sm"
                confirm={role.archivedAt ? undefined : { title: `Archive ${role.name}?`, description: "Only possible when nobody current is in it. It can be restored later.", confirmLabel: "Archive" }}
              >
                {role.archivedAt ? "Restore role" : "Archive role"}
              </ActionButton>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
