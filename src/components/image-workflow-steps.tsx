import {
  Download,
  ImageUp,
  LucideIcon,
  ScanLine,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

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
 * The conversion guide is intentionally a component rather than a generic
 * marketing grid: its previews mirror the actual photo-to-anime controls, so
 * a visitor understands the workflow before opening the composer.
 */
export function ImageWorkflowSteps({
  eyebrow,
  title,
  steps,
  className,
}: ImageWorkflowStepsProps) {
  const [reference, direction, output] = steps;
  if (!reference || !direction || !output) return null;

  const [frameCopy, directionCopy] = splitCopy(direction.description, 1);

  return (
    <section
      aria-labelledby="how-it-works-title"
      className={cn('pt-14 sm:pt-20', className)}
    >
      <div className="relative isolate overflow-hidden rounded-[2rem] border border-black/[0.08] bg-[#f8f9fb] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12 dark:border-white/10 dark:bg-[#101114]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(29,29,31,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(29,29,31,0.035)_1px,transparent_1px)] [background-size:26px_26px] opacity-80 dark:opacity-25"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 right-[-10rem] size-[34rem] rounded-full bg-[#0071e3]/10 blur-3xl dark:bg-sky-300/10"
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex flex-col gap-6 border-b border-black/[0.08] pb-8 lg:flex-row lg:items-end lg:justify-between dark:border-white/10"
        >
          <div>
            <p className="text-[10px] font-semibold tracking-[0.3em] text-[#6e6e73] uppercase dark:text-white/50">
              {eyebrow}
            </p>
            <h2
              id="how-it-works-title"
              className="mt-4 max-w-[13ch] text-[clamp(3rem,5.2vw,6.1rem)] leading-[0.9] font-semibold tracking-[-0.075em] text-balance"
            >
              {title}
            </h2>
          </div>
          <p className="max-w-56 text-[10px] leading-relaxed tracking-[0.11em] text-[#6e6e73] uppercase lg:pb-1 lg:text-right dark:text-white/45">
            One source photo. A few clear choices. An illustration that still
            feels like yours.
          </p>
        </motion.div>

        <div className="relative mt-8 grid gap-4 lg:auto-rows-[19rem] lg:grid-cols-3">
          <StepCard
            step={reference.number}
            label="Reference"
            icon={ImageUp}
            title={reference.title}
            description={compactCopy(reference.description, 212)}
            className="lg:row-span-2"
          >
            <WorkflowPreview
              src="/imgs/workflow/reference-upload.png"
              alt="Reference photo upload interface"
              className="mt-auto"
            />
          </StepCard>

          <StepCard
            step={direction.number}
            label="Frame"
            icon={ScanLine}
            title="Set the frame"
            description={compactCopy(frameCopy, 122)}
          >
            <WorkflowPreview
              src="/imgs/workflow/aspect-ratio.png"
              alt="Aspect ratio controls"
            />
          </StepCard>

          <StepCard
            step={direction.number}
            label="Direction"
            icon={Sparkles}
            title="Describe the scene"
            description={compactCopy(directionCopy, 130)}
          >
            <WorkflowPreview
              src="/imgs/workflow/prompt-direction.png"
              alt="Prompt direction controls"
            />
          </StepCard>

          <StepCard
            step={output.number}
            label="Output"
            icon={Download}
            title={output.title}
            description={compactCopy(output.description, 210)}
            className="lg:col-start-3 lg:row-span-2 lg:row-start-1"
          >
            <WorkflowPreview
              src="/imgs/workflow/output-download.png"
              alt="Generated image download interface"
              className="mt-auto"
            />
          </StepCard>
        </div>
      </div>
    </section>
  );
}

function StepCard({
  step,
  label,
  icon,
  title,
  description,
  children,
  className,
}: {
  step: string;
  label: string;
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className={cn('min-h-[22rem] lg:min-h-0', className)}
    >
      <Card className="group relative h-full gap-0 overflow-visible rounded-[28px] border border-black/[0.09] bg-white p-0 py-0 shadow-[0_1px_1px_rgba(0,0,0,0.04),0_16px_40px_rgba(28,60,86,0.06)] transition-shadow duration-500 hover:shadow-[0_26px_56px_rgba(28,60,86,0.12)] dark:border-white/10 dark:bg-[#18191d] dark:shadow-none dark:hover:shadow-[0_26px_56px_rgba(0,0,0,0.3)]">
        <CardDecorator />
        <CardHeader className="relative p-6 pb-0">
          <StepHeading icon={icon} step={step} label={label} />
          <h3 className="mt-5 max-w-[17ch] text-[clamp(1.45rem,2vw,2.1rem)] leading-[1.05] font-semibold tracking-[-0.06em] text-[#1d1d1f] dark:text-white">
            {title}
          </h3>
          <p className="mt-3 max-w-[43ch] text-sm leading-6 tracking-[-0.018em] text-[#6e6e73] dark:text-white/55">
            {description}
          </p>
        </CardHeader>
        <CardContent className="relative mt-auto flex min-h-0 flex-1 flex-col overflow-hidden p-5 pt-5 sm:p-6 sm:pt-5">
          {children}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function CardDecorator() {
  return (
    <>
      <span className="absolute -top-px -left-px z-10 block size-2 border-t-2 border-l-2 border-[#0071e3] dark:border-sky-300" />
      <span className="absolute -top-px -right-px z-10 block size-2 border-t-2 border-r-2 border-[#0071e3] dark:border-sky-300" />
      <span className="absolute -bottom-px -left-px z-10 block size-2 border-b-2 border-l-2 border-[#0071e3] dark:border-sky-300" />
      <span className="absolute -right-px -bottom-px z-10 block size-2 border-r-2 border-b-2 border-[#0071e3] dark:border-sky-300" />
    </>
  );
}

function StepHeading({
  icon: Icon,
  step,
  label,
}: {
  icon: LucideIcon;
  step: string;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[1.1rem] leading-none font-medium tracking-[-0.045em] text-[#0071e3] dark:text-sky-300">
        {step}
      </span>
      <span className="flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-black/[0.025] px-2.5 py-1 text-[9px] font-semibold tracking-[0.14em] text-[#6e6e73] uppercase dark:border-white/10 dark:bg-white/[0.04] dark:text-white/45">
        <Icon className="size-3" />
        {label}
      </span>
    </div>
  );
}

function WorkflowPreview({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[20px] border border-black/[0.06] bg-[#f8fafc] p-2 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.42)] dark:border-white/10 dark:bg-white/[0.03]',
        className
      )}
    >
      <img
        src={src}
        alt={alt}
        width={560}
        height={380}
        loading="lazy"
        decoding="async"
        className="block w-full rounded-[13px] object-contain"
      />
    </div>
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
