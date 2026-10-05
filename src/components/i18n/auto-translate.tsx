"use client";

import { useEffect } from "react";

import type { Locale } from "@/lib/i18n/config";
import { type PhraseBook, createPhraseTranslator } from "@/lib/i18n/phrase-translate";

/**
 * Puts every piece of interface text on the page into the chosen language —
 * headings, buttons, labels, hints, table headers, placeholders, tooltips,
 * toasts and error messages — including text written straight into a screen
 * in English, which the `t()` keys never covered.
 *
 * It reads the rendered page and swaps each text it finds in the phrase
 * dictionary, and keeps doing so as the page changes (navigation, a form
 * error, a toast). It only ever changes a text node's value or a few
 * attributes — never the structure React manages — and only once React has
 * taken the node over, so hydration is never disturbed. What people typed
 * (names, notes, addresses) is not in the dictionary and stays as written;
 * so do inputs, textareas and anything marked `data-no-translate`.
 *
 * Switching back to English unmounts this and puts every original back.
 */

const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "KBD", "SAMP", "TEMPLATE"]);
/** Give up waiting for React to take a node over after this long; translate it anyway. */
const HYDRATION_PATIENCE_MS = 4000;

const LOADERS: Partial<Record<Locale, () => Promise<PhraseBook>>> = {
  hi: () => import("@/lib/i18n/phrases/hi.json").then((module) => (module.default ?? module) as PhraseBook),
};

/** Whether React has hydrated (or created) this element — it then carries a fiber key. */
function ownedByReact(element: Element, owned: WeakSet<Element>): boolean {
  if (owned.has(element)) return true;
  for (const key in element) {
    if (key.startsWith("__reactFiber$")) {
      owned.add(element);
      return true;
    }
  }
  return false;
}

function skipped(element: Element | null): boolean {
  for (let node = element; node; node = node.parentElement) {
    if (SKIP_TAGS.has(node.tagName) || node.hasAttribute("data-no-translate") || (node as HTMLElement).isContentEditable) return true;
  }
  return false;
}

export function AutoTranslate({ locale }: { locale: Locale }) {
  useEffect(() => {
    const load = LOADERS[locale];
    if (!load) {
      document.documentElement.removeAttribute("data-translating");
      return;
    }
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const owned = new WeakSet<Element>();
    // What was there before, so English comes back exactly when switching back.
    const originalText = new Map<Text, string>();
    const writtenText = new WeakMap<Text, string>();
    const originalAttr = new Map<Element, Map<string, string>>();
    const writtenAttr = new WeakMap<Element, Map<string, string>>();
    const waiting = new Set<Node>();

    void load().then((book) => {
      if (cancelled) return;
      const translate = createPhraseTranslator(book);
      const patient = () => Date.now() - startedAt > HYDRATION_PATIENCE_MS;

      const doText = (node: Text) => {
        const parent = node.parentElement;
        if (!parent || skipped(parent)) return;
        const value = node.nodeValue ?? "";
        if (writtenText.get(node) === value) return; // our own write
        if (!ownedByReact(parent, owned) && !patient()) {
          waiting.add(node);
          return;
        }
        const next = translate(value);
        if (next === null || next === value) return;
        // React wrote this English (first render or an update): what to put back when switching to English.
        originalText.set(node, value);
        if (originalText.size > 20_000) for (const known of originalText.keys()) if (!known.isConnected) originalText.delete(known);
        writtenText.set(node, next);
        node.nodeValue = next;
      };

      const doAttributes = (element: Element) => {
        // A textarea's own text is what someone typed; its placeholder is ours.
        if (skipped(element.tagName === "TEXTAREA" ? element.parentElement : element)) return;
        for (const name of ATTRIBUTES) {
          const value = element.getAttribute(name);
          if (!value) continue;
          const mine = writtenAttr.get(element);
          if (mine?.get(name) === value) continue;
          if (!ownedByReact(element, owned) && !patient()) {
            waiting.add(element);
            continue;
          }
          const next = translate(value);
          if (next === null || next === value) continue;
          const originals = originalAttr.get(element) ?? new Map<string, string>();
          originals.set(name, value);
          originalAttr.set(element, originals);
          const written = mine ?? new Map<string, string>();
          written.set(name, next.trim());
          writtenAttr.set(element, written);
          element.setAttribute(name, next.trim());
        }
        // Buttons drawn as <input type="submit" value="…">.
        if (element instanceof HTMLInputElement && (element.type === "submit" || element.type === "button") && element.value) {
          const next = translate(element.value);
          if (next) element.value = next.trim();
        }
      };

      const walk = (root: Node) => {
        if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        const element = root as Element;
        if (SKIP_TAGS.has(element.tagName)) return;
        doAttributes(element);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
          acceptNode: (node) => (node.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has((node as Element).tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.nodeType === Node.TEXT_NODE) doText(node as Text);
          else doAttributes(node as Element);
        }
      };

      // Nodes React had not taken over yet: try again shortly.
      const drain = () => {
        retry = null;
        if (cancelled || !waiting.size) return;
        const pending = [...waiting];
        waiting.clear();
        for (const node of pending) if (node.isConnected) walk(node);
        if (waiting.size) retry = setTimeout(drain, 120);
      };

      walk(document.body);
      document.documentElement.removeAttribute("data-translating");
      if (waiting.size) retry = setTimeout(drain, 60);

      observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") doText(record.target as Text);
          else if (record.type === "attributes") doAttributes(record.target as Element);
          else record.addedNodes.forEach(walk);
        }
        if (waiting.size && !retry) retry = setTimeout(drain, 60);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (retry) clearTimeout(retry);
      // Put English back only where the text is still ours: React may already have
      // rewritten a node in this same update (the menus re-render in the new language).
      for (const [node, value] of originalText) if (node.isConnected && node.nodeValue === writtenText.get(node)) node.nodeValue = value;
      for (const [element, values] of originalAttr) {
        if (!element.isConnected) continue;
        const written = writtenAttr.get(element);
        for (const [name, value] of values) if (element.getAttribute(name) === written?.get(name)) element.setAttribute(name, value);
      }
      document.documentElement.removeAttribute("data-translating");
    };
  }, [locale]);

  return null;
}
