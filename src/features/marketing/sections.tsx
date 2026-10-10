import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  BellIcon,
  BookOpenIcon,
  BuildingIcon,
  CalendarClockIcon,
  CheckIcon,
  ClipboardCheckIcon,
  FileSpreadsheetIcon,
  FolderSearchIcon,
  GlobeIcon,
  GraduationCapIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  MegaphoneIcon,
  MessageCircleQuestionIcon,
  PlayCircleIcon,
  ReceiptIndianRupeeIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCogIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";

import { type AccentTone, TONE_GLOW, TONE_SOLID } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { LiveOffer, PublicPlan, UpcomingOffer } from "@/server/platform/marketing";

import { PlanCard } from "@/features/plans/plan-display";

import { RolePreview } from "./role-preview";

/*
 * The homepage says only what SchoolOS does today. Every screenshot is the
 * real app running the Live Demo's fictional school (public/marketing), and
 * every claim below maps to a shipped module. No testimonials, logos or
 * statistics — there are none to show yet — and nothing about online
 * payments, SMS or WhatsApp, which SchoolOS does not offer.
 */

function SectionHeading({
  eyebrow,
  title,
  description,
  id,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-2xl flex-col gap-3 text-center", className)}>
      <p className="bg-primary-soft text-primary-strong mx-auto w-fit rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">{eyebrow}</p>
      <h2 id={id} className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {description ? (
        <p className="text-muted-foreground text-lg text-pretty">{description}</p>
      ) : null}
    </div>
  );
}

/** A screenshot in a plain browser frame. */
export function BrowserFrame({ src, alt, priority = false, className }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <figure className={cn("bg-card shadow-lift overflow-hidden rounded-2xl border border-border/70", className)}>
      <div aria-hidden className="bg-muted/60 flex h-8 items-center gap-1.5 border-b px-3">
        <span className="size-2.5 rounded-full bg-red-400/80" />
        <span className="size-2.5 rounded-full bg-amber-400/80" />
        <span className="size-2.5 rounded-full bg-green-400/80" />
      </div>
      <Image src={src} alt={alt} width={2880} height={1800} priority={priority} sizes="(min-width: 1024px) 640px, 100vw" className="h-auto w-full" />
    </figure>
  );
}

/** A phone-width screenshot in a simple device frame. */
export function PhoneFrame({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={cn("bg-card shadow-lift w-[220px] shrink-0 overflow-hidden rounded-[2rem] border-[6px] border-slate-900 dark:border-slate-700", className)}>
      <Image src={src} alt={alt} width={780} height={1688} sizes="220px" className="h-auto w-full" />
    </figure>
  );
}

// -----------------------------------------------------------------------------
// Hero
// -----------------------------------------------------------------------------

