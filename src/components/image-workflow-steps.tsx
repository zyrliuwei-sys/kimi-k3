import { motion } from 'motion/react';

import { cn } from '@/lib/utils';

export type ImageWorkflowStep = {
  number: string;
  title: string;
  description: string;
};

type ImageWorkflowStepsProps = {
  eyebrow: string;
  title: string;
  steps: ImageWorkflowStep[];
  className?: string;
};

/**
 * An editorial bento board that turns the image workflow into four small,
 * visual decisions: reference, framing, direction, and final output.
 */
export function ImageWorkflowSteps({
  eyebrow,
  title,
  steps,
  className,
}: ImageWorkflowStepsProps) {
  const reference = steps[0];
  const direction = steps[1];
  const output = steps[2];

  if (!reference || !direction || !output) return null;

  const [frameCopy, remainingDirectionCopy] = splitCopy(
    direction.description,
    1
  );
  const promptCopy = compactCopy(remainingDirectionCopy, 118);
  const [referenceCopy] = splitCopy(reference.description, 2);
  const [outputCopy] = splitCopy(output.description, 2);

  return (
    <section
      aria-labelledby="how-it-works-title"
      className={cn(
        'border-t border-black/[0.08] pt-14 sm:pt-20 dark:border-white/10',
        className
      )}
    >
      <div className="relative isolate overflow-hidden rounded-[2rem] border border-black/[0.08] bg-[#f8f9fb] px-5 py-8 sm:px-8 sm:py-11 lg:px-10 dark:border-white/10 dark:bg-[#101114]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(29,29,31,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(29,29,31,0.035)_1px,transparent_1px)] [background-size:26px_26px] opacity-70 dark:opacity-30"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 right-[-6rem] h-96 w-96 rounded-full bg-[#0071e3]/10 blur-3xl dark:bg-sky-300/10"
        />

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.56, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex flex-col gap-6 border-b border-black/[0.08] pb-8 lg:flex-row lg:items-end lg:justify-between dark:border-white/10"
        >
          <div>
            <p className="text-[10px] font-semibold tracking-[0.3em] text-[#6e6e73] uppercase dark:text-white/50">
              {eyebrow}
            </p>
            <h2
              id="how-it-works-title"
              className="mt-4 max-w-[12ch] text-[clamp(3rem,5.2vw,6.1rem)] leading-[0.9] font-semibold tracking-[-0.075em] text-balance"
            >
              {title}
            </h2>
          </div>
          <p className="max-w-54 text-[11px] leading-relaxed tracking-[0.1em] text-[#6e6e73] uppercase lg:pb-1 lg:text-right dark:text-white/45">
            Four small choices. One image that feels like yours.
          </p>
        </motion.div>

        <div className="relative mt-8 grid grid-cols-1 gap-4 md:grid-flow-col md:auto-rows-[15rem] md:grid-cols-2 md:grid-rows-3 xl:auto-rows-[20rem] xl:grid-cols-3 xl:grid-rows-2">
          <WorkflowBentoCard
            step={reference.number}
            label="Reference"
            title={reference.title}
            description={referenceCopy}
            className="md:row-span-2"
          >
            <WorkflowImage
              src="/imgs/workflow/reference-upload.png"
              alt="Reference image upload interface"
            />
          </WorkflowBentoCard>

          <WorkflowBentoCard
            step={direction.number}
            label="Frame"
            title="Set the frame"
            description={frameCopy}
          >
            <WorkflowImage
              src="/imgs/workflow/aspect-ratio.png"
              alt="Aspect-ratio selection interface"
            />
          </WorkflowBentoCard>

          <WorkflowBentoCard
            step={direction.number}
            label="Direction"
            title="Describe the scene"
            description={promptCopy}
          >
            <WorkflowImage
              src="/imgs/workflow/prompt-direction.png"
              alt="Prompt direction interface"
            />
          </WorkflowBentoCard>

          <WorkflowBentoCard
            step={output.number}
            label="Output"
            title={output.title}
            description={outputCopy}
            className="md:row-span-2"
          >
            <WorkflowImage
              src="/imgs/workflow/output-download.png"
              alt="Generated image download interface"
            />
          </WorkflowBentoCard>
        </div>
      </div>
    </section>
  );
}

function WorkflowBentoCard({
  step,
  label,
  title,
  description,
  children,
  className,
}: {
  step: string;
  label: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className={cn(
        'group relative isolate flex min-h-[21rem] flex-col overflow-hidden rounded-[28px] border border-black/[0.09] bg-white shadow-[0_1px_1px_rgba(0,0,0,0.04),0_16px_40px_rgba(28,60,86,0.06)] transition-shadow duration-500 hover:shadow-[0_26px_56px_rgba(28,60,86,0.12)] md:min-h-0 dark:border-white/10 dark:bg-[#18191d] dark:shadow-none dark:hover:shadow-[0_26px_56px_rgba(0,0,0,0.3)]',
        className
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_9%_0%,rgba(0,113,227,0.12),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.75),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 dark:bg-[radial-gradient(circle_at_9%_0%,rgba(56,189,248,0.15),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]"
      />
      <div className="relative p-6 pb-0">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[1.1rem] leading-none font-medium tracking-[-0.045em] text-[#0071e3] dark:text-sky-300">
            {step}
          </span>
          <span className="rounded-full border border-black/[0.07] bg-black/[0.025] px-2.5 py-1 text-[9px] font-semibold tracking-[0.14em] text-[#6e6e73] uppercase dark:border-white/10 dark:bg-white/[0.04] dark:text-white/45">
            {label}
          </span>
        </div>
        <h3 className="mt-5 max-w-[17ch] text-[clamp(1.45rem,2vw,2.1rem)] leading-[1.05] font-semibold tracking-[-0.06em] text-[#1d1d1f] dark:text-white">
          {title}
        </h3>
        <p className="mt-3 max-w-[43ch] text-sm leading-6 tracking-[-0.018em] text-[#6e6e73] dark:text-white/55">
          {description}
        </p>
      </div>
      <div className="relative mt-5 min-h-40 overflow-hidden px-6 pt-5">
        {children}
      </div>
    </motion.article>
  );
}

function WorkflowImage({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="block w-full rounded-t-[20px] border border-black/[0.06] dark:border-white/10"
    />
  );
}

function splitCopy(description: string, splitAfter: number): [string, string] {
  const sentences = description.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [
    description,
  ];
  return [
    sentences.slice(0, splitAfter).join(' ').trim(),
    sentences.slice(splitAfter).join(' ').trim() ||
      sentences.slice(0, 1).join(' ').trim(),
  ];
}

function compactCopy(copy: string, limit: number) {
  if (copy.length <= limit) return copy;
  const shortened = copy.slice(0, limit).replace(/\s+\S*$/, '');
  return `${shortened}…`;
}
