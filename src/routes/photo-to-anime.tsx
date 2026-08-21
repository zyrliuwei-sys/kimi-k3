import { createFileRoute } from '@tanstack/react-router';
import { Home, Image, MessageSquarePlus } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { usePlaygroundStore } from '@/lib/playground-store';
import { m } from '@/paraglide/messages.js';
import {
  ImagePlayground,
  PlaygroundUpgradeCard,
} from '@/blocks/api-playground';
import { ImageTransformationGallery } from '@/components/image-transformation-gallery';
import { ImageWorkflowSteps } from '@/components/image-workflow-steps';
import { PlaygroundShell } from '@/components/playground-shell';

const PHOTO_TO_ANIME_TITLE = 'Photo to Anime Converter | Kimi K3';
const PHOTO_TO_ANIME_DESCRIPTION =
  'Turn a photo into anime art with Kimi K3 photo to anime converter. Upload a selfie or portrait for a unique anime-style image in seconds. Free to try—sign in.';
const PHOTO_TO_ANIME_CANONICAL = 'https://www.kimik3.net/photo-to-anime';

const PHOTO_TO_ANIME_FAQS = [
  {
    question: 'Is photo to anime free?',
    answer:
      'You need to sign in to generate an image. New accounts receive five credits, but a conversion with a reference photo is priced according to the selected model, output count, and settings. The composer shows the available choices before you submit.',
  },
  {
    question: 'What photo formats are supported?',
    answer:
      'The reference picker accepts image files, including JPG, JPEG, PNG, WebP, GIF, SVG, AVIF, HEIC, and HEIF when the browser supplies a supported image MIME type. Each reference image can be up to 10 MB, and the workspace accepts up to ten references.',
  },
  {
    question: 'Can I use the anime images commercially?',
    answer:
      'Kimi K3 does not publish a blanket commercial-use license for every output. Use only photos and assets you have rights to, and review the Terms of Service and the applicable model-provider terms before using an image commercially.',
  },
] as const;

const PHOTO_TO_ANIME_STRUCTURED_DATA = [
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: PHOTO_TO_ANIME_FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Kimi K3 Photo to Anime',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    url: PHOTO_TO_ANIME_CANONICAL,
    description: PHOTO_TO_ANIME_DESCRIPTION,
  },
] as const;

const STYLE_IDEAS = [
  {
    title: 'Soft cel-shaded portrait',
    prompt:
      'Use the uploaded portrait as the character reference. Clean cel shading, warm window light, gentle blush, crisp expressive eyes, soft pastel background, polished modern anime key visual.',
  },
  {
    title: 'Rainy city night',
    prompt:
      'Keep the person in the reference photo recognizable. Anime street scene at night, rain-slick pavement, teal and magenta reflections, cinematic three-quarter portrait, detailed linework.',
  },
  {
    title: 'Hand-painted fantasy',
    prompt:
      'Transform the reference subject into an adventurous fantasy character. Hand-painted anime background, wildflower meadow, flowing cape, warm late-afternoon light, storybook color palette.',
  },
  {
    title: 'Nineties animation frame',
    prompt:
      'Turn the uploaded face into a 1990s-inspired anime animation still. Visible ink lines, limited cel palette, soft grain, dramatic side light, simple dusk-blue background.',
  },
  {
    title: 'Pet companion card',
    prompt:
      'Use the uploaded pet as the main character. Charming anime companion portrait, accurate coat markings, oversized expressive eyes, cozy sunlit room, clean character-card composition.',
  },
  {
    title: 'School festival poster',
    prompt:
      'Keep the person from the reference photo as the hero. Bright anime school festival scene, paper lanterns, confetti, dynamic smile, clear negative space at the top, vertical poster frame.',
  },
] as const;

export const Route = createFileRoute('/photo-to-anime')({
  head: () => ({
    meta: [
      { title: PHOTO_TO_ANIME_TITLE },
      { name: 'description', content: PHOTO_TO_ANIME_DESCRIPTION },
      { property: 'og:title', content: PHOTO_TO_ANIME_TITLE },
      { property: 'og:description', content: PHOTO_TO_ANIME_DESCRIPTION },
      { property: 'og:url', content: PHOTO_TO_ANIME_CANONICAL },
    ],
    links: [{ rel: 'canonical', href: PHOTO_TO_ANIME_CANONICAL }],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify(PHOTO_TO_ANIME_STRUCTURED_DATA),
      },
    ],
  }),
  component: PhotoToAnimePage,
});

