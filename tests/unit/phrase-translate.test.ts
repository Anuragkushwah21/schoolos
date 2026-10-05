/**
 * The phrase translator behind "switch language and everything changes":
 * exact phrases, templates with holes (whose contents are translated too),
 * "A · B" lists, punctuation, spacing, dates — and nothing a person typed.
 */
import { describe, expect, it } from "vitest";

import { createPhraseTranslator, normalizePhrase } from "@/lib/i18n/phrase-translate";

const translate = createPhraseTranslator({
  exact: { "Add staff": "स्टाफ़ जोड़ें", Active: "सक्रिय", "On leave": "छुट्टी पर", "Save changes": "बदलाव सहेजें", Students: "छात्र", "Nothing due.": "कुछ बाकी नहीं।" },
  templates: { "Status changed to {0}": "स्थिति बदलकर {0} हुई", "{0} of {1} marked": "{1} में से {0} दर्ज", "Covering for {0} until {1}": "{1} तक {0} की जगह" },
});

describe("phrase translator", () => {
  it("translates exact phrases, keeping the spaces around a text node", () => {
    expect(translate("Add staff")).toBe("स्टाफ़ जोड़ें");
    expect(translate("  Add   staff ")).toBe(" स्टाफ़ जोड़ें ");
    expect(translate("Don&apos;t")).toBeNull();
    expect(normalizePhrase("Don&apos;t  go\n here")).toBe("Don't go here");
  });

  it("fills templates, translating what goes in the holes", () => {
    expect(translate("Status changed to Active")).toBe("स्थिति बदलकर सक्रिय हुई");
    expect(translate("3 of 12 marked")).toBe("12 में से 3 दर्ज");
    expect(translate("Covering for Rajesh Kumar until 5 Oct 2026")).toBe("5 अक्टू॰ 2026 तक Rajesh Kumar की जगह");
  });

  it("handles · lists and punctuation the dictionary does not have", () => {
    expect(translate("Active · On leave · Ravi")).toBe("सक्रिय · छुट्टी पर · Ravi");
    expect(translate("Students:")).toBe("छात्र:");
    expect(translate("Nothing due")).toBe("कुछ बाकी नहीं");
  });

  it("puts month and day names of dates into Hindi, never words in names", () => {
    expect(translate("Mon, 5 Oct 2026")).toBe("सोम, 5 अक्टू॰ 2026");
    expect(translate("October 2026")).toBe("अक्टूबर 2026");
    expect(translate("May Sharma")).toBeNull();
  });

  it("leaves what people typed alone", () => {
    expect(translate("Aarav Gupta")).toBeNull();
    expect(translate("ADM-2026-00012")).toBeNull();
    expect(translate("9876543210")).toBeNull();
    expect(translate("सक्रिय")).toBeNull();
  });
});
