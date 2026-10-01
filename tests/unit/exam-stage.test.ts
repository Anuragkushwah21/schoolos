import { describe, expect, it } from "vitest";

import { examStage, publishBlocker } from "@/lib/exam-stage";

const base = { published: false, papers: 6, notHeld: 0, entered: 180, expected: 180 };

describe("exam stage", () => {
  it("moves DRAFT → IN_PROGRESS → MARKS_PENDING → READY_TO_PUBLISH → PUBLISHED from the marks", () => {
    expect(examStage({ ...base, papers: 0, expected: 0, entered: 0 })).toBe("DRAFT");
    expect(examStage({ ...base, notHeld: 6, entered: 0 })).toBe("DRAFT");
    expect(examStage({ ...base, notHeld: 2, entered: 60 })).toBe("IN_PROGRESS");
    expect(examStage({ ...base, entered: 142 })).toBe("MARKS_PENDING");
    expect(examStage(base)).toBe("READY_TO_PUBLISH");
    expect(examStage({ ...base, published: true, entered: 0 })).toBe("PUBLISHED");
  });

  it("says in plain words why results cannot be published", () => {
    expect(publishBlocker({ ...base, notHeld: 6, entered: 0 })).toMatchObject({ detail: "6 papers are still pending.", action: "papers" });
    expect(publishBlocker({ ...base, entered: 142 })).toMatchObject({
      headline: "All papers are complete.",
      detail: "142 / 180 marks entered. 38 marks are still missing.",
      action: "marks",
    });
    expect(publishBlocker(base)).toBeNull();
  });
});
