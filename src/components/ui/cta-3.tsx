import { ArrowRightIcon, PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * A compact editorial call-to-action with technical corner marks. Kept in the
 * UI layer so marketing pages can reuse the same visual language as checkout.
 */
export function CallToAction() {
  return (
    <section className="relative mx-auto flex w-full max-w-3xl flex-col justify-between gap-y-6 border-y bg-[radial-gradient(35%_80%_at_25%_0%,color-mix(in_oklab,var(--foreground)_8%,transparent),transparent)] px-4 py-8">
      <PlusIcon
        aria-hidden="true"
        className="absolute -top-3 -left-3 z-10 size-6"
        strokeWidth={1}
      />
      <PlusIcon
        aria-hidden="true"
        className="absolute -top-3 -right-3 z-10 size-6"
        strokeWidth={1}
      />
      <PlusIcon
        aria-hidden="true"
        className="absolute -bottom-3 -left-3 z-10 size-6"
        strokeWidth={1}
      />
      <PlusIcon
        aria-hidden="true"
        className="absolute -right-3 -bottom-3 z-10 size-6"
        strokeWidth={1}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-y-6 left-0 w-px border-l"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-y-6 right-0 w-px border-r"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -bottom-6 left-1/2 -z-10 border-l border-dashed"
      />

      <div className="space-y-1">
        <h2 className="text-center text-2xl font-bold">
          Let your plans shape the future.
        </h2>
        <p className="text-muted-foreground text-center">
          Start your free trial today. No credit card required.
        </p>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline">Contact Sales</Button>
        <Button>
          Get Started <ArrowRightIcon className="ml-1 size-4" />
        </Button>
      </div>
    </section>
  );
}
