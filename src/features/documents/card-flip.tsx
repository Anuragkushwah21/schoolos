"use client";

import { CreditCardIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** One side of an ID card at a time — Front / Back tabs, or tap the card to turn it over. */
export function CardFlip({ front, back }: { front: React.ReactNode; back: React.ReactNode }) {
  const [side, setSide] = useState<"front" | "back">("front");
  return (
    <div className="flex flex-col items-start gap-3">
      <div role="tablist" aria-label="Card side" className="no-print flex gap-1 rounded-2xl bg-indigo-100/70 p-1">
        {(
          [
            { key: "front", label: "Front side", icon: CreditCardIcon },
            { key: "back", label: "Back side", icon: RotateCwIcon },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={side === tab.key}
            onClick={() => setSide(tab.key)}
            className={cn("inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors", side === tab.key ? "bg-white text-indigo-700 shadow-sm" : "text-neutral-600 hover:text-neutral-900")}
          >
            <tab.icon className="size-4" aria-hidden />
            {tab.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setSide(side === "front" ? "back" : "front")} className="rounded-[3.5mm] text-left shadow-[0_18px_40px_-20px_rgb(30_27_75/0.55)]" aria-label="Turn the card over">
        {side === "front" ? front : back}
      </button>
      <p className="no-print text-xs text-neutral-500">{side === "front" ? "Tap the card to see the back" : "Tap the card to see the front"}</p>
    </div>
  );
}
