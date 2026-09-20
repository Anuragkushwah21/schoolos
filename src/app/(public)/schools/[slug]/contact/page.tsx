import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPublicSchool } from "@/server/website/public";

export const metadata: Metadata = { title: "Contact" };

export default async function PublicContactPage(props: PageProps<"/schools/[slug]/contact">) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const address = [school.addressLine, school.city, school.state, school.postalCode, school.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Contact us</h1>
      <p className="text-muted-foreground mb-8">
        The school office will be glad to answer your questions.
      </p>

      <dl className="flex flex-col gap-5">
        {address ? (
          <div className="flex gap-3">
            <MapPinIcon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <dt className="font-medium">Address</dt>
              <dd className="text-muted-foreground">{address}</dd>
            </div>
          </div>
        ) : null}

        {school.phone ? (
          <div className="flex gap-3">
            <PhoneIcon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <dt className="font-medium">Phone</dt>
              <dd>
                <a href={`tel:${school.phone.replace(/\s/g, "")}`} className="text-muted-foreground hover:underline">
                  {school.phone}
                </a>
              </dd>
            </div>
          </div>
        ) : null}

        {school.email ? (
          <div className="flex gap-3">
            <MailIcon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <dt className="font-medium">Email</dt>
              <dd>
                <a href={`mailto:${school.email}`} className="text-muted-foreground break-all hover:underline">
                  {school.email}
                </a>
              </dd>
            </div>
          </div>
        ) : null}
      </dl>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild>
          <Link href={`/schools/${school.slug}/admissions`}>Apply for admission</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Staff and parent sign-in</Link>
        </Button>
      </div>
    </div>
  );
}
