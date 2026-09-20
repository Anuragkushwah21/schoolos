import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon, CalendarDaysIcon, MegaphoneIcon } from "lucide-react";

import { RichText } from "@/components/shared/rich-text";
import { Button } from "@/components/ui/button";
import { EventList, NoticeList } from "@/features/communication/feed";
import { publicEvents } from "@/server/communication/events";
import { publicNotices } from "@/server/communication/notices";
import { getGallery, getPublicSchool } from "@/server/website/public";

export default async function SchoolHomePage(props: PageProps<"/schools/[slug]">) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const [notices, events, gallery] = await Promise.all([
    publicNotices(school.id, 4),
    publicEvents(school.id, 4),
    getGallery(school.id, 8),
  ]);

  const base = `/schools/${school.slug}`;
  const facts = [
    school.establishedYear ? `Established ${school.establishedYear}` : null,
    school.affiliationBoard ? `Affiliated to ${school.affiliationBoard}` : null,
    [school.city, school.state].filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  return (
    <>
      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden border-b">
        {school.bannerUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a school-supplied URL, not a bundled asset */}
            <img src={school.bannerUrl} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-slate-950/65" />
          </>
        ) : (
          <div className="bg-primary absolute inset-0" />
        )}

        <div className="relative mx-auto w-full max-w-5xl px-4 py-20 text-white sm:px-6">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {school.name}
          </h1>
          {facts.length ? (
            <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-white/85">
              {facts.map((fact, index) => (
                <span key={fact}>
                  {index > 0 ? <span className="mr-3 opacity-60">·</span> : null}
                  {fact}
                </span>
              ))}
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="secondary" className="h-11 px-5 text-base">
              <Link href={`${base}/admissions`}>
                Apply for admission
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 border-white/40 bg-transparent px-5 text-base text-white hover:bg-white/10 hover:text-white"
            >
              <Link href={`${base}/contact`}>Contact us</Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-14 sm:px-6">
        {/* ---------------- about + principal ---------------- */}
        {school.about || school.principalMessage ? (
          <section className="grid gap-10 md:grid-cols-[1.5fr_1fr]">
            {school.about ? (
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">About the school</h2>
                <RichText text={school.about} className="text-muted-foreground mt-4" />
              </div>
            ) : null}

            {school.principalMessage ? (
              <aside className="bg-muted/50 h-fit rounded-2xl border p-6">
                <h2 className="font-semibold">From the Principal</h2>
                <RichText text={school.principalMessage} className="text-muted-foreground mt-3 text-sm" />
                {school.principalName ? (
                  <p className="mt-4 text-sm font-medium">— {school.principalName}</p>
                ) : null}
              </aside>
            ) : null}
          </section>
        ) : null}

        {/* ---------------- notices ---------------- */}
        {notices.length ? (
          <section>
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <MegaphoneIcon className="text-primary size-5" aria-hidden />
                Latest notices
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}/notices`}>All notices</Link>
              </Button>
            </div>
            <NoticeList notices={notices} compact />
          </section>
        ) : null}

        {/* ---------------- events ---------------- */}
        {events.length ? (
          <section>
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <CalendarDaysIcon className="text-primary size-5" aria-hidden />
                Upcoming events
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}/events`}>All events</Link>
              </Button>
            </div>
            <EventList events={events} />
          </section>
        ) : null}

        {/* ---------------- gallery ---------------- */}
        {gallery.length ? (
          <section>
            <h2 className="mb-5 text-2xl font-semibold tracking-tight">Gallery</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {gallery.map((item) => (
                <li key={item.id} className="overflow-hidden rounded-xl border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a school-supplied URL, not a bundled asset */}
                  <img
                    src={item.url}
                    alt={item.caption ?? ""}
                    loading="lazy"
                    className="aspect-4/3 w-full object-cover"
                  />
                  {item.caption ? (
                    <p className="text-muted-foreground px-3 py-2 text-xs">{item.caption}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ---------------- admissions call to action ---------------- */}
        <section className="bg-primary flex flex-col items-start gap-4 rounded-2xl px-6 py-10 text-white sm:px-10">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">
            Admissions are open. Apply online in a few minutes.
          </h2>
          <p className="max-w-xl text-white/85">
            Fill in the form and our office will contact you at the number you
            give. There is nothing to pay to apply.
          </p>
          <Button asChild size="lg" variant="secondary" className="h-11 px-5 text-base">
            <Link href={`${base}/admissions`}>
              Start an application
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        </section>
      </div>
    </>
  );
}