function PhotoToAnimePage() {
  const store = usePlaygroundStore();
  if (store.mode !== 'image') store.setMode('image');

  return (
    <PlaygroundShell
      brand="Kimi K3"
      brandHref="/api-playground"
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
      <div className="h-full min-h-0 overflow-y-auto bg-[#f5f5f7] font-sans text-[#1d1d1f] selection:bg-sky-200/70 dark:bg-[#050505] dark:text-white dark:selection:bg-sky-400/30">
        <section
          aria-labelledby="photo-to-anime-title"
          className="border-b border-black/[0.07] bg-[#f5f5f7] dark:border-white/10 dark:bg-[#050505]"
        >
          <div className="mx-auto max-w-4xl px-5 pt-18 pb-10 text-center sm:px-8 sm:pt-28 sm:pb-14">
            <p className="text-[11px] font-semibold tracking-[0.24em] text-[#0071e3] uppercase dark:text-sky-300">
              Kimi visual studio
            </p>
            <h1
              id="photo-to-anime-title"
              className="mx-auto mt-5 max-w-4xl text-[clamp(2.6rem,7vw,5.8rem)] leading-[0.94] font-[750] tracking-[-0.075em] text-balance"
            >
              Photo to Anime Converter - Turn Photos into Anime Art
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-[17px] leading-8 text-[#6e6e73] sm:text-[19px] dark:text-white/60">
              Start with a photo you have permission to use, then guide its
              color, mood, framing, and character details. This photo to anime
              workspace is designed for portraits, pets, travel memories, and
              playful profile-image concepts.
            </p>
          </div>

          <div className="w-full pb-8 sm:pb-12">
            <ImagePlayground
              myImagesPageHref="/image-generator"
              redirectOnSubmit
              staticCommunity
              eagerFirstCommunityImage
            />
          </div>
        </section>

        <article className="mx-auto max-w-[1120px] px-5 py-16 sm:px-8 sm:py-24">
          <section
            aria-labelledby="what-is-conversion"
            className="mx-auto max-w-3xl"
          >
            <p className="text-[11px] font-semibold tracking-[0.22em] text-[#0071e3] uppercase dark:text-sky-300">
              Reference-led creation
            </p>
            <h2
              id="what-is-conversion"
              className="mt-3 text-3xl font-semibold tracking-[-0.055em] sm:text-5xl"
            >
              What Is Photo to Anime Conversion?
            </h2>
            <div className="mt-7 space-y-5 text-[16px] leading-8 text-[#6e6e73] sm:text-[17px] dark:text-white/60">
              <p>
                A reference-led conversion uses the visual information in an
                uploaded photo—such as pose, face shape, clothing, pet markings,
                and background placement—as a starting point for a newly
                generated anime-style image. It is not a pixel-for-pixel filter.
                The result is an interpretation guided by both your source image
                and the written direction you add in the prompt field.
              </p>
              <p>
                This approach is useful when the identity or memory in the
                source matters more than starting from a blank description. A
                clear selfie can become an avatar, a pet picture can become a
                character card, and a travel snapshot can become a cinematic
                illustration. The best result comes from treating the upload as
                a visual brief: say what should remain recognizable, then name
                the light, palette, setting, and emotional tone you want to
                change.
              </p>
              <p>
                Use only a photo you own or have permission to transform. Avoid
                sensitive images, private documents, and reference material with
                important information in the background. A close, well-lit
                subject with a visible face or outline gives the model clearer
                cues than a dark, heavily filtered, or distant image.
              </p>
              <p>
                Framing matters before you upload. For an avatar, crop close
                enough that the eyes, hairline, and shoulders are easy to read.
                For a pet, include the face and distinctive markings rather than
                a small animal in a crowded room. For a travel scene, keep the
                landmark or horizon visible and describe which part should
                remain the focal point. These choices give the model a clear
                source while leaving room for the new illustration to feel
                expressive.
              </p>
            </div>
          </section>

          <ImageWorkflowSteps
            className="mt-20 sm:mt-28"
            eyebrow="From reference to illustration"
            title="How to Convert a Photo to Anime in 3 Steps"
            steps={[
              {
                number: '01',
                title: 'Upload a clear photo',
                description:
                  'Use the plus button in the prompt box to choose a reference image. The picker accepts image files, including JPG, JPEG, PNG, WebP, GIF, SVG, AVIF, HEIC, and HEIF when your browser provides a supported image type. Keep each file under 10 MB; you can attach up to ten references, although one focused portrait or pet photo is the easiest place to start.',
              },
              {
                number: '02',
                title: 'Describe the anime direction',
                description:
                  'After the upload appears beside the prompt, write what should stay recognizable and what should change. Add a style, background, light, palette, camera distance, and aspect ratio. For example, say “keep the jacket and smile, use soft cel shading and a pale blue evening street.” Select one output first when testing a new direction; the image-count control supports up to four outputs for a prompt.',
              },
              {
                number: '03',
                title: 'Generate, review, and download',
                description:
                  'Sign in and send the prompt with the arrow button. The workspace creates the task and updates My Images when the provider finishes, so the actual wait depends on the selected model and current provider workload. Open a result to inspect it at a larger size, then download the version you want. If a detail is close, change one instruction at a time instead of rewriting the whole prompt.',
              },
            ]}
          />

          <section aria-labelledby="style-ideas" className="mt-20 sm:mt-28">
            <div className="mx-auto max-w-3xl">
              <p className="text-[11px] font-semibold tracking-[0.22em] text-[#0071e3] uppercase dark:text-sky-300">
                Prompt starters
              </p>
              <h2
                id="style-ideas"
                className="mt-3 text-3xl font-semibold tracking-[-0.055em] sm:text-5xl"
              >
                6 Photo to Anime Style Ideas
              </h2>
              <p className="mt-6 text-[16px] leading-8 text-[#6e6e73] sm:text-[17px] dark:text-white/60">
                The gallery above is useful for choosing a direction, but the
                prompt is where you decide what makes the result yours. Copy a
                starter below, attach a photo, and replace the details that are
                specific to your subject. Descriptive craft terms work better
                than naming a living artist: describe line quality, cel shading,
                grain, color, and light instead.
              </p>
            </div>
            <div className="mt-9 grid gap-4 md:grid-cols-2">
              {STYLE_IDEAS.map((idea, index) => (
                <section
                  key={idea.title}
                  aria-labelledby={`style-idea-${index + 1}`}
                  className="rounded-[1.5rem] border border-black/[0.08] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <h3
                    id={`style-idea-${index + 1}`}
                    className="text-lg font-semibold tracking-[-0.035em]"
                  >
                    {index + 1}. {idea.title}
                  </h3>
                  <pre className="mt-4 overflow-x-auto rounded-xl bg-[#f5f5f7] p-4 font-sans text-sm leading-6 whitespace-pre-wrap text-[#515154] dark:bg-black/25 dark:text-white/65">
                    {idea.prompt}
                  </pre>
                </section>
              ))}
            </div>
            <p className="mx-auto mt-7 max-w-3xl text-[16px] leading-8 text-[#6e6e73] sm:text-[17px] dark:text-white/60">
              A useful refinement keeps the source details that already worked
              and changes only one visual variable. Try “closer crop,” “warmer
              sunset light,” “cleaner background,” or “more expressive eyes” in
              a follow-up. Small changes make it easier to understand why one
              result feels closer to your intended character than another.
            </p>
            <p className="mx-auto mt-5 max-w-3xl text-[16px] leading-8 text-[#6e6e73] sm:text-[17px] dark:text-white/60">
              Before requesting several outputs, decide whether you are testing
              identity, mood, or composition. If identity is the priority, keep
              the reference note simple and name the features to preserve. If
              mood is the priority, describe the time of day, weather, palette,
              and level of contrast. If composition is the priority, select the
              destination ratio first and say where the subject should sit in
              the frame. A focused brief produces variations you can compare
              instead of a batch of unrelated images.
            </p>
          </section>

          <div className="mt-16">
            <ImageTransformationGallery />
          </div>

          <section
            aria-labelledby="vs-image-generator"
            className="mx-auto mt-20 max-w-3xl sm:mt-28"
          >
            <p className="text-[11px] font-semibold tracking-[0.22em] text-[#0071e3] uppercase dark:text-sky-300">
              Choose the right workspace
            </p>
            <h2
              id="vs-image-generator"
              className="mt-3 text-3xl font-semibold tracking-[-0.055em] sm:text-5xl"
            >
              Photo to Anime vs. AI Image Generator
            </h2>
            <div className="mt-7 space-y-5 text-[16px] leading-8 text-[#6e6e73] sm:text-[17px] dark:text-white/60">
              <p>
                This page is for a conversion that begins with a specific photo.
                Its job is to keep meaningful traits from that reference while
                moving the result into an anime visual language. Start here when
                the person, pet, place, pose, or composition already exists and
                you want to reinterpret it rather than invent every element.
              </p>
              <p>
                The broader{' '}
                <Link
                  href="/image-generator"
                  className="font-medium text-[#0071e3] underline underline-offset-4 dark:text-sky-300"
                >
                  image generator
                </Link>{' '}
                is a better fit for creating a product still life, a poster,
                architecture, or a scene that does not need a source photo.
                There, the prompt itself carries most of the creative brief. On
                this page, the photo and prompt work together: the reference
                anchors the subject while the prompt gives it a new setting and
                style.
              </p>
              <p>
                You can move between the two workflows without changing your
                account. Use the conversion page for a character-like version of
                a real image; use the broader workspace when you need an image
                created from a concept, a sketch of a layout, or a fully written
                art direction.
              </p>
              <p>
                The distinction also makes prompt writing simpler. In a
                reference-led workflow, spend your words on the visual changes:
                anime linework, scene, wardrobe treatment, color, and light. In
                a blank-canvas workflow, spend more of the prompt explaining the
                subject itself. Choosing the right starting point reduces
                unnecessary retries and helps you keep the parts of the original
                image that matter most.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="free-and-included"
            className="mx-auto mt-20 max-w-3xl sm:mt-28"
          >
            <p className="text-[11px] font-semibold tracking-[0.22em] text-[#0071e3] uppercase dark:text-sky-300">
              Credits and plans
            </p>
            <h2
              id="free-and-included"
              className="mt-3 text-3xl font-semibold tracking-[-0.055em] sm:text-5xl"
            >
              Is It Free? What&apos;s Included?
            </h2>
            <div className="mt-7 space-y-5 text-[16px] leading-8 text-[#6e6e73] sm:text-[17px] dark:text-white/60">
              <p>
                Creating an account gives new users five credits. Image cost is
                calculated from the selected model, size, number of requested
                outputs, and whether a reference image is included. Because this
                workflow intentionally uses an uploaded reference, check the
                controls and your credit balance before submitting a larger
                batch. The first free-image offer applies only to an eligible
                standard single image without a reference.
              </p>
              <p>
                A paid plan supplies a larger credit balance for recurring
                creative work. If you are experimenting, begin with one output
                and a focused prompt, then make variations after you have the
                right direction. Visit{' '}
                <Link
                  href="/pricing"
                  className="font-medium text-[#0071e3] underline underline-offset-4 dark:text-sky-300"
                >
                  pricing
                </Link>{' '}
                for the current plans, credit amounts, and subscription details.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="photo-faq"
            className="mx-auto mt-20 max-w-3xl sm:mt-28"
          >
            <p className="text-[11px] font-semibold tracking-[0.22em] text-[#0071e3] uppercase dark:text-sky-300">
              Helpful answers
            </p>
            <h2
              id="photo-faq"
              className="mt-3 text-3xl font-semibold tracking-[-0.055em] sm:text-5xl"
            >
              Frequently Asked Questions
            </h2>
            <div className="mt-8 divide-y divide-black/[0.1] rounded-[1.5rem] border border-black/[0.1] px-6 dark:divide-white/10 dark:border-white/10">
              {PHOTO_TO_ANIME_FAQS.map((faq, index) => (
                <section key={faq.question} className="py-6">
                  <h3 className="text-xl font-semibold tracking-[-0.035em] sm:text-2xl">
                    {index === 0 ? 'Is this converter free?' : faq.question}
                  </h3>
                  <p className="mt-3 text-[16px] leading-8 text-[#6e6e73] dark:text-white/60">
                    {faq.answer}
                  </p>
                </section>
              ))}
            </div>
          </section>
        </article>
      </div>
    </PlaygroundShell>
  );
}
