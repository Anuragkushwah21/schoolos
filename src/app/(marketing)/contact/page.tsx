import type { Metadata } from "next";
import Link from "next/link";
import { Clock3Icon, MailIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";

import { ContactForm } from "@/features/marketing/contact-form";
import { INQUIRY_TOPIC_OPTIONS } from "@/features/marketing/topics";
import { env } from "@/lib/env";
import { param } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Talk to the SchoolOS team about a demo, pricing, offers or getting your school set up.",
};

/**
 * The platform owner's front desk.
 *
 * For schools that are not on SchoolOS yet as much as for ones that are: the
 * form needs no account. Messages land in the Super Admin's Enquiries inbox,
 * and are emailed to PLATFORM_CONTACT_EMAIL when that is set.
 */
export default async function ContactPage(props: PageProps<"/contact">) {
  const search = await props.searchParams;
  const requested = param(search.topic);
  const topic = INQUIRY_TOPIC_OPTIONS.find((option) => option.value === requested)?.value;

  const email = env.PLATFORM_CONTACT_EMAIL;
  const phone = env.PLATFORM_CONTACT_PHONE;
  const whatsapp = phone?.replace(/[^\d]/g, "");

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:py-20">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-primary text-sm font-semibold tracking-wide uppercase">Contact us</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Talk to the SchoolOS team
          </h1>
          <p className="text-muted-foreground text-lg">
            Want a demo, a price for your school, or help getting started? Send us a message and
            we will get back to you.
          </p>
        </div>

        <ul className="flex flex-col gap-4 text-sm">
          {email ? (
            <li className="flex items-center gap-3">
              <MailIcon className="text-primary size-5 shrink-0" aria-hidden />
              <a href={`mailto:${email}`} className="hover:underline">
                {email}
              </a>
            </li>
          ) : null}
          {phone ? (
            <li className="flex items-center gap-3">
              <PhoneIcon className="text-primary size-5 shrink-0" aria-hidden />
              <a href={`tel:${phone.replace(/\s+/g, "")}`} className="hover:underline">
                {phone}
              </a>
            </li>
          ) : null}
          {whatsapp ? (
            <li className="flex items-center gap-3">
              <MessageCircleIcon className="text-primary size-5 shrink-0" aria-hidden />
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                Chat on WhatsApp
              </a>
            </li>
          ) : null}
          <li className="text-muted-foreground flex items-center gap-3">
            <Clock3Icon className="text-primary size-5 shrink-0" aria-hidden />
            We usually reply within one working day.
          </li>
        </ul>

        <div className="bg-muted/50 rounded-2xl border p-6 text-sm">
          <p className="font-semibold">Ready to start?</p>
          <p className="text-muted-foreground mt-1">
            You can register your school straight away — there is nothing to pay today.
          </p>
          <Link href="/register" className="text-primary mt-3 inline-block font-medium hover:underline">
            Register your school →
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border p-6 sm:p-8">
        <ContactForm defaultTopic={topic} />
      </div>
    </main>
  );
}
