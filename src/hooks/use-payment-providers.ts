import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';

export interface AvailablePaymentProviders {
  providers: string[];
  defaultProvider?: string;
}

/**
 * The checkout UI must only show providers that the server has fully
 * configured and registered. This query is deliberately separate from public
 * config so the list stays in sync with PaymentManager as providers are added.
 */
export function usePaymentProviders() {
  return useQuery({
    queryKey: ['payment-providers'],
    queryFn: () =>
      apiGet<AvailablePaymentProviders>('/api/payment/providers', {
        cache: 'no-store',
      }),
  });
}
