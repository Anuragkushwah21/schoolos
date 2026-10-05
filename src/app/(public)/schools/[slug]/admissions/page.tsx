import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDaysIcon, CheckIcon, GlobeIcon, MailIcon, MapPinIcon, PhoneIcon, SparklesIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PublicApplicationForm } from "@/features/admissions/public-application-form";
import { formatDate, today, toDateInput } from "@/lib/dates";
import { publicPortal } from "@/server/admissions/portal";
import { getCurrentUser } from "@/server/auth/current-user";
import { getPublicSchool } from "@/server/website/public";

export const metadata: Metadata = { title: "Admissions" };

const STEPS = [
  "Fill in the form — for one child or all your children at once.",
  "Each child gets an application number straight away.",
  "The school office reviews it and calls you on the number you give.",
];

export default async function PublicAdmissionsPage(props: PageProps<"/schools/[slug]/admissions">) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const portal = await publicPortal(school.id);
  // "?preview=1" from Website → Admission form: this school's own admin sees
  // the form even while it is unpublished or closed — switched off, never submitted.
  const viewer = (await props.searchParams).preview === "1" ? await getCurrentUser() : null;
  const adminPreview = viewer?.role === "SCHOOL_ADMIN" && viewer.schoolId === school.id;
  const address = [school.addressLine, school.city, school.state, school.postalCode].filter(Boolean).join(", ");
  const open = portal.window.state === "OPEN" && portal.session && portal.classes.length;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.5fr]">
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          {school.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a school's own https logo, any host
            <img src={school.logoUrl} alt="" className="size-14 rounded-xl object-contain" />
          ) : null}
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Admissions</h1>
            <p className="text-muted-foreground mt-1">
              Apply to {school.name}
              {portal.session ? ` for the ${portal.session.name} session` : ""}.
            </p>
          </div>
        </div>

        {portal.opensOn || portal.closesOn ? (
          <p className="bg-primary/5 flex items-center gap-2 rounded-xl px-4 py-3 text-sm">
            <CalendarDaysIcon className="text-primary size-4 shrink-0" aria-hidden />
            {portal.opensOn ? `Opens ${formatDate(portal.opensOn)}` : "Open now"}
            {portal.closesOn ? ` · closes ${formatDate(portal.closesOn)}` : ""}
          </p>
        ) : null}

        <ol className="flex flex-col gap-4 text-sm">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{index + 1}</span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>

        {portal.classes.length ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold">Classes open for admission</h2>
            <div className="flex flex-wrap gap-1.5">
              {portal.classes.map((klass) => (
                <span key={klass.id} className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {klass.name}
                </span>
              ))}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">Class 11–12 need a stream; for Class 9–10 it is optional.</p>
          </div>
        ) : null}

        {portal.instructions ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold">How admission works</h2>
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">{portal.instructions}</p>
          </div>
        ) : null}

        {portal.highlights.length ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold">Why families choose us</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {portal.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-2">
                  <SparklesIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {school.about ? <p className="text-muted-foreground line-clamp-6 text-sm whitespace-pre-wrap">{school.about}</p> : null}
        {school.principalMessage ? (
          <blockquote className="border-primary/40 border-l-4 pl-4 text-sm italic">
            {school.principalMessage.slice(0, 600)}
            {school.principalName ? <footer className="text-muted-foreground mt-1 not-italic">— {school.principalName}</footer> : null}
          </blockquote>
        ) : null}

        <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
          {address ? (
            <li className="flex items-start gap-2">
              <MapPinIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {address}
                {portal.mapUrl ? (
                  <>
                    {" · "}
                    <a href={portal.mapUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                      Map
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ) : null}
          {school.phone ? (
            <li className="flex items-center gap-2">
              <PhoneIcon className="size-4" aria-hidden /> {school.phone}
            </li>
          ) : null}
          {school.email ? (
            <li className="flex items-center gap-2">
              <MailIcon className="size-4" aria-hidden /> {school.email}
            </li>
          ) : null}
          {portal.websiteUrl ? (
            <li className="flex items-center gap-2">
              <GlobeIcon className="size-4" aria-hidden />
              <a href={portal.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {portal.websiteUrl.replace(/^https:\/\//, "")}
              </a>
            </li>
          ) : null}
        </ul>

        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          Your details are sent only to {school.name}, and are used to contact you about this application.
        </p>
      </div>

      <div className="bg-card ring-foreground/10 rounded-2xl p-6 shadow-sm ring-1 sm:p-8">
        {adminPreview ? (
          <p className="bg-warning-soft text-warning-strong mb-5 rounded-xl px-4 py-3 text-sm">
            Preview for the school office — {open ? "this is the live form, switched off here." : "parents cannot apply right now; this is how the form will look."}
          </p>
        ) : null}
        {open || (adminPreview && portal.classes.length) ? (
          <PublicApplicationForm
            preview={adminPreview}
            slug={school.slug}
            classes={portal.classes.map((klass) => ({ value: klass.id, label: klass.name, level: klass.level }))}
            streams={portal.streams.map((stream) => ({ value: stream.id, label: stream.name }))}
            customFields={portal.customFields}
            today={toDateInput(today())}
          />
        ) : (
          <EmptyState title={portal.window.state === "NOT_YET" ? "Applications open soon" : portal.window.state === "UNPUBLISHED" ? "Online admissions are not open" : "Applications are closed"}>
            {portal.window.state === "NOT_YET"
              ? `${school.name} opens online applications on ${formatDate(portal.window.opensOn)}.`
              : `${school.name} is not accepting online applications at the moment.`}{" "}
            Please contact the school office.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
