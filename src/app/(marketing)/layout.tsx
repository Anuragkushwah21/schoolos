import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

/**
 * Frame for the platform's own public pages: the product homepage and school
 * registration. A school's public website has its own layout under
 * `/schools/[slug]` and never inherits this one.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-background/80 supports-backdrop-filter:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="SchoolOS home">
            <Logo className="text-lg" />
          </Link>

          <nav
            aria-label="Primary"
            className="text-muted-foreground hidden items-center gap-7 text-sm md:flex"
          >
            <Link href="/#features" className="hover:text-foreground transition-colors">
              Features
            </Link>
            <Link href="/#roles" className="hover:text-foreground transition-colors">
              For your staff
            </Link>
            <Link href="/#pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/#faq" className="hover:text-foreground transition-colors">
              FAQ
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="lg">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="lg" className="hidden px-4 sm:inline-flex">
              <Link href="/register">Register your school</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>

      <footer className="border-t">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
          <div className="flex max-w-sm flex-col gap-3">
            <Logo />
            <p className="text-muted-foreground text-sm">
              School management for Nursery to Class 12 — admissions, people,
              timetable, attendance and a public website, on one platform.
            </p>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Product</p>
            <Link href="/#features" className="text-muted-foreground hover:text-foreground">
              Features
            </Link>
            <Link href="/#pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link href="/#security" className="text-muted-foreground hover:text-foreground">
              Security
            </Link>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Get started</p>
            <Link href="/register" className="text-muted-foreground hover:text-foreground">
              Register your school
            </Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
        <div className="text-muted-foreground mx-auto w-full max-w-6xl border-t px-4 py-6 text-xs sm:px-6">
          © {new Date().getFullYear()} SchoolOS
        </div>
      </footer>
    </div>
  );
}
