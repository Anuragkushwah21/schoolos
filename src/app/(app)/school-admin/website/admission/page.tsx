import type { Metadata, Route } from "next";
import Link from "next/link";
import { ExternalLinkIcon, GlobeIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { CopyLink } from "@/components/shared/copy-link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setPortalPublishedAction } from "@/features/admissions/enquiry-actions";
import { PortalForm } from "@/features/admissions/portal-form";
import { PublicApplicationForm } from "@/features/admissions/public-application-form";
import { formatDate, today, toDateInput } from "@/lib/dates";
import { env } from "@/lib/env";
import { listClasses } from "@/server/academics/structure";
import { getPortalSettings, publicPortal } from "@/server/admissions/portal";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Admission form" };

/**
 * Website → Admission form: where the School Admin sets up and publishes the
 * public admission form — dates, classes, instructions, highlights, extra
 * questions — and sees exactly what parents will see. The applications it
 * brings in are handled under Students → Admissions → Online admissions.
 */
export default async function WebsiteAdmissionPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [portal, classes, live] = await Promise.all([getPortalSettings(ctx), listClasses(ctx, { activeOnly: true }), publicPortal(ctx.schoolId)]);
  const publicPath = `/schools/${ctx.schoolSlug}/admissions`;
  const published = live.isPublished;
  const state = live.window.state;
  const status =
    state === "OPEN"
      ? { label: "Published · taking applications", tone: "positive" as const }
      : state === "UNPUBLISHED"
        ? { label: "Unpublished", tone: "neutral" as const }
        : state === "NOT_YET"
          ? { label: `Published · opens ${formatDate(live.window.opensOn)}`, tone: "warning" as const }
          : { label: `Published · closed ${formatDate(live.window.closesOn)}`, tone: "warning" as const };

  return (
    <>
      <PageHeader
        icon={GlobeIcon}
        tone="cyan"
        title="Online admission form"
        description="Set up the form parents fill in on your website, publish it, and share the link. Applications arrive under Students → Admissions → Online admissions."
        actions={
          <Button asChild variant="outline">
            <Link href="/school-admin/admissions">See applications</Link>
          </Button>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Status <StatusBadge status={published ? "PUBLISHED" : "DRAFT"} tone={status.tone} label={status.label} />
            </CardTitle>
            <CardDescription>
              {published
                ? "Parents can open the form. The opening and closing dates below still decide when it takes applications."
                : "The public page says online admissions are not open. Your settings are kept."}
              {!live.session ? " No current session is set, so the form cannot take applications yet." : ""}
              {live.session && !live.classes.length ? " No classes are open for admission." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {published ? (
              <ActionButton
                action={setPortalPublishedAction}
                fields={{ isPublished: "false" }}
                variant="outline"
                confirm={{ title: "Unpublish the admission form?", description: "Parents will no longer be able to apply online until you publish it again.", confirmLabel: "Unpublish" }}
              >
                Unpublish
              </ActionButton>
            ) : (
              <ActionButton action={setPortalPublishedAction} fields={{ isPublished: "true" }}>
                Publish
              </ActionButton>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Share</CardTitle>
            <CardDescription>Put this link on your website, WhatsApp groups or posters.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CopyLink label="Public admission form" url={`${env.APP_URL}${publicPath}`} />
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`${publicPath}?preview=1` as Route} target="_blank">
                  <ExternalLinkIcon aria-hidden />
                  Preview public page
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/school-admin/website">School name, logo, address &amp; about</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-6 2xl:grid-cols-[1fr_1fr]">
        <PortalForm
          classes={classes.map((row) => ({ value: row.id, label: row.name }))}
          defaults={{
            opensOn: portal?.opensOn ? toDateInput(portal.opensOn) : "",
            closesOn: portal?.closesOn ? toDateInput(portal.closesOn) : "",
            instructions: portal?.instructions ?? "",
            mapUrl: portal?.mapUrl ?? "",
            websiteUrl: portal?.websiteUrl ?? "",
            highlights: portal?.highlights.join("\n") ?? "",
            classIds: portal?.classIds ?? [],
            fields: portal?.customFields ?? [],
          }}
        />

        <Card id="preview" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Form preview</CardTitle>
            <CardDescription>Exactly what parents fill in, with your saved classes and questions. Nothing here can be submitted.</CardDescription>
          </CardHeader>
          <CardContent>
            {live.classes.length ? (
              <PublicApplicationForm
                preview
                slug={ctx.schoolSlug}
                classes={live.classes.map((klass) => ({ value: klass.id, label: klass.name, level: klass.level }))}
                streams={live.streams.map((stream) => ({ value: stream.id, label: stream.name }))}
                customFields={live.customFields}
                today={toDateInput(today())}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Add classes under Academics to see the form.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
