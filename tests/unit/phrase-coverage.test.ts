/**
 * Switching to Hindi must change everything a person can read. This fails
 * when interface text in the source has no Hindi entry — so a new label,
 * hint or error message cannot ship in English only.
 *
 * To fix: `npx tsx scripts/i18n/extract.ts hi` lists what is missing in
 * scripts/i18n/missing-hi.json; translate those and merge them with
 * `npx tsx scripts/i18n/merge.ts <dir> hi`.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractPhrases } from "@/lib/i18n/phrase-extract";
import hi from "@/lib/i18n/phrases/hi.json";

const book = hi as { exact: Record<string, string>; templates: Record<string, string> };
const root = path.resolve(import.meta.dirname, "../..");

describe("Hindi phrase dictionary", () => {
  const { phrases, templates } = extractPhrases(root);

  it("has every interface phrase and template in the source", () => {
    const missing = [...phrases.filter((phrase) => !(phrase in book.exact)), ...templates.filter((template) => !(template in book.templates))];
    expect(missing.slice(0, 30), `${missing.length} without Hindi — run: npx tsx scripts/i18n/extract.ts hi`).toEqual([]);
  });

  it("never invents a hole the English does not have", () => {
    const broken = Object.entries(book.templates).filter(([from, to]) => [...to.matchAll(/\{\d+\}/g)].some((hole) => !from.includes(hole[0])));
    expect(broken).toEqual([]);
  });
});
