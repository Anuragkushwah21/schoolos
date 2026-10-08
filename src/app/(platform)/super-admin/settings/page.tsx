import type { Metadata, Route } from "next";
import Link from "next/link";
import { ChevronRightIcon, GlobeIcon, InboxIcon, KeyRoundIcon, LayersIcon, type LucideIcon, ShieldCheckIcon, TagIcon, UserCircleIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { requireSuperAdmin } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Settings" };

const GROUPS: Array<{ title: string; items: Array<{ href: Route; label: string; hint: string; icon: LucideIcon }> }> = [
  {
    title: "You",
    items: [
      { href: "/account", label: "Profile, password & language", hint: "Your name, sign-in password and the language you see.", icon: UserCircleIcon },
      { href: "/api-tokens", label: "API tokens", hint: "Keys for scripts and integrations; revoke any time.", icon: KeyRoundIcon },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/super-admin/plans", label: "Plans & feature configuration", hint: "Prices, limits and the optional modules each plan includes.", icon: LayersIcon },
      { href: "/super-admin/audit", label: "Security & audit", hint: "Every approval, suspension, plan and feature change, with who did it.", icon: ShieldCheckIcon },
    ],
  },
  {
    title: "Website",
    items: [
      { href: "/super-admin/offers", label: "Homepage offers", hint: "Promotions shown on the SchoolOS homepage.", icon: TagIcon },
      { href: "/super-admin/inquiries", label: "Enquiries from schools", hint: "Messages sent from the contact form.", icon: InboxIcon },
      { href: "/", label: "Public homepage", hint: "What prospective schools see.", icon: GlobeIcon },
    ],
  },
];

/**
 * Platform-level settings only — the Super Admin's own account and the
 * platform's plans, security and website. A school's settings belong to that
 * school and are never here.
 */
export default async function PlatformSettingsPage() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader title="Settings" description="Your account and the SchoolOS platform. School settings stay with each school." />
      <div className="flex flex-col gap-8">
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.08em] uppercase">{group.title}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map(({ href, label, hint, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} className="bg-card hover:border-primary/50 hover:bg-primary-soft flex h-full items-center gap-3 rounded-xl border p-4 transition-colors">
                    <span className="bg-primary-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{label}</span>
                      <span className="text-muted-foreground block text-xs">{hint}</span>
                    </span>
                    <ChevronRightIcon className="text-muted-foreground size-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
