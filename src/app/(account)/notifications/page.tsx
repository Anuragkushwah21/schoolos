import { BellIcon, CheckCircle2Icon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { markAlertsReadAction } from "@/features/notifications/actions";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { notificationCenter } from "@/server/alerts/center";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Notifications" };

const TONE_DOT = { critical: "bg-danger", warning: "bg-warning", info: "bg-info" } as const;

/** Every current notification for the signed-in person, read and unread. */
export default async function NotificationsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF");
  const [t, { alerts, unread }] = await Promise.all([getT(), notificationCenter(ctx)]);

  return (
    <>
      <PageHeader
        icon={BellIcon}
        tone="blue"
        title={t("notifications.title")}
        description={unread ? t("notifications.newCount", { count: String(unread) }) : t("notifications.pageHint")}
        actions={
          unread ? (
            <ActionButton action={markAlertsReadAction} fields={{ all: "true" }} variant="outline">
              {t("notifications.markAllRead")}
            </ActionButton>
          ) : null
        }
      />
      {alerts.length ? (
        <ul className="max-w-3xl divide-y rounded-xl border">
          {alerts.map((alert) => (
            <li key={alert.key} className={cn("flex flex-wrap items-start gap-3 px-4 py-3", alert.read ? "" : "bg-muted/40")}>
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", alert.read ? "bg-muted-foreground/30" : TONE_DOT[alert.tone])} aria-hidden />
              <span className="min-w-0 flex-1">
                {alert.href ? (
                  <Link href={alert.href as Route} className={cn("block text-sm hover:underline", alert.read ? "text-muted-foreground" : "font-medium")}>
                    {alert.title}
                  </Link>
                ) : (
                  <span className={cn("block text-sm", alert.read ? "text-muted-foreground" : "font-medium")}>{alert.title}</span>
                )}
                <span className="text-muted-foreground block text-xs">
                  {[alert.childName, alert.detail, alert.key.includes(":") ? null : formatDate(alert.at)].filter(Boolean).join(" · ")}
                </span>
              </span>
              {alert.read ? (
                <CheckCircle2Icon className="text-muted-foreground size-4" aria-label={t("notifications.allRead")} />
              ) : (
                <ActionButton action={markAlertsReadAction} fields={{ key: alert.key }} variant="ghost" size="xs">
                  {t("notifications.markRead")}
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t("notifications.empty")} />
      )}
    </>
  );
}
