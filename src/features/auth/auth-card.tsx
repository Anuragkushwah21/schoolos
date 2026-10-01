import Link from "next/link";
import { CalendarCheckIcon, HeartHandshakeIcon, ShieldCheckIcon } from "lucide-react";

import { Logo } from "@/components/shared/logo";

const POINTS = [
  { icon: CalendarCheckIcon, text: "Attendance, timetable and homework in one place" },
  { icon: HeartHandshakeIcon, text: "Parents see their own children's day" },
  { icon: ShieldCheckIcon, text: "Every school's records stay private" },
];

/**
 * The frame the sign-in, activation and reset pages share: the form on the
 * right and, on wide screens, a coloured panel about SchoolOS on the left.
 * On a phone only the form shows.
 */
export function AuthCard({
  title,
  subtitle,
  corner,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Shown in the top-right corner (the language selector on sign-in). */
  corner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="grid flex-1 lg:grid-cols-[1.05fr_1fr]">
      <aside className="bg-brand-gradient relative isolate hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <span aria-hidden className="bg-dots absolute inset-0 -z-10" />
        <span aria-hidden className="absolute -top-32 -right-24 -z-10 size-96 rounded-full bg-white/15 blur-3xl" />
        <span aria-hidden className="absolute -bottom-40 -left-20 -z-10 size-[28rem] rounded-full bg-[var(--brand-to)]/50 blur-3xl" />
        <Link href="/" className="w-fit rounded-xl bg-white/95 px-3 py-2 text-slate-900 shadow-lg" aria-label="SchoolOS home">
          <Logo />
        </Link>
        <div className="flex max-w-md flex-col gap-6">
          <p className="text-4xl leading-tight font-extrabold tracking-tight text-balance">Your whole school, on one screen.</p>
          <ul className="flex flex-col gap-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/90">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/70">For schools from Nursery to Class 12</p>
      </aside>

      <div className="bg-app-wash flex flex-col px-4 py-6">
        {corner ? <div className="flex justify-end">{corner}</div> : null}
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
          <div className="flex flex-col gap-3">
            <Link href="/" className="w-fit lg:hidden" aria-label="SchoolOS home">
              <Logo />
            </Link>
            <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div className="bg-card shadow-lift rounded-2xl border border-border/70 p-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
