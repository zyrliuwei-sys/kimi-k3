import { headers } from 'next/headers';
import { respData, respErr } from '@/lib/resp';
import { getAuth } from '@/core/auth';
import { createCheckout } from '@/modules/payment/service';

export async function POST(req: Request) {
  try {
    const auth = getAuth();
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return respErr('Unauthorized');
    }

    const body = await req.json();
    const { product_id, payment_provider, price, currency, type, description } = body;

    if (!product_id && !price) {
      return respErr('Missing product_id or price');
    }

    const checkout = await createCheckout({
      userId: session.user.id,
      userEmail: session.user.email,
      paymentOrder: {
        productId: product_id,
        price: price ? { amount: price, currency: currency || 'usd' } : undefined,
        type: type || 'one-time',
        description: description || '',
        customer: {
          email: session.user.email,
          name: session.user.name,
        },
      },
      provider: payment_provider,
    });

    return respData({ checkout_url: checkout.checkoutInfo.checkoutUrl });
  } catch (error: any) {
    console.error('checkout error:', error);
    return respErr(error.message || 'Checkout failed');
  }
}
