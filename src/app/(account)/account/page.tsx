import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ChangePasswordForm } from "@/features/account/change-password-form";
import { LanguageSelector } from "@/features/i18n/language-selector";
import { ROLE_LABEL } from "@/lib/roles";
import { PhotoUploader } from "@/features/photos/photo-uploader";
import { requireUser, type TenantContext } from "@/server/auth/current-user";
import type { SessionUser } from "@/server/auth/session";
import { photoUrlFor, selfTarget } from "@/server/people/photos";
import { forSchool } from "@/server/tenancy/scope";

/** The signed-in person's school context — the school always from their session. */
function tenantContextFor(user: SessionUser): TenantContext {
  return { user, schoolId: user.schoolId!, schoolSlug: user.schoolSlug ?? "", schoolName: user.schoolName ?? "", db: forSchool(user.schoolId!) };
}

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  // Photos belong to a school's records; the platform's own admins have none.
  const photoUrl = user.schoolId
    ? await photoUrlFor(tenantContextFor(user), await selfTarget(tenantContextFor(user)).catch(() => ({ type: "USER" as const, id: user.id })))
    : null;

  const details = [
    { label: "Name", value: `${user.firstName} ${user.lastName}` },
    { label: "Email", value: user.email },
    { label: "Role", value: ROLE_LABEL[user.role] },
    { label: "School", value: user.schoolName ?? "Platform" },
  ];

  return (
    <>
      <PageHeader title="Account" description="Your profile and sign-in settings." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Contact your school administrator to change these details.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {user.schoolId ? <PhotoUploader owner="SELF" name={`${user.firstName} ${user.lastName}`} url={photoUrl} /> : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              {details.map((detail) => (
                <div key={detail.label} className="contents">
                  <dt className="text-muted-foreground">{detail.label}</dt>
                  <dd className="break-all">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Changing your password signs you out on every other device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Language & appearance</CardTitle>
            <CardDescription>
              Your language is saved to your account and follows you to any device. Light or dark mode is kept on this
              device.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <LanguageSelector />
            <ThemeToggle />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
