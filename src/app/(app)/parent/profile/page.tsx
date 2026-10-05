import type { Metadata, Route } from "next";
import Link from "next/link";
import {
  BellIcon,
  BookOpenIcon,
  CalendarCheckIcon,
  ChartColumnIcon,
  LockKeyholeIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldCheckIcon,
  WalletIcon,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/features/account/change-password-form";
import { LanguageSelector } from "@/features/i18n/language-selector";
import { MyProfileForm } from "@/features/parent/profile-form";
import { AvatarEditor } from "@/features/photos/avatar-editor";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { listMyChildren } from "@/server/parent/access";
import { getMyParentProfile } from "@/server/parent/self-profile";
import { photoUrlFor, selfTarget } from "@/server/people/photos";

export const metadata: Metadata = { title: "My account" };

const TABS = ["details", "children", "security"] as const;
type Tab = (typeof TABS)[number];

/**
 * The parent's own account, in one place: their details (which they correct
 * themselves), their children, and their sign-in and preferences.
 *
 * What a parent cannot change here is said plainly on the page: the sign-in
 * email, the links to their children and the relationship are the school's
 * record, so a parent can never attach themselves to another child.
 */
export default async function ParentProfilePage(props: PageProps<"/parent/profile">) {
  const ctx = await requireTenant("PARENT");
  const tabParam = param((await props.searchParams).tab);
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "details";

  const [profile, { children }, photoUrl] = await Promise.all([
    getMyParentProfile(ctx),
    listMyChildren(ctx),
    selfTarget(ctx)
      .then((target) => photoUrlFor(ctx, target))
      .catch(() => null),
  ]);
  const name = `${profile.firstName} ${profile.lastName}`;
  const address = [profile.addressLine, profile.city, profile.state, profile.postalCode].filter(Boolean).join(", ");
  const href = (next: Tab) => (next === "details" ? "/parent/profile" : `/parent/profile?tab=${next}`);

  return (
    <>
      {/* Header: a normal-sized photo you can change in place, who you are, how complete it is. */}
      <Card className="mb-6 gap-0 py-0">
        <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <AvatarEditor name={name} url={photoUrl} className="flex-1">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{name}</h1>
            <p className="text-muted-foreground text-sm">
              Parent · {ctx.schoolName} · {children.length} {children.length === 1 ? "child" : "children"}
            </p>
            <ul className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs sm:text-sm">
              <li className="inline-flex items-center gap-1.5">
                <PhoneIcon className="size-3.5" aria-hidden /> {profile.phone}
              </li>
              <li className="inline-flex min-w-0 items-center gap-1.5">
                <MailIcon className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{ctx.user.email}</span>
              </li>
              {address ? (
                <li className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPinIcon className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{profile.city ?? address}</span>
                </li>
              ) : null}
            </ul>
          </AvatarEditor>
          <div className="bg-muted/50 w-full rounded-xl p-3 sm:w-56 sm:shrink-0">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Profile complete</span>
              <strong className="tabular-nums">{profile.completeness}%</strong>
            </div>
            <div className="bg-border mt-1.5 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={profile.completeness} aria-valuemin={0} aria-valuemax={100} aria-label="Profile complete">
              <div className={`h-full rounded-full ${profile.completeness === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${profile.completeness}%` }} />
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs">{profile.completeness < 100 ? "Add the missing details below." : "All details added."}</p>
          </div>
        </CardContent>
      </Card>

      <ViewTabs
        label="My account"
        tabs={[
          { href: href("details"), label: "My details", active: tab === "details" },
          { href: href("children"), label: "My children", count: children.length, active: tab === "children" },
          { href: href("security"), label: "Sign-in & security", active: tab === "security" },
        ]}
      />

      {tab === "details" ? (
        <div className="grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader>
              <CardTitle>Personal information</CardTitle>
              <CardDescription>Keep these up to date — they are how the school reaches you. The office can see when you change them.</CardDescription>
            </CardHeader>
            <CardContent>
              <MyProfileForm details={profile} />
              {profile.selfUpdatedAt ? <p className="text-muted-foreground mt-3 text-xs">Last updated by you on {formatDateTime(profile.selfUpdatedAt)}.</p> : null}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="border-info/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheckIcon className="text-info-strong size-4" aria-hidden />
                  Kept by the school
                </CardTitle>
                <CardDescription>For your children&apos;s safety these change only through the school office.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  {[
                    { label: "Sign-in email", value: ctx.user.email },
                    { label: "Children", value: children.length ? children.map((child) => `${child.name} (${humanize(child.relationship).toLowerCase()})`).join(", ") : "None linked yet" },
                    { label: "ID proof", value: "Recorded by the office" },
                  ].map((row) => (
                    <div key={row.label}>
                      <dt className="text-muted-foreground text-xs">{row.label}</dt>
                      <dd className="mt-0.5 break-words">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "children" ? (
        children.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {children.map((child) => (
              <Card key={child.id} className="overflow-hidden">
                <div className="bg-primary-soft/60 flex items-center gap-4 px-5 py-4">
                  <PersonAvatar name={child.name} photoUrl={child.photoUrl} className="size-14" fallbackClassName="text-lg" />
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold">{child.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {child.sectionLabel ?? "Not placed this session"}
                      {child.rollNumber ? ` · Roll ${child.rollNumber}` : ""}
                    </p>
                  </div>
                </div>
                <CardContent className="flex flex-col gap-4 pt-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge status={child.relationship} label={`You are: ${humanize(child.relationship)}`} />
                    {child.isPrimary ? <StatusBadge status="ACTIVE" label="Primary contact" tone="info" /> : null}
                    {!child.current ? <StatusBadge status={child.status} /> : null}
                    <span className="text-muted-foreground font-mono">{child.admissionNumber}</span>
                  </div>
                  {child.current ? (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Attendance", icon: CalendarCheckIcon, path: "attendance" },
                        { label: "Results", icon: ChartColumnIcon, path: "results" },
                        { label: "Homework", icon: BookOpenIcon, path: "homework" },
                        { label: "Fees", icon: WalletIcon, path: "fees" },
                      ].map((link) => (
                        <Button key={link.path} asChild variant="outline" size="sm" className="justify-start">
                          <Link href={`/parent/children/${child.id}/${link.path}` as Route}>
                            <link.icon aria-hidden />
                            {link.label}
                          </Link>
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <Button asChild size="sm">
                    <Link href={`/parent/children/${child.id}` as Route}>Open {child.name.split(" ")[0]}&apos;s page</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No children linked yet">Ask the school office to link your children to this account.</EmptyState>
        )
      ) : null}

      {tab === "security" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LockKeyholeIcon className="size-5" aria-hidden />
                Change password
              </CardTitle>
              <CardDescription>Changing your password signs you out on every other device.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Language &amp; appearance</CardTitle>
                <CardDescription>Your language follows you to any device. Light or dark mode is kept on this device.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <LanguageSelector />
                <ThemeToggle />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BellIcon className="size-5" aria-hidden />
                  Notifications
                </CardTitle>
                <CardDescription>Notices, results, fees and meetings for your children.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline">
                  <Link href="/notifications">Open notifications</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
