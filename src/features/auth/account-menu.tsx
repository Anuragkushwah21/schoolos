"use client";

import type { Route } from "next";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTransition } from "react";

import { logoutAction } from "./actions";

/**
 * Who is signed in, on a page that anyone can reach.
 *
 * The props come from a server component that read the session — this holds no
 * auth state of its own, reads no cookie and touches no storage, so it cannot
 * disagree with the server about whether somebody is signed in. When the session
 * ends, the next server render passes `user: null` and this becomes a Sign in
 * button without anything here having to notice.
 *
 * The dashboard link is the caller's, computed from the role server-side. This
 * component never derives a route from a role, so it cannot offer a link to an
 * area the signed-in person is not allowed into.
 */
export type AccountMenuUser = {
  name: string;
  email: string;
  roleLabel: string;
  /** Where this role's dashboard lives. */
  dashboardHref: Route;
  /** This role's own profile page. */
  profileHref: Route;
};

export function AccountMenu({ user }: { user: AccountMenuUser | null }) {
  const [signingOut, startSignOut] = useTransition();

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="lg">
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild size="lg" className="hidden px-4 sm:inline-flex">
          <Link href="/register">Register your school</Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="max-w-48 gap-2">
          <span className="truncate">{user.name}</span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{user.name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">{user.email}</span>
          <span className="text-muted-foreground text-xs font-normal">{user.roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={user.dashboardHref}>Dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={user.profileHref}>My profile</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          // Kept out of the menu's own close-on-select so the pending state is
          // visible, and disabled while it runs so a second click cannot fire a
          // second sign-out.
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            startSignOut(() => void logoutAction());
          }}
        >
          {signingOut ? (
            <>
              <Spinner size="xs" />
              Signing out…
            </>
          ) : (
            "Sign out"
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The same thing for the mobile sheet, where a dropdown inside a drawer is
 * awkward: the entries are laid out flat instead.
 */
export function AccountMenuMobile({ user }: { user: AccountMenuUser | null }) {
  const [signingOut, startSignOut] = useTransition();

  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">Register your school</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{user.name}</span>
        <span className="text-muted-foreground text-xs">{user.email}</span>
        <span className="text-muted-foreground text-xs">{user.roleLabel}</span>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild variant="outline">
          <Link href={user.dashboardHref}>Dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={user.profileHref}>My profile</Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={signingOut}
          aria-busy={signingOut || undefined}
          onClick={() => startSignOut(() => void logoutAction())}
        >
          {signingOut ? (
            <>
              <Spinner size="xs" />
              Signing out…
            </>
          ) : (
            "Sign out"
          )}
        </Button>
      </div>
    </div>
  );
}
