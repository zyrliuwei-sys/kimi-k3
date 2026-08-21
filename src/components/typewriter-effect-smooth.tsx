import { motion, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';

export interface TypewriterWord {
  text: string;
  className?: string;
}

interface TypewriterEffectSmoothProps {
  words: TypewriterWord[];
  className?: string;
  /** Adds a subtle insertion caret after the final word. */
  showCursor?: boolean;
}

/**
 * A lightweight, framework-native version of the familiar smooth typewriter
 * treatment. It is intentionally an inline element so it can live in display
 * headings without changing their measure or line-height.
 */
export function TypewriterEffectSmooth({
  words,
  className,
  showCursor = false,
}: TypewriterEffectSmoothProps) {
  const reduceMotion = useReducedMotion();
  const label = words.map((word) => word.text).join(' ');

  return (
    <span aria-label={label} className={cn('inline-block', className)}>
      <span aria-hidden="true">
        {words.map((word, wordIndex) => (
          <span
            key={`${word.text}-${wordIndex}`}
            className={cn('inline-block whitespace-nowrap', word.className)}
          >
            {Array.from(word.text).map((character, characterIndex) => (
              <motion.span
                key={`${character}-${characterIndex}`}
                initial={reduceMotion ? false : { opacity: 0, y: '0.22em' }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : {
                        duration: 0.26,
                        delay: wordIndex * 0.16 + characterIndex * 0.045,
                        ease: [0.22, 1, 0.36, 1],
                      }
                }
                className="inline-block"
              >
                {character}
              </motion.span>
            ))}
            {wordIndex < words.length - 1 ? ' ' : null}
          </span>
        ))}
      </span>
      {showCursor ? (
        <motion.span
          aria-hidden="true"
          animate={reduceMotion ? { opacity: 1 } : { opacity: [1, 0, 1] }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.9, repeat: Infinity, ease: 'linear' }
          }
          className="ml-[0.08em] inline-block h-[0.76em] w-[0.065em] translate-y-[0.04em] rounded-full bg-current"
        />
      ) : null}
    </span>
  );
}
