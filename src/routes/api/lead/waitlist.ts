import { createFileRoute } from '@tanstack/react-router';

import { joinWaitlist } from '@/modules/lead/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';
import { getLocale } from '@/paraglide/runtime.js';

// Public (no auth) — captures leads from the homepage upload CTA.
// Rate-limited per IP+email to curb spam.
async function POST({ request }: { request: Request }) {
  const body = await request.json().catch(() => ({}) as { email?: string });
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respErr('Please enter a valid email');
  }

  // 15s between submissions per (IP, email) — returns a 429 Response if blocked.
  const blocked = enforceMinIntervalRateLimit(request, {
    intervalMs: 15_000,
    keyPrefix: 'waitlist',
    extraKey: email.toLowerCase(),
  });
  if (blocked) return blocked;

  try {
    const result = await joinWaitlist({
      email,
      source: 'hero',
      locale: getLocale(),
    });
    return respData(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to join waitlist';
    return respErr(msg);
  }
}

export const Route = createFileRoute('/api/lead/waitlist')({
  server: { handlers: { POST } },
});
