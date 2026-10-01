import type { Route } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  CalendarClockIcon,
  CheckIcon,
  ClipboardCheckIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCogIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";

import { type AccentTone, TONE_GLOW, TONE_SOLID } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LiveOffer, PublicPlan, UpcomingOffer } from "@/server/platform/marketing";

import { ProductPreview } from "./product-preview";

function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-2xl flex-col gap-3 text-center", className)}>
      <p className="bg-primary-soft text-primary-strong mx-auto w-fit rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">{eyebrow}</p>
      <h2 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {description ? (
        <p className="text-muted-foreground text-lg text-pretty">{description}</p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Hero
// -----------------------------------------------------------------------------

export function Hero({ offer }: { offer: LiveOffer | undefined }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)] opacity-50"
      />
      {/* Colour mesh behind the headline and the product preview. */}
      <div aria-hidden className="absolute -top-40 -left-32 -z-10 size-[34rem] rounded-full bg-[var(--brand-from)] opacity-20 blur-[110px]" />
      <div aria-hidden className="absolute top-10 -right-24 -z-10 size-[30rem] rounded-full bg-[var(--brand-to)] opacity-20 blur-[110px]" />
      <div aria-hidden className="absolute bottom-0 left-1/3 -z-10 size-[24rem] rounded-full bg-[var(--purple)] opacity-10 blur-[100px]" />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 pt-16 pb-24 sm:px-6 md:pt-24 lg:grid-cols-[1.05fr_1fr]">
        <div className="flex flex-col items-start gap-6">
          {offer ? (
            <Link
              href={(offer.ctaHref ?? "/register") as Route}
              className="bg-card text-primary-strong ring-primary/20 hover:ring-primary/40 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium shadow-card ring-1 transition"
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

          <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Run your whole school from{" "}
            <span className="text-brand-gradient">
              one screen.
            </span>
          </h1>

          <p className="text-muted-foreground max-w-xl text-lg text-pretty">
            Admissions, students, teachers, timetable, attendance and your
            school&apos;s own website — with a separate, private workspace for
            every school and the right view for every person in it.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 px-5 text-base">
              <Link href="/register">
                Register your school
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-5 text-base">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>

          <ul className="text-muted-foreground mt-2 grid gap-2 text-sm sm:grid-cols-3 sm:gap-4">
            {[
              "Private data for each school",
              "Works in any phone browser",
              "Parents see only their children",
            ].map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span className="bg-success-soft text-success-strong flex size-5 shrink-0 items-center justify-center rounded-full">
                  <CheckIcon className="size-3.5" aria-hidden />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>

        <ProductPreview />
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
    <section id="offers" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 sm:px-6" aria-labelledby="offers-heading">
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
// Features
// -----------------------------------------------------------------------------

const FEATURES = [
  {
    icon: UserPlusIcon,
    tone: "blue" as AccentTone,
    title: "Admissions",
    body: "Parents apply from your school website. Review, waitlist or accept — acceptance creates the student and guardian records for you.",
  },
  {
    icon: UsersIcon,
    tone: "purple" as AccentTone,
    title: "Students & guardians",
    body: "One record per child, one per guardian. Siblings share a parent, and every year's class placement is kept, not overwritten.",
  },
  {
    icon: UserCogIcon,
    tone: "green" as AccentTone,
    title: "Teachers & subjects",
    body: "Staff profiles, subject assignments by section, and class teachers — which decide exactly what each teacher can touch.",
  },
  {
    icon: CalendarClockIcon,
    tone: "orange" as AccentTone,
    title: "Timetable",
    body: "Build the weekly timetable section by section. Clashes for a class or a teacher are refused before they are saved.",
  },
  {
    icon: ClipboardCheckIcon,
    tone: "cyan" as AccentTone,
    title: "Attendance",
    body: "Teachers mark their own classes in seconds from a phone. Staff attendance sits alongside, and nothing is marked twice.",
  },
  {
    icon: MegaphoneIcon,
    tone: "red" as AccentTone,
    title: "Notices & events",
    body: "Address a notice to teachers, students, parents or everyone, and choose whether it also appears on the public website.",
  },
  {
    icon: GlobeIcon,
    tone: "amber" as AccentTone,
    title: "Your school website",
    body: "About, academics, facilities, notices, events and an admission form — under your own address, edited by your admin.",
  },
  {
    icon: BarChart3Icon,
    tone: "purple" as AccentTone,
    title: "Reports",
    body: "Attendance by class and by student across any date range, with the children who need attention listed first.",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Everything in one place"
          title="The daily work of a school, without the spreadsheets"
          description="Every module is included on every plan. Plans differ only in how many people they hold."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group bg-card shadow-card hover:shadow-lift relative isolate flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 p-6 transition-[box-shadow,transform] hover:-translate-y-1"
            >
              <span aria-hidden className={cn("absolute -top-12 -right-12 -z-10 size-32 rounded-full blur-2xl transition-opacity", TONE_GLOW[feature.tone])} />
              <span className={cn("flex size-11 items-center justify-center rounded-xl", TONE_SOLID[feature.tone])}>
                <feature.icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

const ROLES = [
  {
    icon: UserCogIcon,
    role: "School admin",
    tone: "blue" as AccentTone,
    points: [
      "Live counts of students, staff and admissions",
      "Classes, sections, subjects and sessions",
      "Timetable, attendance and reports",
      "Your public website and notices",
    ],
  },
  {
    icon: ClipboardCheckIcon,
    role: "Teacher",
    tone: "green" as AccentTone,
    points: [
      "Today's periods the moment they sign in",
      "Attendance for their own classes only",
      "Their weekly timetable",
      "Staff notices",
    ],
  },
  {
    icon: GraduationCapIcon,
    role: "Student",
    tone: "cyan" as AccentTone,
    points: [
      "Class, section and roll number",
      "Today's timetable and the full week",
      "Their own attendance record",
      "Notices and upcoming events",
    ],
  },
  {
    icon: HeartHandshakeIcon,
    role: "Parent",
    tone: "orange" as AccentTone,
    points: [
      "Every child at the school in one login",
      "Whether each child is in class today",
      "Attendance history and timetable",
      "Notices meant for parents",
    ],
  },
];

export function Roles() {
  return (
    <section id="roles" className="bg-muted/50 relative isolate scroll-mt-20 overflow-hidden border-y py-24">
      <div aria-hidden className="absolute -top-32 right-0 -z-10 size-96 rounded-full bg-[var(--brand-to)] opacity-10 blur-[100px]" />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="The right view for everyone"
          title="Four people, four dashboards, one school"
          description="Each person signs in to exactly what their role needs — and cannot see past it."
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((item) => (
            <div key={item.role} className="bg-card shadow-card relative isolate flex flex-col gap-4 overflow-hidden rounded-2xl border border-border/70 p-6">
              <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1.5", TONE_SOLID[item.tone])} />
              <span className={cn("flex size-11 items-center justify-center rounded-xl", TONE_SOLID[item.tone])}>
                <item.icon className="size-5" aria-hidden />
              </span>
              <h3 className="text-lg font-semibold">{item.role}</h3>
              <ul className="flex flex-col gap-2.5 text-sm">
                {item.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="text-muted-foreground">{point}</span>
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
// Security
// -----------------------------------------------------------------------------

const GUARANTEES = [
  {
    icon: LockKeyholeIcon,
    title: "Walled off by the database itself",
    body: "Every record carries its school, and the database refuses any link between two schools' records. Another school's data is not hidden from you — it is unreachable.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Teachers see only their classes",
    body: "Being in the right school is not enough. A teacher can mark attendance only for sections they are actually assigned to teach.",
  },
  {
    icon: KeyRoundIcon,
    title: "Sign-outs that happen at once",
    body: "Sessions live on the server, so a deactivated account or suspended school is signed out on its very next click — not when a token expires.",
  },
  {
    icon: ScrollTextIcon,
    title: "A record of who did what",
    body: "Sign-ins, approvals, admissions and attendance changes are written to an audit log. Passwords are stored only as bcrypt hashes.",
  },
];

export function Security() {
  return (
    <section id="security" className="relative isolate scroll-mt-20 overflow-hidden bg-slate-950 py-24 text-slate-50">
      <div aria-hidden className="absolute -top-40 -left-20 -z-10 size-[30rem] rounded-full bg-indigo-600 opacity-30 blur-[120px]" />
      <div aria-hidden className="absolute -right-20 -bottom-40 -z-10 size-[28rem] rounded-full bg-cyan-500 opacity-20 blur-[120px]" />
      <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col gap-4">
          <p className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-cyan-300 uppercase">
            Security by design
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            Your children&apos;s records stay inside your school.
          </h2>
          <p className="text-lg text-slate-300">
            Many schools share SchoolOS, but no school can see another&apos;s
            data — not by a bug in one screen, and not by guessing a link.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {GUARANTEES.map((item) => (
            <div key={item.title} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur">
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
  {
    title: "Register your school",
    body: "Tell us your school's name and a contact person. It takes about two minutes.",
  },
  {
    title: "We verify and approve",
    body: "The SchoolOS team reviews the application and issues your administrator account.",
  },
  {
    title: "Set up and invite",
    body: "Classes Nursery to 12 and the current session are ready. Add sections, staff and students, then hand out sign-ins.",
  },
];

export function Steps() {
  return (
    <section className="py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Getting started" title="Live in three steps" />

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
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
// Pricing
// -----------------------------------------------------------------------------

function limit(value: number | null, noun: string): string {
  return value === null ? `Unlimited ${noun}` : `Up to ${value.toLocaleString("en-IN")} ${noun}`;
}

function storage(mb: number | null): string {
  if (mb === null) return "Unlimited storage";
  return mb >= 1024 ? `${Math.round(mb / 1024)} GB storage` : `${mb} MB storage`;
}

export function Pricing({ plans }: { plans: PublicPlan[] }) {
  if (!plans.length) return null;

  // The middle plan is the one most schools pick; highlight it.
  const featured = plans.length >= 3 ? plans[1]?.id : undefined;

  return (
    <section id="pricing" className="bg-muted/50 scroll-mt-20 border-y py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Pricing"
          title="One yearly price. Every feature."
          description="Choose by the size of your school. You can move to another plan at any time."
        />

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-3">
          {plans.map((plan) => {
            const isFeatured = plan.id === featured;
            return (
              <div
                key={plan.id}
                className={cn(
                  "bg-card shadow-card relative flex flex-col gap-6 rounded-3xl p-7 ring-1",
                  isFeatured
                    ? "ring-primary shadow-[0_24px_50px_-24px_var(--primary)] ring-2 lg:-translate-y-3"
                    : "ring-border",
                )}
              >
                {isFeatured ? (
                  <span className="bg-brand-gradient absolute -top-3 left-7 rounded-full px-3 py-0.5 text-xs font-semibold text-white shadow-md">
                    Most popular
                  </span>
                ) : null}

                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  {plan.description ? (
                    <p className="text-muted-foreground text-sm">{plan.description}</p>
                  ) : null}
                </div>

                <p className="flex items-baseline gap-1">
                  <span className={cn("text-4xl font-extrabold tracking-tight tabular-nums", isFeatured && "text-brand-gradient")}>
                    {formatMoney(plan.priceMinor, plan.currency)}
                  </span>
                  <span className="text-muted-foreground text-sm">/ year</span>
                </p>

                <ul className="flex flex-col gap-2.5 text-sm">
                  {[
                    limit(plan.maxStudents, "students"),
                    limit(plan.maxTeachers, "teachers"),
                    limit(plan.maxAdmins, "admin accounts"),
                    storage(plan.storageMb),
                    "All modules and your school website",
                  ].map((point) => (
                    <li key={point} className="flex gap-2">
                      <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                      {point}
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  size="lg"
                  variant={isFeatured ? "default" : "outline"}
                  className="h-10"
                >
                  <Link href={`/register?plan=${plan.tier}`}>Choose {plan.name}</Link>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// FAQ
// -----------------------------------------------------------------------------

const FAQS = [
  {
    q: "Can another school see our data?",
    a: "No. Every school has its own private workspace, and the separation is enforced by the database itself, not only by the screens. Even the platform's own staff use a separate administration area that does not show your students or staff.",
  },
  {
    q: "What happens after we register?",
    a: "The SchoolOS team reviews your application. Once it is approved, your school is set up with classes from Nursery to Class 12 and the current academic session, and your administrator receives a sign-in.",
  },
  {
    q: "Do parents and teachers need to install an app?",
    a: "No. SchoolOS runs in the browser on any phone, tablet or computer. Each person signs in with the account your administrator issues them.",
  },
  {
    q: "Can a parent with two children use one login?",
    a: "Yes. A guardian is linked to each of their children, and sees all of them — and nobody else's — from a single account.",
  },
  {
    q: "Do we get a public website?",
    a: "Yes. Your school gets a website with pages you edit yourself, public notices, upcoming events and an online admission form.",
  },
  {
    q: "What happens to last year's records when students move up?",
    a: "They are kept. A student's class placement is stored per academic session, so last year's class and attendance remain exactly as they were.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions schools ask us" />

        <div className="bg-card shadow-card mt-12 divide-y rounded-2xl border border-border/70">
          {FAQS.map((item) => (
            <details key={item.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {item.q}
                <span
                  aria-hidden
                  className="bg-primary-soft text-primary-strong flex size-7 shrink-0 items-center justify-center rounded-full text-lg leading-none transition-transform group-open:rotate-45"
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
    <section className="px-4 pb-24 sm:px-6">
      <div className="bg-brand-gradient relative isolate mx-auto flex w-full max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-3xl px-6 py-16 text-center text-white shadow-[0_30px_60px_-30px_var(--primary)]">
        <div aria-hidden className="bg-dots absolute inset-0 -z-10" />
        <div
          aria-hidden
          className="absolute inset-0 [background-image:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(56,189,248,0.35),transparent_45%)]"
        />
        <h2 className="relative max-w-2xl text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
          Bring your school onto SchoolOS this session.
        </h2>
        <p className="relative max-w-xl text-lg text-white/85">
          Register today. Once approved, your administrator can start adding
          classes, staff and students straight away.
        </p>
        <div className="relative flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" variant="secondary" className="h-11 px-5 text-base">
            <Link href="/register">
              Register your school
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="h-11 px-5 text-base text-white hover:bg-white/15 hover:text-white"
          >
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