export function Hero({ offer }: { offer: LiveOffer | undefined }) {
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-heading">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)] opacity-50"
      />
      <div aria-hidden className="absolute -top-40 -left-32 -z-10 size-[34rem] rounded-full bg-[var(--brand-from)] opacity-20 blur-[110px]" />
      <div aria-hidden className="absolute top-10 -right-24 -z-10 size-[30rem] rounded-full bg-[var(--brand-to)] opacity-20 blur-[110px]" />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 md:pt-20 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col items-start gap-6">
          {offer ? (
            <Link
              href={(offer.ctaHref ?? "/register") as Route}
              className="bg-card text-primary-strong ring-primary/20 hover:ring-primary/40 shadow-card inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 transition"
            >
              <SparklesIcon className="size-4" aria-hidden />
              {offer.title}
              {offer.priceLabel ? ` · ${offer.priceLabel}` : null}
              <ArrowRightIcon className="size-3.5" aria-hidden />
            </Link>
          ) : (
            <p className="bg-card text-primary-strong ring-primary/20 shadow-card inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1">
              <GraduationCapIcon className="size-4" aria-hidden />
              For schools from Nursery to Class 12
            </p>
          )}

          <h1 id="hero-heading" className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Your Entire School. <span className="text-brand-gradient">One Smart Platform.</span>
          </h1>

          <p className="text-muted-foreground max-w-xl text-lg text-pretty">
            Students, attendance, exams and report cards, fees and receipts,
            timetable, notices and a parent portal — each person signs in to
            exactly what their role needs, in English or Hindi, on any phone.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 px-5 text-base">
              <Link href="/demo">
                <PlayCircleIcon data-icon="inline-start" />
                Explore Live Demo
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-5 text-base">
              <Link href="/register">
                Register Your School
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>

          <ul className="text-muted-foreground grid gap-2 text-sm sm:grid-cols-3 sm:gap-4">
            {["No app to install", "Parents see only their children", "Each school's data kept private"].map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span className="bg-success-soft text-success-strong flex size-5 shrink-0 items-center justify-center rounded-full">
                  <CheckIcon className="size-3.5" aria-hidden />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <BrowserFrame src="/marketing/admin-dashboard.png" alt="The SchoolOS School Admin dashboard in the Live Demo: today's fee collection, admissions, pending actions and daily tasks for a fictional school." priority />
          <PhoneFrame
            src="/marketing/parent-dashboard.png"
            alt="The parent dashboard on a phone: two children, attendance this year and fees to pay."
            className="absolute -right-3 -bottom-12 hidden w-[140px] rounded-[1.5rem] border-4 sm:block lg:-right-8"
          />
          <p className="text-muted-foreground mt-3 text-xs sm:pr-40">Real screens from the Live Demo — the school and its people are fictional.</p>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Pain points → what SchoolOS does about each
// -----------------------------------------------------------------------------

const PROBLEMS = [
  {
    icon: FileSpreadsheetIcon,
    tone: "purple" as AccentTone,
    problem: "Manual Result Computation",
    pain: "Marks copied from registers into spreadsheets, totals and grades worked out by hand, report cards typed one by one.",
    solution: [
      "Teachers enter marks per test; totals, percentages and grades follow your grading rules",
      "Weighted final results — for example Unit Test 30% and Half-Yearly 70%",
      "Submit → verify → publish, so nothing reaches parents before it is checked",
      "Printable report cards for every student",
    ],
  },
  {
    icon: MessageCircleQuestionIcon,
    tone: "orange" as AccentTone,
    problem: "Parents Constantly Asking Questions",
    pain: "“Was my child in school today?” “What is the homework?” “How much fee is left?” — every day, on every phone.",
    solution: [
      "One parent login for all their children at the school",
      "Today's attendance, homework, notices and published results",
      "A fee statement showing what is due, paid and pending",
      "Simple screens in English or Hindi, in any phone browser",
    ],
  },
  {
    icon: WalletIcon,
    tone: "red" as AccentTone,
    problem: "Late or Missing Fee Payments",
    pain: "Instalments tracked in a notebook, late fees forgotten, and no clear list of who still owes what.",
    solution: [
      "Fee heads, instalments with due dates, and concessions with a reason",
      "Late fees added after the grace days your school sets",
      "Dues lists, collection reports and a ledger for every family",
      "Printed receipts for cash, UPI and cheque payments taken at your office",
    ],
    note: "Fees & finance is an optional module — check which plans include it. SchoolOS does not take online payments.",
  },
  {
    icon: FolderSearchIcon,
    tone: "blue" as AccentTone,
    problem: "Disorganized Student Records",
    pain: "Files in cupboards, the same child entered twice, and last year's class lost when students move up.",
    solution: [
      "One record per child, linked to their parents; siblings share a parent",
      "Admission numbers, photos, and every year's class placement kept",
      "A warning before the same child is added twice",
      "Bulk import from a CSV file, and search across the whole school",
    ],
  },
];

export function Problems() {
  return (
    <section id="problems" className="scroll-mt-20 py-20" aria-labelledby="problems-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading id="problems-heading" eyebrow="Sound familiar?" title="Does This Sound Like Your School?" />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map((item) => (
            <div key={item.problem} className="bg-card shadow-card relative isolate flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 p-6">
              <span aria-hidden className={cn("absolute -top-12 -right-12 -z-10 size-32 rounded-full blur-2xl", TONE_GLOW[item.tone])} />
              <span className={cn("flex size-11 items-center justify-center rounded-xl", TONE_SOLID[item.tone])}>
                <item.icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-semibold">{item.problem}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{item.pain}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Solutions() {
  return (
    <section id="solutions" className="bg-muted/50 scroll-mt-20 border-y py-20" aria-labelledby="solutions-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading id="solutions-heading" eyebrow="What changes" title="Each problem, and what SchoolOS does about it" description="Every point below is something you can try yourself in the Live Demo." />
        <ol className="mt-12 grid gap-5 lg:grid-cols-2">
          {PROBLEMS.map((item) => (
            <li key={item.problem} className="bg-card shadow-card flex flex-col gap-4 rounded-2xl border border-border/70 p-6">
              <div className="flex items-center gap-3">
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE_SOLID[item.tone])}>
                  <item.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Problem</p>
                  <h3 className="font-semibold">{item.problem}</h3>
                </div>
              </div>
              <ul className="flex flex-col gap-2.5 text-sm">
                {item.solution.map((point) => (
                  <li key={point} className="flex gap-2">
                    <CheckIcon className="text-success-strong mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              {"note" in item && item.note ? <p className="text-muted-foreground border-t pt-3 text-xs">{item.note}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Features, grouped
// -----------------------------------------------------------------------------

const FEATURE_GROUPS: Array<{ title: string; tone: AccentTone; items: Array<{ icon: typeof UsersIcon; title: string; body: string }> }> = [
  {
    title: "Students & admissions",
    tone: "blue",
    items: [
      { icon: UserPlusIcon, title: "Enquiries & admissions", body: "Walk-in enquiries, online applications from your school website, and admission with an admission number." },
      { icon: UsersIcon, title: "Students & parents", body: "Profiles, photos, guardians, status history and class placement for every session." },
    ],
  },
  {
    title: "Teaching & learning",
    tone: "green",
    items: [
      { icon: ClipboardCheckIcon, title: "Attendance", body: "Class registers marked by the class teacher, plus staff attendance and leave." },
      { icon: CalendarClockIcon, title: "Timetable", body: "Section timetables with rooms; clashes for a class or teacher are refused." },
      { icon: BookOpenIcon, title: "Homework", body: "Set by subject teachers and seen by students and parents." },
      { icon: GraduationCapIcon, title: "Exams & report cards", body: "Tests, grading rules, weighted final results, verification and printable report cards." },
    ],
  },
  {
    title: "Office & accounts",
    tone: "orange",
    items: [
      { icon: ReceiptIndianRupeeIcon, title: "Fees", body: "Instalments, concessions, late fees, family payment, receipts and dues reports." },
      { icon: BarChart3Icon, title: "Reports", body: "Attendance, results and fee reports, with exports." },
      { icon: UserCogIcon, title: "Staff", body: "Teachers and non-teaching staff, each with role-based access and leave." },
    ],
  },
  {
    title: "Communication",
    tone: "purple",
    items: [
      { icon: MegaphoneIcon, title: "Notices & events", body: "Addressed to staff, students, parents or everyone, with a school calendar." },
      { icon: BellIcon, title: "Meetings & alerts", body: "Parent–teacher meetings by invitation and in-app alerts for what needs attention." },
      { icon: GlobeIcon, title: "School website", body: "Your own public pages, notices, events and an admission form." },
    ],
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-20" aria-labelledby="features-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="features-heading"
          eyebrow="Features"
          title="The daily work of a school, in one place"
          description="Fees & finance, expenses, payroll, library, transport and inventory are optional modules — which ones you get depends on your plan."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.title} className="bg-card shadow-card relative isolate flex flex-col gap-5 overflow-hidden rounded-2xl border border-border/70 p-6">
              <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1.5", TONE_SOLID[group.tone])} />
              <h3 className="text-lg font-semibold">{group.title}</h3>
              <ul className="grid gap-4 sm:grid-cols-2">
                {group.items.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONE_SOLID[group.tone])}>
                      <item.icon className="size-4" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Role preview
// -----------------------------------------------------------------------------

export function Roles() {
  return (
    <section id="roles" className="bg-muted/50 relative isolate scroll-mt-20 overflow-hidden border-y py-20" aria-labelledby="roles-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="roles-heading"
          eyebrow="The right view for everyone"
          title="Five roles, five dashboards, one school"
          description="Each person sees what their role needs — and cannot see past it. These are the real screens from the Live Demo."
        />
        <RolePreview />
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Multi-campus
// -----------------------------------------------------------------------------

export function MultiCampus() {
  return (
    <section id="campuses" className="scroll-mt-20 py-20" aria-labelledby="campus-heading">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <p className="bg-info-soft text-info-strong w-fit rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">More than one campus</p>
          <h2 id="campus-heading" className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">Run every campus from one login</h2>
          <p className="text-muted-foreground text-lg text-pretty">
            The school you register becomes your first campus, under its own name. When you open another branch,
            ask for a new campus from <span className="text-foreground font-medium">My Schools</span>.
          </p>
          <ul className="flex flex-col gap-2.5 text-sm">
            {[
              "Each campus keeps its own students, staff, fees and records",
              "The owner switches between campuses without signing out",
              "How many campuses you can run depends on your plan",
              "New campuses are reviewed and approved by the SchoolOS team",
            ].map((point) => (
              <li key={point} className="flex gap-2">
                <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-card shadow-card flex flex-col gap-3 rounded-2xl border border-border/70 p-6" aria-hidden>
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">My Schools — example</p>
          {[
            { name: "Your school, as registered", place: "First campus", badge: "You are here" },
            { name: "Second campus", place: "Added after approval", badge: "Active" },
            { name: "Third campus", place: "Request waiting for review", badge: "Requested" },
          ].map((row) => (
            <div key={row.name} className="bg-muted/40 flex items-center gap-3 rounded-xl border p-3">
              <span className="bg-primary-soft text-primary-strong flex size-9 items-center justify-center rounded-lg">
                <BuildingIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{row.name}</p>
                <p className="text-muted-foreground text-xs">{row.place}</p>
              </div>
              <span className="bg-card rounded-full border px-2 py-0.5 text-xs">{row.badge}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Privacy & security
// -----------------------------------------------------------------------------

const GUARANTEES = [
  {
    icon: LockKeyholeIcon,
    title: "Each school is walled off",
    body: "Every record belongs to one school, and every query is scoped to the signed-in person's school on the server. Another school's data is not hidden from you — it is unreachable.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Access follows the role",
    body: "Teachers work with their own classes, parents see only their own children, and students never see fees. Permissions are checked on the server, not just hidden in the screen.",
  },
  {
    icon: KeyRoundIcon,
    title: "Sessions you can end",
    body: "Sessions live on the server, so a deactivated account or suspended school is signed out on its next click. Passwords are stored only as bcrypt hashes.",
  },
  {
    icon: ScrollTextIcon,
    title: "A record of who did what",
    body: "Sign-ins, approvals, admissions, fee and result changes are written to an audit log your admin can read.",
  },
];

export function Security() {
  return (
    <section id="security" className="relative isolate scroll-mt-20 overflow-hidden bg-slate-950 py-20 text-slate-50" aria-labelledby="security-heading">
      <div aria-hidden className="absolute -top-40 -left-20 -z-10 size-[30rem] rounded-full bg-indigo-600 opacity-30 blur-[120px]" />
      <div aria-hidden className="absolute -right-20 -bottom-40 -z-10 size-[28rem] rounded-full bg-cyan-500 opacity-20 blur-[120px]" />
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col gap-4">
          <p className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-cyan-300 uppercase">Privacy & security</p>
          <h2 id="security-heading" className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            Your children&apos;s records stay inside your school.
          </h2>
          <p className="text-lg text-slate-300">
            Many schools share SchoolOS, but no school can see another&apos;s data — not through a bug in one screen, and not by guessing a link.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {GUARANTEES.map((item) => (
            <div key={item.title} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white">
                <item.icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm leading-relaxed text-slate-300">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// How it works
// -----------------------------------------------------------------------------

const STEPS = [
  { title: "Try the Live Demo", body: "Open a sample school as an admin, principal, teacher, parent or student. No sign-up needed." },
  { title: "Register your school", body: "Give your school's name, city and a contact person, and confirm your email." },
  { title: "We review and approve", body: "The SchoolOS team checks the registration. Once approved, your admin signs in and sets up classes, staff and students." },
];

export function Steps() {
  return (
    <section className="py-20" aria-labelledby="steps-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading id="steps-heading" eyebrow="Getting started" title="From first look to first day" />
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="bg-card shadow-card relative flex flex-col gap-3 rounded-2xl border border-border/70 p-6">
              <span className={cn("flex size-10 items-center justify-center rounded-xl text-base font-bold", TONE_SOLID[(["blue", "purple", "green"] as const)[index] ?? "blue"])}>
                {index + 1}
              </span>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Offer band
// -----------------------------------------------------------------------------

/**
 * The Super Admin's offers, live and upcoming.
 *
 * Always rendered, so the "Offers" link in the header has somewhere to land:
 * with nothing running it says so and points at the contact page instead.
 */
export function OffersSection({
  offers,
  upcoming,
}: {
  offers: LiveOffer[];
  upcoming: UpcomingOffer[];
}) {
  return (
    <section id="offers" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-20 sm:px-6" aria-labelledby="offers-heading">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="bg-orange-soft text-orange-strong w-fit rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">Offers</p>
          <h2 id="offers-heading" className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Current offers for schools
          </h2>
        </div>
        <Link href="/contact" className="text-primary text-sm font-medium hover:underline">
          Ask us about an offer →
        </Link>
      </div>

      {offers.length === 0 && upcoming.length === 0 ? (
        <div className="bg-muted/40 flex flex-col items-start gap-3 rounded-2xl border p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            No offer is running right now. Talk to us for a price that fits your school.
          </p>
          <Button asChild variant="outline">
            <Link href="/contact">Contact us</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {offers.map((offer) => (
            <div
              key={offer.id}
              className="bg-brand-gradient relative flex flex-col gap-4 overflow-hidden rounded-3xl p-6 text-white shadow-[0_20px_40px_-24px_var(--primary)] sm:flex-row sm:items-center sm:justify-between sm:p-8"
            >
              <div
                aria-hidden
                className="absolute -top-16 -right-10 size-56 rounded-full bg-white/10 blur-2xl"
              />
              <div className="relative flex flex-col gap-1">
                <p className="text-sm font-medium text-white/80">Limited-time offer</p>
                <p className="text-2xl font-semibold">{offer.title}</p>
                {offer.description ? <p className="text-white/85">{offer.description}</p> : null}
                {offer.endsAt ? (
                  <p className="text-sm text-white/70">Valid until {formatDate(offer.endsAt)}</p>
                ) : null}
              </div>
              <div className="relative flex flex-col items-start gap-3 sm:items-end">
                {offer.priceLabel ? (
                  <p className="text-3xl font-semibold tabular-nums">{offer.priceLabel}</p>
                ) : null}
                <Button asChild size="lg" variant="secondary" className="h-10 px-5">
                  <Link href={(offer.ctaHref ?? "/register") as Route}>
                    {offer.ctaLabel ?? "Get started"}
                    <ArrowRightIcon data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}

          {upcoming.map((offer) => (
            <div
              key={offer.id}
              className="border-primary/30 bg-primary/5 flex flex-col gap-4 rounded-2xl border border-dashed p-6 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <p className="text-primary text-sm font-medium">
                  Coming soon · starts {formatDate(offer.startsAt)}
                </p>
                <p className="text-xl font-semibold">{offer.title}</p>
                {offer.description ? (
                  <p className="text-muted-foreground">{offer.description}</p>
                ) : null}
                {offer.endsAt ? (
                  <p className="text-muted-foreground text-sm">Runs until {formatDate(offer.endsAt)}</p>
                ) : null}
              </div>
              <div className="flex flex-col items-start gap-3 sm:items-end">
                {offer.priceLabel ? (
                  <p className="text-2xl font-semibold tabular-nums">{offer.priceLabel}</p>
                ) : null}
                <Button asChild variant="outline">
                  <Link href="/contact?topic=PRICING">Reserve this offer</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Pricing
// -----------------------------------------------------------------------------

export function Pricing({ plans }: { plans: PublicPlan[] }) {
  if (!plans.length) return null;
  return (
    <section id="pricing" className="bg-muted/50 scroll-mt-20 border-y py-20" aria-labelledby="pricing-heading">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="pricing-heading"
          eyebrow="Plans"
          title="One subscription for your whole organization"
          description="Every plan is a complete school system. Higher plans add campuses and more modules. Extra campuses are charged per campus — never as a second subscription."
        />
        <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <PlanCard key={plan.id} plan={plan} featured={plans.length >= 3 && index === 1}>
              <Button asChild size="lg" variant={plans.length >= 3 && index === 1 ? "default" : "outline"} className="h-10 w-full">
                <Link href={`/register?plan=${plan.slug}#register-form`}>{`Choose ${plan.name}`}</Link>
              </Button>
            </PlanCard>
          ))}
        </div>
        <p className="text-muted-foreground mt-6 text-center text-sm">
          <Link href="/register#compare" className="text-primary font-medium hover:underline">
            Compare all features
          </Link>{" "}
          · or try them in the{" "}
          <Link href="/demo" className="text-primary font-medium hover:underline">
            Live Demo
          </Link>
        </p>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// FAQ
// -----------------------------------------------------------------------------

const FAQS = [
  {
    q: "We are a small school. Is SchoolOS too much for us?",
    a: "No. You can start with just students, attendance and notices, and use more as you need it. Plans are chosen by the size of your school, and setup walks you through classes, sections, staff and students step by step.",
  },
  {
    q: "Do parents need to install an app?",
    a: "No. Parents open SchoolOS in any phone browser and can add it to their home screen. One login shows all their children at the school — and nobody else's. Screens are kept simple and work in English or Hindi.",
  },
  {
    q: "Can we run more than one campus?",
    a: "Yes, within your plan's campus allowance. The school you register is your first campus. Ask for another campus from My Schools; the SchoolOS team reviews it, and once approved you switch between campuses from one login. Each campus keeps its own records.",
  },
  {
    q: "Can parents pay fees online?",
    a: "Not yet. SchoolOS has no payment gateway. Your office records cash, UPI or cheque payments and prints the receipt; parents see the updated fee statement straight away.",
  },
  {
    q: "How do staff, parents and students get their accounts?",
    a: "Your admin creates them. Each person gets an email to set their own password, and the admin decides which roles and permissions they have. Young children (Nursery to Class 5) are reached through their parents' login.",
  },
  {
    q: "What happens after we register?",
    a: "You confirm your email, and the SchoolOS team reviews the registration. Once approved, your admin signs in to the school you registered — under the name you gave — and starts setting it up.",
  },
  {
    q: "What is the Live Demo?",
    a: "A private copy of a fictional school, made just for you, that you can explore as an admin, principal, teacher, parent or student. Everything works except sending email, changing passwords or plans, and adding campuses. Nothing is real, nothing is charged, and it is deleted after two hours.",
  },
  {
    q: "Can another school see our data?",
    a: "No. Every school's records are kept separate, and every request is checked on the server against the signed-in person's school and role.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 py-20" aria-labelledby="faq-heading">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <SectionHeading id="faq-heading" eyebrow="FAQ" title="Questions schools ask us" />
        <div className="bg-card shadow-card mt-12 divide-y rounded-2xl border border-border/70">
          {FAQS.map((item) => (
            <details key={item.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {item.q}
                <span
                  aria-hidden
                  className="bg-primary-soft text-primary-strong flex size-7 shrink-0 items-center justify-center rounded-full text-lg leading-none motion-safe:transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Closing call to action
// -----------------------------------------------------------------------------

export function ClosingCta() {
  return (
    <section className="px-4 pb-20 sm:px-6" aria-labelledby="cta-heading">
      <div className="bg-brand-gradient relative isolate mx-auto flex w-full max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-[0_30px_60px_-30px_var(--primary)]">
        <div aria-hidden className="bg-dots absolute inset-0 -z-10" />
        <h2 id="cta-heading" className="relative max-w-2xl text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
          See your school&apos;s day in SchoolOS.
        </h2>
        <p className="relative max-w-xl text-lg text-white/85">
          Open the Live Demo in one click — then register when you are ready.
        </p>
        <div className="relative flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" variant="secondary" className="h-11 px-5 text-base">
            <Link href="/demo">
              <PlayCircleIcon data-icon="inline-start" />
              Explore Live Demo
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost" className="h-11 px-5 text-base text-white hover:bg-white/15 hover:text-white">
            <Link href="/register">
              Register Your School
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
