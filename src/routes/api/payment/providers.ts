import { createFileRoute } from '@tanstack/react-router';

import { getAvailablePaymentProviders } from '@/modules/payment/service';
import { respData, respErr } from '@/lib/resp';

async function GET() {
  try {
    const providers = await getAvailablePaymentProviders();
    return respData(providers, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('payment providers error:', error);
    return respErr(error?.message || 'Failed to load payment providers');
  }
}

export const Route = createFileRoute('/api/payment/providers')({
  server: {
    handlers: { GET },
  },
});
