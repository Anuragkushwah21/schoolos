/**
 * Phrase translation: English interface text → another language, by the
 * English text itself rather than by key.
 *
 * Most screens were written with their English in place, so this is what
 * makes switching language change everything a person can read: the
 * `AutoTranslate` layer runs every visible text, placeholder and tooltip
 * through `translatePhrase`. The dictionary (`phrases/<locale>.json`) has
 * exact phrases and templates with numbered holes, both produced from the
 * source by `phrase-extract.ts`; a test fails when visible text has no entry.
 *
 * What people typed — names, notes, addresses — is not in the dictionary and
 * so stays exactly as written.
 */

export type PhraseBook = {
  /** English phrase → translation. */
  exact: Record<string, string>;
  /** English template with {0}, {1}… → translation with the same holes. */
  templates: Record<string, string>;
};

const ENTITIES: Record<string, string> = { "&apos;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…" };

/** The form a phrase is looked up by: entities decoded, whitespace collapsed, trimmed. */
export function normalizePhrase(text: string): string {
  return text
    .replace(/&[a-z]+;/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[\s ]+/g, " ")
    .trim();
}

type CompiledTemplate = { regex: RegExp; target: string; anchor: string };

const MONTHS_HI: Record<string, string> = {
  January: "जनवरी", February: "फ़रवरी", March: "मार्च", April: "अप्रैल", May: "मई", June: "जून", July: "जुलाई", August: "अगस्त", September: "सितंबर", October: "अक्टूबर", November: "नवंबर", December: "दिसंबर",
  Jan: "जन॰", Feb: "फ़र॰", Mar: "मार्च", Apr: "अप्रैल", Jun: "जून", Jul: "जुल॰", Aug: "अग॰", Sep: "सित॰", Sept: "सित॰", Oct: "अक्टू॰", Nov: "नव॰", Dec: "दिस॰",
};
const DAYS_HI: Record<string, string> = {
  Monday: "सोमवार", Tuesday: "मंगलवार", Wednesday: "बुधवार", Thursday: "गुरुवार", Friday: "शुक्रवार", Saturday: "शनिवार", Sunday: "रविवार",
  Mon: "सोम", Tue: "मंगल", Wed: "बुध", Thu: "गुरु", Fri: "शुक्र", Sat: "शनि", Sun: "रवि",
};

/** Month and day names inside dates ("5 Oct 2026", "Mon, 5 Oct") — only next to a number, never in a name. */
function translateDates(text: string): string {
  if (!/\d/.test(text)) return text;
  const month = Object.keys(MONTHS_HI).join("|");
  const day = Object.keys(DAYS_HI).join("|");
  return text
    .replace(new RegExp(`\\b(\\d{1,2})\\s(${month})\\b`, "g"), (_, d: string, m: string) => `${d} ${MONTHS_HI[m]}`)
    .replace(new RegExp(`\\b(${month})\\s(\\d{4})\\b`, "g"), (_, m: string, y: string) => `${MONTHS_HI[m]} ${y}`)
    .replace(new RegExp(`\\b(${day}),?\\s(?=\\d)`, "g"), (_, d: string) => `${DAYS_HI[d]}, `);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A translator for one dictionary. Returns the translation, or null when the
 * text is not interface text it knows (so the caller leaves it alone).
 */
export function createPhraseTranslator(book: PhraseBook, options: { dates?: boolean } = { dates: true }): (text: string) => string | null {
  const exact = new Map(Object.entries(book.exact).filter(([from, to]) => to && to !== from));
  const templates: CompiledTemplate[] = Object.entries(book.templates)
    .filter(([from, to]) => to && to !== from)
    .map(([from, to]) => {
      const literals = from.split(/\{\d+\}/);
      const holes = [...from.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
      let pattern = "^";
      literals.forEach((literal, index) => {
        pattern += escapeRegex(literal);
        // A hole may be empty: `rejected${suffix}` with no suffix.
        if (index < holes.length) pattern += `(?<h${holes[index]}>.*?)`;
      });
      return { regex: new RegExp(`${pattern}$`, "s"), target: to, anchor: literals.reduce((a, b) => (b.length > a.length ? b : a), "") };
    })
    // Most specific first: more fixed text means a better match.
    .sort((a, b) => b.anchor.length - a.anchor.length);
  const cache = new Map<string, string | null>();

  const core = (key: string, depth: number): string | null => {
    const hit = exact.get(key);
    if (hit) return hit;
    for (const template of templates) {
      if (template.anchor && !key.includes(template.anchor)) continue;
      const match = template.regex.exec(key);
      if (!match?.groups) continue;
      const groups = match.groups;
      // The holes are often themselves interface text ("Status: Active").
      return template.target.replace(/\{(\d+)\}/g, (_, n: string) => {
        const value = groups[`h${n}`] ?? "";
        return depth < 2 ? (core(value, depth + 1) ?? value) : value;
      });
    }
    // "A · B · C" — each part on its own.
    if (key.includes(" · ") && depth < 2) {
      const parts = key.split(" · ");
      const done = parts.map((part) => core(part, depth + 1));
      if (done.some((part) => part !== null)) return done.map((part, index) => part ?? parts[index]).join(" · ");
    }
    // Trailing punctuation the dictionary does not have, or has.
    const punct = /^(.*?)([.:!?…,;]+)$/.exec(key);
    if (punct?.[1] && exact.has(punct[1])) return `${exact.get(punct[1])}${punct[2]}`;
    if (!punct && exact.has(`${key}.`)) return exact.get(`${key}.`)!.replace(/[.।]$/, "");
    return null;
  };

  return (text: string) => {
    const key = normalizePhrase(text);
    if (!key || !/[A-Za-z]/.test(key)) return null;
    if (cache.has(key)) {
      const cached = cache.get(key)!;
      return cached === null ? null : keepSpacing(text, cached);
    }
    let result = core(key, 0);
    if (options.dates !== false) {
      const dated = translateDates(result ?? key);
      if (dated !== (result ?? key)) result = dated;
    }
    if (cache.size > 20_000) cache.clear();
    cache.set(key, result);
    return result === null ? null : keepSpacing(text, result);
  };
}

/** Keep the spaces around a text node, so "Due " + date still reads as two words. */
function keepSpacing(original: string, translated: string): string {
  const lead = /^\s*/.exec(original)?.[0] ?? "";
  const trail = /\s*$/.exec(original)?.[0] ?? "";
  return `${lead ? " " : ""}${translated}${trail ? " " : ""}`;
}
