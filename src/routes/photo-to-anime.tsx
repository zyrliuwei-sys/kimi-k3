import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Home, Image, MessageSquarePlus, Minus, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { usePlaygroundStore } from '@/lib/playground-store';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  ImagePlayground,
  PlaygroundUpgradeCard,
} from '@/blocks/api-playground';
import { ImageTransformationGallery } from '@/components/image-transformation-gallery';
import { ImageWorkflowSteps } from '@/components/image-workflow-steps';
import { PlaygroundShell } from '@/components/playground-shell';
import { TypewriterEffectSmooth } from '@/components/typewriter-effect-smooth';

const IMAGE_GENERATOR_FAQS = [
  {
    question: 'How do I generate an image from a photo?',
    answers: [
      'Attach a reference photo, write what should change and what should stay recognizable, then submit the generation. The most useful prompts combine the subject with visual choices: for example, mention a close-up portrait, soft studio light, a spring color palette, and a gently blurred background. For a photo with several people, state who should be the focus and what each person is wearing. For landscapes, describe the time of day, atmosphere, and level of detail you want. Results are generated interpretations, so they may vary from the original; a short follow-up prompt that fixes one specific issue is more reliable than replacing every instruction at once.',
      "For the most dependable result, start with a photo you have the right to use and avoid heavy filters that obscure important features. Good light helps the model distinguish hair, eyes, clothing, and the edges of a subject from the background. A group photograph can work well when you state the number of people and their relative positions, while a close crop is often better for an avatar or profile image. If a first attempt feels too generic, add concrete details from the source photo: the color of a jacket, the shape of a pet's ears, an important landmark, or the direction of the light. These details give the generator a clearer visual target without making the prompt unnecessarily long.",
    ],
  },
  {
    question: 'How does image generation work?',
    answers: [
      'The workspace lets you explore image ideas, choose a model, and review the generation settings before you submit. Start with one focused prompt and a single reference image, then use the result to refine the composition, lighting, or style.',
      'Your image history and generation settings stay together in the workspace, making it easy to compare earlier results and continue refining an idea. The controls displayed beside the prompt are the source of truth for the options available to your account.',
    ],
  },
  {
    question: 'What image styles are supported?',
    answers: [
      'The generator responds best to descriptive visual direction rather than a narrow menu of fixed presets. You can ask for photorealistic portraits, editorial product imagery, painterly landscapes, cinematic city scenes, minimalist 3D objects, cozy interiors, or bold graphic compositions. Pair the style with details about lighting, color, framing, materials, and emotion to make the result more consistent. Avoid asking the model to imitate a living artist exactly; instead describe the techniques you appreciate, such as delicate watercolor texture or crisp geometric shadows. This approach gives you more control while keeping the finished image original to your prompt and reference.',
      'A useful prompt separates the visual style from the subject. First say what is in the picture, then add the medium and mood: for example, a friendly dog at a rainy station, warm window light, reflective pavement, and a quiet blue evening palette. This structure works for people, objects, interiors, and wide landscapes alike. You can also specify a portrait, square, or landscape composition through the aspect-ratio control to match an intended post, wallpaper, or print. When an output has the right atmosphere but the wrong framing, keep the style wording and adjust only the camera instruction. Small, intentional changes make it easier to learn which creative direction works best for your source image.',
    ],
  },
];

export const Route = createFileRoute('/photo-to-anime')({
  head: () => ({
    meta: [
      { title: 'AI Image Generator | Create Images from Text and Photos' },
      {
        name: 'description',
        content:
          'Create portraits, product visuals, pet photos, and landscapes with an AI image generator. Upload a reference, describe your idea, and generate images in a few simple steps.',
      },
    ],
  }),
  component: ImageGeneratorPage,
});

