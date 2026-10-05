import type { Route } from "next";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteMediaAction } from "@/features/website/actions";
import { MediaForm, WebsiteProfileForm } from "@/features/website/forms";
import { requireTenant } from "@/server/auth/current-user";
import { getWebsiteProfile, listMedia, listPages } from "@/server/website/admin";
import { publicPortal } from "@/server/admissions/portal";
import { CopyLink } from "@/components/shared/copy-link";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Website" };

export default async function WebsitePage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [profile, pages, media, portal] = await Promise.all([
    getWebsiteProfile(ctx),
    listPages(ctx),
    listMedia(ctx),
    publicPortal(ctx.schoolId),
  ]);

  const base = `/schools/${profile.slug}`;

  return (
    <>
      <PageHeader
        title="Website"
        description="Your school's public website and online admission form, in one place. Everything here is visible to anyone."
        actions={
          <Button asChild variant="outline">
            <Link href={base as Route} target="_blank">
              View website
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>School profile</CardTitle>
            <CardDescription>Shown on your homepage, footer and contact page.</CardDescription>
          </CardHeader>
          <CardContent>
            <WebsiteProfileForm profile={profile} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  Online admission form
                  <StatusBadge
                    status={portal.isPublished ? "PUBLISHED" : "DRAFT"}
                    tone={portal.window.state === "OPEN" ? "positive" : portal.isPublished ? "warning" : "neutral"}
                    label={portal.window.state === "OPEN" ? "Taking applications" : portal.isPublished ? "Published · outside its dates" : "Unpublished"}
                  />
                </CardTitle>
                <CardDescription>Dates, classes, instructions, questions, preview and publish.</CardDescription>
              </div>
              <Button asChild size="sm">
                <Link href="/school-admin/website/admission">Set up</Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <CopyLink label="Website" url={`${env.APP_URL}${base}`} />
              <CopyLink label="Admission form" url={`${env.APP_URL}${base}/admissions`} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Pages</CardTitle>
                <CardDescription>About, Academics, Facilities and anything else.</CardDescription>
              </div>
              <Button asChild size="sm">
                <Link href="/school-admin/website/pages/new">New page</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {pages.length ? (
                <ul className="divide-y rounded-lg border">
                  {pages.map((page) => (
                    <li key={page.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <Link href={`/school-admin/website/pages/${page.id}`} className="font-medium hover:underline">
                          {page.title}
                        </Link>
                        <p className="text-muted-foreground truncate text-xs">
                          {base}/{page.slug}
                        </p>
                      </div>
                      {page.isPublished ? (
                        <StatusBadge status="PUBLISHED" />
                      ) : (
                        <StatusBadge status="DRAFT" />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No pages yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Gallery</CardTitle>
              <CardDescription>
                Photos shown on your homepage. Paste an https:// link to an
                image you already host.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {media.length ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {media.map((item) => (
                    <li key={item.id} className="overflow-hidden rounded-lg border">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a school-supplied URL, not a bundled asset */}
                      <img src={item.url} alt={item.caption ?? ""} className="aspect-4/3 w-full object-cover" />
                      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                        <p className="text-muted-foreground truncate text-xs">{item.caption ?? "—"}</p>
                        <ActionButton
                          action={deleteMediaAction}
                          fields={{ mediaId: item.id }}
                          variant="ghost"
                          size="xs"
                          confirm={{
                            title: "Remove this photo?",
                            description: "It disappears from the school website's gallery.",
                            confirmLabel: "Remove",
                          }}
                        >
                          Remove
                        </ActionButton>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              <MediaForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
