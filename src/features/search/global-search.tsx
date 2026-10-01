"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";

import { useT } from "@/components/i18n/i18n-provider";
import { Spinner } from "@/components/shared/spinner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Hit = { group: "students" | "teachers" | "parents" | "staff" | "classes"; id: string; title: string; subtitle: string | null; href: string };

const GROUP_ORDER: Hit["group"][] = ["students", "teachers", "parents", "staff", "classes"];

/**
 * The header search. Results come from `/api/v1/search`, which decides on the
 * server what this person may find. "/" or Ctrl/⌘+K focuses it; arrows and
 * Enter open a result.
 */
export function GlobalSearch() {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setState("loading");
      fetch(`/api/v1/search?q=${encodeURIComponent(term)}`, { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ data: Hit[] }>) : Promise.reject(new Error(String(response.status)))))
        .then((body) => {
          if (!live) return;
          setHits(body.data);
          setActive(0);
          setState("idle");
        })
        .catch(() => live && setState("failed"));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const ordered = (hits ?? []).slice().sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const short = q.trim().length < 2;

  function go(hit: Hit | undefined) {
    if (!hit) return;
    setOpen(false);
    setQ("");
    setHits(null);
    router.push(hit.href as Route);
  }

  return (
    <div className="relative w-full max-w-md">
      <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
      <Input
        ref={input}
        type="search"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, ordered.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            go(ordered[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholderShort")}
        role="combobox"
        aria-expanded={open && !short}
        aria-controls="global-search-results"
        className="h-9 pl-8"
      />
      {open && q ? (
        <div id="global-search-results" role="listbox" className="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border p-1 shadow-lg">
          {short ? (
            <p className="text-muted-foreground p-3 text-sm">{t("search.typeMore")}</p>
          ) : state === "failed" ? (
            <p className="text-danger-strong p-3 text-sm">{t("search.failed")}</p>
          ) : hits === null || state === "loading" ? (
            <p className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
              <Spinner size="xs" /> {t("common.loading")}
            </p>
          ) : ordered.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">{t("search.none", { q: q.trim() })}</p>
          ) : (
            GROUP_ORDER.filter((group) => ordered.some((hit) => hit.group === group)).map((group) => (
              <div key={group} className="py-1">
                <p className="text-muted-foreground px-2.5 py-1 text-xs font-medium">{t(`search.groups.${group}`)}</p>
                {ordered
                  .filter((hit) => hit.group === group)
                  .map((hit) => {
                    const index = ordered.indexOf(hit);
                    return (
                      <button
                        key={`${hit.group}-${hit.id}`}
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => go(hit)}
                        onMouseEnter={() => setActive(index)}
                        className={cn("flex w-full flex-col rounded-md px-2.5 py-1.5 text-left", index === active ? "bg-muted" : "")}
                      >
                        <span className="text-sm font-medium">{hit.title}</span>
                        {hit.subtitle ? <span className="text-muted-foreground text-xs">{hit.subtitle}</span> : null}
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
