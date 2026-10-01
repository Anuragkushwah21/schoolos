"use client";

import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellIcon, CheckCircle2Icon } from "lucide-react";

import { useT } from "@/components/i18n/i18n-provider";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Alert = {
  key: string;
  kind: string;
  title: string;
  detail: string;
  href: string | null;
  tone: "critical" | "warning" | "info";
  read: boolean;
};

const TONE_DOT = { critical: "bg-danger", warning: "bg-warning", info: "bg-info" } as const;

async function fetchAlerts(): Promise<Alert[]> {
  const response = await fetch("/api/v1/me/alerts", { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return ((await response.json()) as { data: Alert[] }).data;
}

/**
 * The header's notifications: the same derived alerts the dashboards show,
 * from `/api/v1/me/alerts`, with a count of unread ones on the bell. The
 * endpoint authenticates the session and scopes everything to the caller;
 * read state is kept on the caller's own account.
 */
export function NotificationBell() {
  const t = useT();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setAlerts(await fetchAlerts());
    } catch {
      setFailed(true);
    }
  }, []);

  // Once on load, so the badge is right before anyone opens the panel.
  useEffect(() => {
    let live = true;
    fetchAlerts()
      .then((rows) => live && setAlerts(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  async function markRead(body: { keys?: string[]; all?: boolean }) {
    setAlerts((current) =>
      current?.map((alert) => (body.all || body.keys?.includes(alert.key) ? { ...alert, read: true } : alert)) ?? null,
    );
    await fetch("/api/v1/me/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  }

  const unread = alerts?.filter((alert) => !alert.read).length ?? 0;

  return (
    <Popover onOpenChange={(open) => open && void load()}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `${t("notifications.title")} — ${t("notifications.newCount", { count: String(unread) })}` : t("notifications.title")}
        >
          <BellIcon className="size-[18px]" aria-hidden />
          {unread ? (
            <span className="bg-danger absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="text-sm font-semibold">
            {t("notifications.title")}
            {unread ? <span className="text-muted-foreground ml-2 font-normal">{t("notifications.newCount", { count: String(unread) })}</span> : null}
          </p>
          {unread ? (
            <Button variant="ghost" size="xs" onClick={() => void markRead({ all: true })}>
              {t("notifications.markAllRead")}
            </Button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {failed ? (
            <p className="text-danger-strong p-3 text-sm">{t("notifications.failed")}</p>
          ) : alerts === null ? (
            <p className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
              <Spinner size="xs" /> {t("common.loading")}
            </p>
          ) : alerts.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
              <CheckCircle2Icon className="text-success size-4" aria-hidden />
              {t("notifications.empty")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {alerts.slice(0, 12).map((alert) => {
                const body = (
                  <>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", alert.read ? "bg-muted-foreground/30" : TONE_DOT[alert.tone])} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", alert.read ? "text-muted-foreground" : "font-medium")}>{alert.title}</span>
                      {alert.detail ? <span className="text-muted-foreground block text-xs">{alert.detail}</span> : null}
                    </span>
                  </>
                );
                return (
                  <li key={alert.key}>
                    {alert.href ? (
                      <Link
                        href={alert.href as Route}
                        className="hover:bg-muted flex gap-3 rounded-lg p-2.5"
                        onClick={() => (alert.read ? undefined : void markRead({ keys: [alert.key] }))}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex gap-3 p-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/notifications">{t("notifications.viewAll")}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
