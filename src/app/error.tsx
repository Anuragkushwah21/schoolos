"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Any unexpected failure below the root layout. The message is deliberately
 * generic: in production Next.js replaces server error details with a digest,
 * which is shown so the office can quote it when reporting the problem.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        The page could not be loaded. Try again; if it keeps happening, contact support
        {error.digest ? (
          <>
            {" "}
            and quote reference <span className="font-mono">{error.digest}</span>
          </>
        ) : null}
        .
      </p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
