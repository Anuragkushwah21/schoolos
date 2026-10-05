/**
 * The one phone rule, shared by PhoneField and every server schema: +91 by
 * default, at most 10 local digits, digits only, stored as "+91 9876543210".
 * Numbers saved in older spellings still parse.
 */
import { describe, expect, it } from "vitest";

import { normalizePhone, parsePhone, phoneErrorFor, splitPhoneForInput } from "@/lib/phone";
import { optionalPhone, requiredPhone } from "@/lib/validation/common";
import { createSchoolAdminSchema } from "@/lib/validation/platform";

describe("parsePhone / normalizePhone", () => {
  it("reads every common Indian spelling as the same number", () => {
    for (const input of ["9876543210", "98765 43210", "+91 98765 43210", "+91-98765-43210", "+919876543210", "919876543210", "09876543210", "+91 (98765) 43210"]) {
      expect(normalizePhone(input), input).toBe("+91 9876543210");
    }
  });

  it("keeps another country's code", () => {
    expect(parsePhone("+971 50 123 4567")).toEqual({ country: "+971", digits: "501234567" });
    expect(normalizePhone("+1 415 555 0100")).toBe("+1 4155550100");
    expect(normalizePhone("+977 9812345678")).toBe("+977 9812345678");
  });

  it("refuses letters, too few or too many digits, a leading zero and unknown codes", () => {
    for (const input of ["98765abcde", "98765O4321", "987654321", "98765432101", "+91 98765 432101", "+91 0876543210", "+999 9876543210", "", "   ", "+", "12-34"]) {
      expect(normalizePhone(input), input).toBeNull();
    }
  });

  it("never allows more than 10 local digits, whatever the country", () => {
    expect(normalizePhone("+44 79111234567")).toBeNull();
    expect(normalizePhone("+1 41555501000")).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(phoneErrorFor("98765abcde")).toMatch(/digits only/i);
    expect(phoneErrorFor("98765")).toMatch(/10-digit number after \+91/);
    expect(phoneErrorFor("+999 123")).toMatch(/country code/);
  });

  it("splits a stored or old value for the input, never showing it blank", () => {
    expect(splitPhoneForInput("+91 9876543210")).toEqual({ country: "+91", digits: "9876543210" });
    expect(splitPhoneForInput("98765-43210")).toEqual({ country: "+91", digits: "9876543210" });
    expect(splitPhoneForInput(null)).toEqual({ country: "+91", digits: "" });
    // An old value that does not pass keeps its last 10 digits for the person to fix.
    expect(splitPhoneForInput("12345")).toEqual({ country: "+91", digits: "12345" });
  });
});

describe("server schemas", () => {
  it("requiredPhone stores the standard form and rejects invalid input", () => {
    expect(requiredPhone.parse("98765 43210")).toBe("+91 9876543210");
    expect(requiredPhone.safeParse("98765 4321O").success).toBe(false);
    expect(requiredPhone.safeParse("").success).toBe(false);
    expect(requiredPhone.safeParse("987654321012").success).toBe(false);
  });

  it("optionalPhone treats blank as none and still validates anything typed", () => {
    expect(optionalPhone.parse("")).toBeNull();
    expect(optionalPhone.parse(undefined)).toBeNull();
    expect(optionalPhone.parse("+91 9876543210")).toBe("+91 9876543210");
    expect(optionalPhone.safeParse("call me").success).toBe(false);
  });

  it("the platform's new-admin form now checks the phone too", () => {
    const base = { schoolId: "cm0000000000000000000000", firstName: "A", lastName: "B", email: "a@b.test" };
    expect(createSchoolAdminSchema.safeParse({ ...base, phone: "12345678901234" }).success).toBe(false);
    expect(createSchoolAdminSchema.parse({ ...base, phone: "9876543210" }).phone).toBe("+91 9876543210");
  });
});
