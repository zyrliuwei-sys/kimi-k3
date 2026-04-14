import { respOk, respErr } from '@/lib/resp';
import { handleWebhook } from '@/modules/payment/service';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;

    const event = await handleWebhook({ req, provider });

    console.log(`Payment event [${provider}]: ${event.eventType}`);

    return respOk();
  } catch (error: any) {
    console.error('webhook error:', error);
    return respErr(error.message || 'Webhook handling failed');
  }
}
