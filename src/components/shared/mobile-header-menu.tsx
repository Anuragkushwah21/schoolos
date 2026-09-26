"use client";

import { useState } from "react";
import { MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The phone-width header menu.
 *
 * A drawer holding whatever the header would show on a wide screen, passed in as
 * children — which is what lets the account corner stay a server component and
 * keeps auth state out of the browser entirely. This component only opens and
 * closes; it knows nothing about who is signed in.
 */
export function MobileHeaderMenu({
  children,
  label = "Menu",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <MenuIcon className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(20rem,85vw)]">
        <SheetHeader>
          <SheetTitle>{label}</SheetTitle>
        </SheetHeader>
        {/* Closing on any click inside means a link in the drawer does not leave
            it hanging open over the page it navigated to. */}
        <div className="flex flex-col gap-6 px-4 pb-6" onClick={() => setOpen(false)}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
