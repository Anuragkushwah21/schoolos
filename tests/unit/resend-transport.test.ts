/**
 * The Resend transport is a thin wrapper around one HTTP call, and the thing
 * worth pinning down is what it does when the call fails: an operator looking
 * at the log needs Resend's own explanation, not a bare status code.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resendTransport } from "@/server/mail/resend";

const mail = {
  to: "someone@example.test",
  from: "SchoolOS <onboarding@resend.dev>",
  subject: "Hello",
  text: "Body",
};

afterEach(() => vi.unstubAllGlobals());

describe("resend transport", () => {
  it("posts the message with the key and returns quietly on success", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resendTransport(mail)).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: [mail.to],
      from: mail.from,
      subject: mail.subject,
      text: mail.text,
    });
  });

  it("surfaces the provider's reason when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ message: "You can only send testing emails to your own email address" }),
            { status: 403 },
          ),
      ),
    );

    await expect(resendTransport(mail)).rejects.toThrow(/403.*only send testing emails/);
  });

  it("still throws when the failure body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gateway timeout", { status: 504 })));
    await expect(resendTransport(mail)).rejects.toThrow(/504/);
  });
});
