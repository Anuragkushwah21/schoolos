import type { Route } from "next";
import Link from "next/link";
import { ChevronLeftIcon, type LucideIcon } from "lucide-react";

import { PersonAvatar } from "@/components/shared/person-avatar";
import { type AccentTone, TONE_ICON } from "@/components/shared/tones";
import { cn } from "@/lib/utils";

/**
 * The building blocks of a profile page — student, teacher or staff member —
 * so all three read the same way: a hero card (photo, name, status, ID chips
 * and the main actions), tabs, headline tiles and titled panels. Server
 * components; every figure shown comes from the caller's records.
 */

const DOT: Record<string, string> = { positive: "bg-success", warning: "bg-warning", negative: "bg-danger", neutral: "bg-muted-foreground/60", info: "bg-info" };

export function ProfileHero({
  back,
  session,
  name,
  photoUrl,
  presence = "neutral",
  badge,
  role,
  lines = [],
  chips = [],
  facts,
  actions,
}: {
  back: { href: Route; label: string };
  /** The academic session, shown top-right. */
  session?: string | null;
  name: string;
  photoUrl: string | null;
  /** The dot on the photo: active, on leave, left. */
  presence?: "positive" | "warning" | "negative" | "neutral" | "info";
  /** Status pill beside the name. */
  badge?: React.ReactNode;
  /** Designation or role, in the accent colour. */
  role?: string | null;
  /** Short muted lines under the name. */
  lines?: Array<string | null | undefined | false>;
  /** ID chips — admission number, class, roll, employee ID. */
  chips?: Array<{ label: string; tone?: AccentTone; icon?: LucideIcon } | null | undefined | false>;
  /** Small label–value boxes under the chips (department, campus). */
  facts?: Array<{ label: string; value: string; icon?: LucideIcon }>;
  actions?: React.ReactNode;
}) {
  const shownLines = lines.filter(Boolean) as string[];
  const shownChips = chips.filter(Boolean) as Array<{ label: string; tone?: AccentTone; icon?: LucideIcon }>;
  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Link href={back.href} className="text-muted-foreground hover:text-foreground inline-flex min-h-8 items-center gap-1 text-sm">
          <ChevronLeftIcon className="size-4" aria-hidden />
          {back.label}
        </Link>
        {session ? <span className="bg-primary-soft text-primary-strong rounded-full px-3 py-1 text-xs font-semibold tabular-nums">{session}</span> : null}
      </div>
      <section className="bg-card shadow-card relative isolate overflow-hidden rounded-3xl border border-border/70">
        <span className="absolute inset-x-0 top-0 -z-10 h-28 bg-[linear-gradient(135deg,var(--primary-soft),transparent_70%)]" aria-hidden />
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <PersonAvatar name={name} photoUrl={photoUrl} className="ring-card size-20 rounded-2xl ring-4 after:rounded-2xl sm:size-24 [&_*]:rounded-2xl" fallbackClassName="text-xl" />
              <span className={cn("ring-card absolute -right-1 -bottom-1 size-4 rounded-full ring-[3px]", DOT[presence])} aria-hidden />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight sm:text-[1.7rem]">{name}</h1>
                {badge}
              </div>
              {role ? <p className="text-primary text-sm font-semibold">{role}</p> : null}
              {shownLines.map((line) => (
                <p key={line} className="text-muted-foreground text-sm">
                  {line}
                </p>
              ))}
              {shownChips.length ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {shownChips.map((chip) => (
                    <span key={chip.label} className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold", TONE_ICON[chip.tone ?? "blue"])}>
                      {chip.icon ? <chip.icon className="size-3.5" aria-hidden /> : null}
                      {chip.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {facts?.length ? (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label} className="bg-muted/60 flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2">
                  {fact.icon ? (
                    <span className="bg-card text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                      <fact.icon className="size-4" aria-hidden />
                    </span>
                  ) : null}
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">{fact.label}</dt>
                    <dd className="truncate text-sm font-medium">{fact.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          ) : null}
          {actions ? <div className="bg-muted/60 flex flex-wrap gap-1.5 rounded-2xl p-1.5">{actions}</div> : null}
        </div>
      </section>
    </div>
  );
}

/** One button in the hero's action bar: icon over label; `primary` is the filled one. */
export function HeroAction({ href, icon: Icon, label, primary, external }: { href: string; icon: LucideIcon; label: string; primary?: boolean; external?: boolean }) {
  return (
    <Link
      href={href as Route}
      target={external ? "_blank" : undefined}
      className={cn(
        "flex min-h-14 min-w-20 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:flex-none sm:flex-row sm:gap-2 sm:text-sm",
        primary ? "bg-[linear-gradient(120deg,var(--brand-from),var(--primary))] text-white shadow-[0_6px_16px_-8px_var(--primary)]" : "text-foreground/80 hover:bg-card hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

/** Tabs under the hero: a soft track with the active tab raised. Plain links, so every tab has a URL. */
export function ProfileTabs({ tabs, label }: { tabs: Array<{ href: string; label: string; count?: number; active: boolean }>; label: string }) {
  return (
    <nav aria-label={label} className="bg-primary-soft/70 mb-5 flex gap-1 overflow-x-auto rounded-2xl p-1 [scrollbar-width:none]">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href as Route}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-colors",
            tab.active ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? <span className={cn("rounded-full px-1.5 text-xs tabular-nums", tab.active ? "bg-primary-soft" : "bg-card/70")}>{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** A headline tile: small caps label, icon chip, big figure, one line of context and an optional footer chip or bar. */
export function MetricTile({
  label,
  icon: Icon,
  tone = "blue",
  value,
  unit,
  sub,
  foot,
  progress,
  href,
  valueClassName,
}: {
  label: string;
  icon: LucideIcon;
  tone?: AccentTone;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  foot?: React.ReactNode;
  /** 0–100: a thin bar under the figure. */
  progress?: number | null;
  href?: string;
  valueClassName?: string;
}) {
  const body = (
    <div className={cn("bg-card shadow-card flex h-full flex-col gap-1.5 rounded-2xl border border-border/70 p-4", href && "hover:border-primary/40 transition-colors")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-[11px] leading-tight font-semibold tracking-wider uppercase">{label}</p>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_ICON[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className={cn("text-[1.7rem] leading-none font-extrabold tracking-tight tabular-nums", valueClassName)}>
        {value}
        {unit ? <span className="text-muted-foreground ml-0.5 text-sm font-semibold">{unit}</span> : null}
      </p>
      {sub ? <p className="text-muted-foreground text-sm">{sub}</p> : null}
      {progress !== undefined && progress !== null ? (
        <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full" role="presentation">
          <div className="bg-primary h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
      {foot ? <div className="mt-auto pt-1 text-xs">{foot}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href as Route} className="block h-full rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A small coloured chip for a tile's footer. */
export function TileChip({ tone = "blue", children }: { tone?: AccentTone; children: React.ReactNode }) {
  return <span className={cn("inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", TONE_ICON[tone])}>{children}</span>;
}

/** A titled panel: icon chip, title, an optional badge or link on the right. */
export function Panel({
  title,
  icon: Icon,
  tone = "blue",
  description,
  aside,
  children,
  id,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: AccentTone;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={cn("bg-card shadow-card scroll-mt-24 rounded-3xl border border-border/70 p-4 sm:p-5", className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONE_ICON[tone])}>
              <Icon className="size-[18px]" aria-hidden />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-lg leading-tight font-bold tracking-tight">{title}</h2>
            {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
          </div>
        </div>
        {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A soft row inside a panel — a guardian, an assignment, a document. */
export function SoftRow({ tone, children, className }: { tone?: "danger"; children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-3 rounded-2xl p-3", tone === "danger" ? "bg-danger-soft" : "bg-muted/60", className)}>{children}</div>;
}

/** A round icon link at the end of a row: call, email. */
export function RowIconLink({ href, icon: Icon, label, tone }: { href: string; icon: LucideIcon; label: string; tone?: "danger" }) {
  return (
    <a href={href} aria-label={label} title={label} className={cn("bg-card flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 shadow-sm", tone === "danger" ? "text-danger-strong" : "text-primary")}>
      <Icon className="size-4" aria-hidden />
    </a>
  );
}

/** Small caps label over a value. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-muted-foreground text-[11px] font-semibold tracking-wider uppercase", className)}>{children}</p>;
}
