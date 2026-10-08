import type { Metadata, Route } from "next";
import Link from "next/link";
import { BellIcon, CalendarDaysIcon, ChevronRightIcon, MegaphoneIcon, MessagesSquareIcon, SirenIcon, UsersIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { notificationCenter } from "@/server/alerts/center";
import { requireTenant } from "@/server/auth/current-user";
import { eventSummary } from "@/server/communication/events";
import { meetingSummary } from "@/server/communication/meetings";
import { communicationSummary } from "@/server/communication/notices";

export const metadata: Metadata = { title: "Communication" };

/**
 * The Communication Center: one place to reach notices, announcements,
 * emergency alerts, events, meetings / PTM and notifications. Each card
 * opens the existing module — nothing here is a second copy of it. Who sees a
 * message is chosen on the message itself: the entire school, teachers,
 * parents, students or staff, narrowed to a class, a section or a stream.
 */
export default async function CommunicationPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const [messages, events, meetings, notifications] = await Promise.all([communicationSummary(ctx), eventSummary(ctx), meetingSummary(ctx), notificationCenter(ctx)]);

  const cards: Array<{ title: string; description: string; href: Route; icon: typeof BellIcon; count?: string; action?: { href: Route; label: string } }> = [
    {
      title: "Notices",
      description: "Day-to-day notices: timings, uniform, documents.",
      href: "/school-admin/notices?kind=NOTICE" as Route,
      icon: MegaphoneIcon,
      count: `${messages.live.NOTICE} live`,
      action: { href: "/school-admin/notices/new?kind=NOTICE" as Route, label: "New notice" },
    },
    {
      title: "Announcements",
      description: "News for the school community: results, achievements, admissions.",
      href: "/school-admin/notices?kind=ANNOUNCEMENT" as Route,
      icon: UsersIcon,
      count: `${messages.live.ANNOUNCEMENT} live`,
      action: { href: "/school-admin/notices/new?kind=ANNOUNCEMENT" as Route, label: "New announcement" },
    },
    {
      title: "Events",
      description: "Sports day, annual function, trips — on dashboards and the website.",
      href: "/school-admin/events" as Route,
      icon: CalendarDaysIcon,
      count: `${events.upcoming} upcoming`,
      action: { href: "/school-admin/events/new" as Route, label: "New event" },
    },
    {
      title: "Meetings / PTM",
      description: "Invite parents, teachers or staff — by class, section or person.",
      href: "/school-admin/meetings" as Route,
      icon: MessagesSquareIcon,
      count: `${meetings.upcoming} upcoming`,
      action: { href: "/school-admin/meetings/new" as Route, label: "New meeting" },
    },
    {
      title: "Notifications",
      description: "What the school system has flagged for you, with read and unread.",
      href: "/notifications" as Route,
      icon: BellIcon,
      count: `${notifications.unread} unread`,
    },
  ];

  return (
    <>
      <PageHeader
        icon={MegaphoneIcon}
        tone="amber"
        title="Communication"
        description="Notices, announcements, emergency alerts, events, meetings and notifications — each reaches only the people it is addressed to."
      />

      <Card className="border-danger/40 mb-6">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <SirenIcon className="text-danger size-5" aria-hidden />
              Emergency alerts
            </CardTitle>
            <CardDescription>
              Shown at the top of everyone&apos;s notices and raised as an urgent notification for the people it reaches. {messages.live.EMERGENCY} live now.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={"/school-admin/notices?kind=EMERGENCY" as Route}>All alerts</Link>
            </Button>
            <Button asChild variant="destructive" size="sm">
              <Link href={"/school-admin/notices/new?kind=EMERGENCY" as Route}>Send emergency alert</Link>
            </Button>
          </div>
        </CardHeader>
        {messages.emergencies.length ? (
          <CardContent>
            <ul className="divide-y text-sm">
              {messages.emergencies.map((alert) => (
                <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/school-admin/notices/${alert.id}` as Route} className="font-medium hover:underline">
                    {alert.title}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {alert.publishAt ? formatDate(alert.publishAt) : "—"} · read by {alert.reads}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <Link href={card.href} className="flex items-center gap-2 hover:underline">
                  <card.icon className="text-primary size-5" aria-hidden />
                  {card.title}
                </Link>
                {card.count ? <StatusBadge status="INFO" tone="info" label={card.count} /> : null}
              </CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href={card.href}>
                  Open
                  <ChevronRightIcon aria-hidden />
                </Link>
              </Button>
              {card.action ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={card.action.href}>{card.action.label}</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground mt-6 text-xs">
        Audience on every message: the entire school, teachers, parents, students or staff — and within it one class, one section or one stream. Read and unread are
        kept per person. SMS and WhatsApp are not connected yet.
      </p>
    </>
  );
}
