import "server-only";
import { normEmail } from "./session";

// Test e-mails that log in without the e-mail code (PORTAL_TRUSTED_EMAILS, comma-separated).
// They get member access only; admin/host powers still come from the magic-link keys.
export function isTrustedEmail(email: string): boolean {
  const list = (process.env.PORTAL_TRUSTED_EMAILS || "")
    .split(",")
    .map((e) => normEmail(e))
    .filter(Boolean);
  return list.includes(email);
}
