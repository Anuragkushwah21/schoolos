import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseFormData, runAction, successResult } from "@/lib/action-result";
import { ForbiddenError, ValidationError } from "@/lib/errors";

const schema = z.object({
  email: z.email(),
  name: z.string().min(2),
});

function formDataOf(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.append(key, value);
  }
  return formData;
}

describe("parseFormData", () => {
  it("returns typed data when the payload is valid", () => {
    const parsed = parseFormData(
      schema,
      formDataOf({ email: "head@abc-school.test", name: "Asha" }),
    );

    expect(parsed).toEqual({ email: "head@abc-school.test", name: "Asha" });
  });

  it("raises a ValidationError carrying per-field messages", () => {
    try {
      parseFormData(schema, formDataOf({ email: "not-an-email", name: "A" }));
      expect.unreachable("parseFormData should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const fieldErrors = (error as ValidationError).fieldErrors;
      expect(Object.keys(fieldErrors).sort()).toEqual(["email", "name"]);
    }
  });
});

describe("runAction", () => {
  it("passes a successful result through unchanged", async () => {
    const result = await runAction(async () => successResult("Saved."));

    expect(result).toEqual({ status: "success", message: "Saved.", data: undefined });
  });

  it("preserves field errors from a ValidationError", async () => {
    const result = await runAction(async () => {
      throw new ValidationError("Please correct the highlighted fields.", {
        email: ["Invalid email"],
      });
    });

    expect(result).toEqual({
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: { email: ["Invalid email"] },
    });
  });

  it("surfaces the safe message of a known AppError", async () => {
    const result = await runAction(async () => {
      throw new ForbiddenError();
    });

    expect(result).toMatchObject({
      status: "error",
      message: "You do not have access to this resource.",
    });
  });

  it("never leaks the details of an unexpected error", async () => {
    const result = await runAction(async () => {
      throw new Error('relation "students" does not exist at character 15');
    });

    expect(result.status).toBe("error");
    const message = result.status === "error" ? result.message : "";
    expect(message).toBe("Something went wrong. Please try again.");
    expect(message).not.toContain("students");
  });
});
