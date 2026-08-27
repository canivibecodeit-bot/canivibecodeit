/* Transactional mail to a sponsor's contact address — with a belt (E1).
   The address is UNVERIFIED (typed at bid time, frozen at first clear), so an
   attacker could park a victim's address on their own sponsor and let our
   held/outbid notices harass it. Two cheap controls kill that class:

   1. Suppression: if the address has unsubscribed on Resend, nothing sends.
      Fail-open on API trouble (no creds / timeout / not a contact): the HARD
      guarantee is the caps below, and a Resend blip must not silently kill
      legitimate held-notifications.
   2. Hard per-address caps, db-backed: at most 1 transactional mail per hour
      and 3 per day per address — regardless of how many cleared payments an
      attacker burns, the address sees at most 3 mails a day, ever.

   All Build Games sponsor-facing mail goes through here. alertRob and the
   opt-in LIST path (waitlist + Resend, its own unsubscribe) are separate. */
import { rateLimit } from './db.js';
import { sendMail, unmailable } from './mail.js';

async function suppressed(email) {
  const key = process.env.RESEND_API_KEY;
  const audience = process.env.RESEND_AUDIENCE_ID;
  if (!key || !audience) return false;
  try {
    const res = await fetch(
      `https://api.resend.com/audiences/${audience}/contacts/${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return false; // 404 = never a contact = nothing to honour
    return (await res.json())?.unsubscribed === true;
  } catch {
    return false;
  }
}

/* Returns true if the mail was actually handed to sendMail. */
export async function sendSponsorMail({ to, subject, html }) {
  const addr = String(to || '').trim().toLowerCase();
  if (!addr || unmailable(addr)) return false;
  // Caps first (cheap, local, the hard guarantee), suppression second.
  if (!(await rateLimit(`bgmail:h:${addr}`, 1, 60 * 60 * 1000))) return false;
  if (!(await rateLimit(`bgmail:d:${addr}`, 3, 24 * 60 * 60 * 1000))) return false;
  if (await suppressed(addr)) return false;
  await sendMail({ to: addr, subject, html });
  return true;
}
