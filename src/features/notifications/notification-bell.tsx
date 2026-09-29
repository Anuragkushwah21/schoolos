"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { BellIcon, CheckCircle2Icon } from "lucide-react";

import { useT } from "@/components/i18n/i18n-provider";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Alert = { kind: string; title: string; detail: string; href: string | null; tone: "critical" | "warning" | "info" };

const TONE_DOT = { critical: "bg-danger", warning: "bg-warning", info: "bg-info" } as const;

/**
 * The header's notifications. They are the same derived alerts the dashboards
 * show (absence, homework due, meetings, notices…), fetched from
 * `/api/v1/me/alerts` only when opened — the endpoint authenticates the
 * session and scopes everything to the caller, and there is no second
 * notification store.
 */
export function NotificationBell() {
  const t = useT();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    setFailed(false);
    try {
      const response = await fetch("/api/v1/me/alerts", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setAlerts(((await response.json()) as { data: Alert[] }).data);
    } catch {
      setFailed(true);
    }
  }

  return (
    <Popover onOpenChange={(open) => open && void load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("notifications.title")}>
          <BellIcon className="size-[18px]" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">{t("notifications.title")}</p>
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
              {alerts.slice(0, 12).map((alert, index) => {
                const body = (
                  <>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[alert.tone])} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{alert.title}</span>
                      <span className="text-muted-foreground block text-xs">{alert.detail}</span>
                    </span>
                  </>
                );
                return (
                  <li key={`${alert.kind}-${index}`}>
                    {alert.href ? (
                      <Link href={alert.href as Route} className="hover:bg-muted flex gap-3 rounded-lg p-2.5">
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
      </PopoverContent>
    </Popover>
  );
}
