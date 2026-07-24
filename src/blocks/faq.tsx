'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { tDynamic } from '@/core/i18n/dynamic';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';

interface FaqEntry {
  key: string;
  question: string;
  answer: string;
}

/**
 * Shared FAQ item slugs. Consumed by both the FAQ UI below and the homepage
 * FAQPage JSON-LD (src/routes/index.tsx) so the visible questions and the
 * structured data fed to search engines can never drift apart. Each slug maps
 * to `landing.faq.<slug>.{question,answer}` in messages/{en,zh}.json.
 */
export const FAQ_ITEMS = [
  'vs_kimik3',
  'how',
  'time_cost',
  'formats',
  'license',
] as const;

export function FAQ() {
  const items: FaqEntry[] = FAQ_ITEMS.map((key) => ({
    key,
    question: tDynamic(`landing.faq.${key}.question`),
    answer: tDynamic(`landing.faq.${key}.answer`),
  }));

  const [open, setOpen] = useState<string | null>(null);

  return (
    <section
      id="faq"
      className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-20 md:px-8 md:py-32"
    >
      <h2 className="text-center text-4xl font-medium tracking-tight sm:text-5xl">
        {m['landing.faq.title']()}
      </h2>
      <p className="text-muted-foreground mx-auto max-w-2xl text-center text-base">
        {m['landing.faq.description']()}
      </p>
      <div className="mx-auto mt-10 w-full max-w-3xl">
        {items.map((faq) => (
          <FAQItem
            key={faq.key}
            question={faq.question}
            answer={faq.answer}
            open={open}
            setOpen={setOpen}
          />
        ))}
      </div>
    </section>
  );
}

const FAQItem = ({
  question,
  answer,
  setOpen,
  open,
}: {
  question: string;
  answer: string;
  open: string | null;
  setOpen: (open: string | null) => void;
}) => {
  const isOpen = open === question;

  return (
    <div
      className="mb-8 w-full cursor-pointer rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)] sm:p-6 dark:border-neutral-800 dark:bg-neutral-900"
      onClick={() => {
        setOpen(isOpen ? null : question);
      }}
    >
      <div className="flex items-start">
        <div className="relative mt-1 mr-4 size-6 shrink-0">
          <ChevronUp
            className={cn(
              'absolute inset-0 size-6 transform transition-all duration-200',
              isOpen && 'scale-0 rotate-90'
            )}
          />
          <ChevronDown
            className={cn(
              'absolute inset-0 size-6 scale-0 rotate-90 transform transition-all duration-200',
              isOpen && 'scale-100 rotate-0'
            )}
          />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium sm:text-lg">{question}</h3>
          <AnimatePresence mode="wait">
            {isOpen && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="text-muted-foreground overflow-hidden text-sm sm:text-base"
              >
                <p className="pt-2 leading-relaxed">
                  {answer.split('').map((char, index) => (
                    <motion.span
                      key={index}
                      initial={{ opacity: 0, filter: 'blur(5px)' }}
                      animate={{ opacity: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, filter: 'blur(0px)' }}
                      transition={{
                        duration: 0.2,
                        ease: 'easeOut',
                        delay: index * 0.005,
                      }}
                    >
                      {char}
                    </motion.span>
                  ))}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