function ImageGeneratorPage() {
  const store = usePlaygroundStore();
  if (store.mode !== 'image') store.setMode('image');

  return (
    <PlaygroundShell
      brand="Kimi K3"
      brandHref="/api-playground"
      headerCta={undefined}
      upgradeCard={<PlaygroundUpgradeCard />}
      navItems={[
        {
          href: '/',
          label: m['playground.nav.home'](),
          icon: Home,
        },
        {
          href: '/api-playground',
          label: m['playground.nav.chat'](),
          icon: MessageSquarePlus,
        },
        {
          href: '/photo-to-anime',
          label: m['playground.nav.image'](),
          icon: Image,
        },
      ]}
    >
      <ImagePlaygroundPage />
    </PlaygroundShell>
  );
}

/**
 * Static, crawlable companion content for the image-generation workspace.
 * The interactive `ImagePlayground` remains deliberately untouched: this
 * route only gives search engines and first-time visitors useful context
 * before and after the generator.
 */
function ImagePlaygroundPage() {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f5f5f7] font-sans text-[#1d1d1f] selection:bg-sky-200/70 dark:bg-[#050505] dark:text-white dark:selection:bg-sky-400/30">
      <section
        aria-labelledby="image-generator-title"
        className="relative isolate overflow-hidden bg-[#f5f5f7] dark:bg-[#050505]"
      >
        <div className="relative mx-auto max-w-[1440px] px-5 pt-18 pb-8 sm:px-8 sm:pt-28 sm:pb-8">
          <p className="mb-5 text-center text-[11px] font-semibold tracking-[0.24em] text-[#515154] uppercase dark:text-white/55">
            Kimi visual studio
          </p>
          <h1
            id="image-generator-title"
            className="mx-auto text-center font-sans text-[clamp(2.25rem,10vw,3.7rem)] leading-[0.91] font-[750] tracking-[-0.075em] text-[#1d1d1f] sm:text-[clamp(3rem,6.25vw,5.75rem)] dark:text-white"
          >
            <span className="block whitespace-nowrap">AI Image Generator</span>
            <span className="mt-[0.08em] block">
              — Turn your{' '}
              <TypewriterEffectSmooth
                words={[{ text: 'concepts', className: 'text-[#006fe6]' }]}
                showCursor
              />
            </span>
            <span className="mt-[0.08em] block">into images</span>
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-center text-[17px] leading-8 text-[#6e6e73] sm:text-[19px] dark:text-white/60">
            Use this AI image generator to create portraits, pet photos, product
            visuals, landscapes, and anything else you can describe. Explore
            examples, plan a prompt, and refine your image direction in the
            workspace.
          </p>
        </div>

        {/* The community wall is the page's visual centerpiece, so it runs
            flush to the available content edges. Supporting details below
            retain the measured reading width used by the hero. */}
        <section className="mt-0 pb-10 sm:mt-0 sm:pb-14">
          <div className="w-full">
            <ImagePlayground
              myImagesPageHref="/image-generator"
              redirectOnSubmit
              staticCommunity
            />
          </div>
        </section>

        <div className="relative mx-auto max-w-[1440px] px-5 pb-14 sm:px-8 sm:pb-20">
          <div className="mx-auto mt-8 flex w-fit items-center divide-x divide-black/10 overflow-hidden rounded-full border border-black/[0.07] bg-white/55 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_10px_32px_rgba(62,105,133,0.08)] backdrop-blur-xl dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.06]">
            <span className="px-4 py-2 text-xs font-medium text-[#515154] dark:text-white/70">
              Reference-aware
            </span>
            <span className="px-4 py-2 text-xs font-medium text-[#515154] dark:text-white/70">
              Prompt-led
            </span>
            <span className="px-4 py-2 text-xs font-medium text-[#515154] dark:text-white/70">
              Private workspace
            </span>
          </div>

          <ImageTransformationGallery />
        </div>
      </section>

      <article className="mx-auto max-w-[1120px] px-5 pb-20 sm:px-8 sm:pb-28">
        <ImageWorkflowSteps
          eyebrow="A simple workflow"
          title="How to Create an Image — 3 Steps"
          steps={[
            {
              number: '01',
              title: 'Upload a clear reference photo',
              description:
                'Start with a photo where the main subject is easy to see. A face looking toward the camera, a pet with a recognizable outline, or a travel scene with a clear focal point gives the model useful visual guidance. Use the plus button in the composer to attach an image, then add a short note when a detail matters: identify the person, name the object to keep, or point out the mood you want to preserve. A reference is a creative guide rather than a rigid copy, so simple, uncluttered source images usually lead to clearer, more useful results.',
            },
            {
              number: '02',
              title: 'Pick a style and describe the scene',
              description:
                'Choose an aspect ratio that suits the image you have in mind, then write the visual direction in the prompt box. You can ask for soft studio lighting, an editorial product scene, a neon city, a calm film-like palette, or a dramatic wide composition. Describe lighting, wardrobe, background, camera distance, and the feeling of the finished image instead of relying on a style name alone. If you are testing ideas, create one image first; after you find a direction you like, generate a larger batch to compare variations side by side.',
            },
            {
              number: '03',
              title: 'Generate, review, and download',
              description:
                'Send the prompt and let the workspace create the image. New generations appear in My Images, where you can review the result, open it at a larger size, and move between previous attempts without losing your draft. If the face, background, or color treatment is close but not quite right, adjust one clear instruction and generate again. When the image is ready, open its preview and use Download to save a copy. This small iteration loop is often the fastest way to turn a familiar idea into an image that still feels personal.',
            },
          ]}
        />

        <section
          aria-labelledby="faq-title"
          className="mt-20 border-t border-black/[0.08] pt-16 sm:mt-28 sm:pt-22 dark:border-white/10"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <div className="lg:pt-2">
              <p className="text-[11px] font-semibold tracking-[0.22em] text-[#6e6e73] uppercase dark:text-white/50">
                Helpful answers
              </p>
              <h2
                id="faq-title"
                className="mt-3 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl"
              >
                Frequently asked questions
              </h2>
              <p className="mt-6 max-w-md text-[17px] leading-8 text-[#6e6e73] dark:text-white/55">
                A few practical answers before you make your first frame. Your
                prompt stays yours; adjust, compare, and refine at your own
                pace.
              </p>
            </div>
            <FAQAccordion />
          </div>
        </section>
      </article>
    </div>
  );
}

