import { describe, expect, it } from "vitest";

import { describeMailFailure } from "@/server/mail/mailer";
import { smtpFrom } from "@/server/mail/smtp";

describe("smtpFrom", () => {
  it("keeps MAIL_FROM's name but never its Resend-only address", () => {
    expect(smtpFrom("SchoolOS <onboarding@resend.dev>", "school@gmail.com")).toBe("SchoolOS <school@gmail.com>");
    expect(smtpFrom('"Sankeswar School" <x@y.z>', "school@gmail.com")).toBe("Sankeswar School <school@gmail.com>");
    expect(smtpFrom("onboarding@resend.dev", "school@gmail.com")).toBe("SchoolOS <school@gmail.com>");
  });
});

describe("describeMailFailure", () => {
  it("explains Resend's test mode — why reset mail to yourself works but activation to others does not", () => {
    const reason = describeMailFailure(
      new Error("Resend refused the message (403): You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains."),
    );
    expect(reason).toMatch(/test mode/);
    expect(reason).toMatch(/MAIL_FROM/);
  });

  it("names a bad key, a missing provider and a network problem", () => {
    expect(describeMailFailure(new Error("Resend refused the message (401): API key is invalid"))).toMatch(/RESEND_API_KEY/);
    expect(describeMailFailure(new Error("No mail provider configured."))).toMatch(/not set/);
    expect(describeMailFailure(new Error("The operation was aborted due to timeout"))).toMatch(/could not be reached/);
  });

  it("explains SMTP failures, such as a Gmail account password instead of an App Password", () => {
    expect(describeMailFailure(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"))).toMatch(/App Password/);
    expect(describeMailFailure(new Error("Connection timeout"))).toMatch(/could not be reached/);
  });

  it("never repeats an API key", () => {
    expect(describeMailFailure(new Error("weird failure for re_AbCdEf123456_secret"))).not.toContain("AbCdEf123456");
  });
});
