import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPublicSchool } from "@/server/website/public";

export const metadata: Metadata = { title: "Application received" };

export default async function ApplicationSubmittedPage(
  props: PageProps<"/schools/[slug]/admissions/submitted">,
) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const { no } = await props.searchParams;
  // One number per child applied for.
  const numbers = typeof no === "string" ? no.slice(0, 400).split(",").map((value) => value.trim()).filter(Boolean).slice(0, 10) : [];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
        <CircleCheckIcon className="size-7" aria-hidden />
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">Application received</h1>
      <p className="text-muted-foreground text-lg">
        Thank you. {school.name} will review your application and contact you on
        the phone number you gave.
      </p>
      {numbers.length ? (
        <div className="bg-muted flex flex-col gap-1 rounded-lg px-4 py-2 text-sm">
          <span>{numbers.length === 1 ? "Application number" : `Application numbers (one per child)`}:</span>
          {numbers.map((number) => (
            <span key={number} className="font-mono font-medium">
              {number}
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-muted-foreground text-sm">Please keep {numbers.length > 1 ? "these numbers" : "this number"} for your reference.</p>
      <Button asChild variant="outline" size="lg">
        <Link href={`/schools/${school.slug}`}>Back to the school website</Link>
      </Button>
    </div>
  );
}