function FAQAccordion() {
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);

  return (
    <div className="divide-y divide-black/[0.1] border-y border-black/[0.1] dark:divide-white/10 dark:border-white/10">
      {IMAGE_GENERATOR_FAQS.map((faq, index) => {
        const isOpen = openQuestion === faq.question;
        const answerId = `faq-answer-${index}`;

        return (
          <article key={faq.question}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={answerId}
              onClick={() => setOpenQuestion(isOpen ? null : faq.question)}
              className="group flex w-full items-start gap-4 py-6 text-left sm:gap-5 sm:py-7"
            >
              <span className="relative mt-0.5 flex size-6 shrink-0 items-center justify-center text-[#0071e3] dark:text-sky-300">
                <Plus
                  className={cn(
                    'absolute size-5 transition-all duration-200 ease-out',
                    isOpen && 'scale-0 rotate-90 opacity-0'
                  )}
                />
                <Minus
                  className={cn(
                    'absolute size-5 scale-0 -rotate-90 opacity-0 transition-all duration-200 ease-out',
                    isOpen && 'scale-100 rotate-0 opacity-100'
                  )}
                />
              </span>
              <span className="text-xl font-semibold tracking-[-0.035em] text-[#1d1d1f] transition-colors group-hover:text-[#0071e3] sm:text-2xl dark:text-white dark:group-hover:text-sky-300">
                {faq.question}
              </span>
              <span className="ml-auto pt-1 text-[11px] font-semibold tracking-[0.18em] text-[#0071e3] dark:text-sky-300">
                {String(index + 1).padStart(2, '0')}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  id={answerId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-4 pb-7 pl-10 text-[15px] leading-7 text-[#6e6e73] sm:pl-11 dark:text-white/55">
                    {faq.answers.map((answer) => (
                      <p key={answer}>{answer}</p>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </article>
        );
      })}
    </div>
  );
}
