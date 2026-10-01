/**
 * Captures the mail the app sends, so a test can follow an activation or
 * reset link the way a person would — the app never hands out passwords.
 */
import { redeemAccountLink } from "@/server/auth/account-links";
import { type Mail, setMailTransport } from "@/server/mail/mailer";

export const sentMail: Mail[] = [];
setMailTransport(async (mail) => {
  sentMail.push(mail);
});

/** The token in the latest mail to `email` with this kind of link. */
export function tokenFrom(email: string, kind: "activate" | "reset-password"): string {
  const mail = [...sentMail].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase() && m.text.includes(`/${kind}?token=`));
  if (!mail) throw new Error(`No ${kind} mail was sent to ${email}.`);
  return mail.text.match(new RegExp(`/${kind}\\?token=([A-Za-z0-9_-]+)`))![1]!;
}

/** Activate an account from its email and return the password chosen. */
export async function activate(email: string, password = "Chosen-password-1"): Promise<string> {
  await redeemAccountLink(tokenFrom(email, "activate"), "ACTIVATION", password, password);
  return password;
}
