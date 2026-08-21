import { Link } from '@/core/i18n/navigation';

export const IMAGE_GENERATOR_TITLE =
  'Free AI Image Generator | Kimi K3 - Create Images Online';

// Kept within Google's usual 150–160 character guidance while accurately
// reflecting that image creation requires a signed-in account.
export const IMAGE_GENERATOR_DESCRIPTION =
  'Generate images free with Kimi K3 AI image generator. Describe your idea and get HD images in seconds. Sign in for your first free image, up to 4 per prompt.';

export const IMAGE_GENERATOR_CANONICAL =
  'https://www.kimik3.net/image-generator';

export const IMAGE_GENERATOR_FAQS = [
  {
    question: 'Is Kimi K3 image generator free?',
    answer:
      'New accounts receive five free credits, and an eligible first standard image may be free. Image generation requires a signed-in account; later requests use credits based on the chosen model, output count, and settings.',
  },
  {
    question: 'How many images can I generate free?',
    answer:
      'The number depends on the credits available and the selected generation settings. The workspace lets you request one to four images in a prompt, while credits are charged per output where applicable. Check the current credit balance before submitting.',
  },
  {
    question: 'Can I use generated images commercially?',
    answer:
      'Kimi K3 does not publish a blanket commercial-use license for every output. Make sure you have rights to each prompt and reference asset, then review the Terms of Service and the applicable model-provider terms before commercial use.',
  },
  {
    question: 'What image sizes are supported?',
    answer:
      'Choose Smart for the provider default, or select an available aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 20:9, or 9:20. The selected model determines the delivered pixel dimensions.',
  },
  {
    question: 'Does Kimi K3 save my images?',
    answer:
      'Generated images can appear in My Images so you can revisit a task. Account and usage information may be retained while your account is active or as needed to provide the service, so download important work and avoid putting sensitive information in prompts.',
  },
] as const;

export const IMAGE_GENERATOR_STRUCTURED_DATA = [
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: IMAGE_GENERATOR_FAQS.map((faq) => ({
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
    name: 'Kimi K3 Image Generator',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    url: IMAGE_GENERATOR_CANONICAL,
    description: IMAGE_GENERATOR_DESCRIPTION,
    offers: [
      {
        '@type': 'Offer',
        name: 'Free credits',
        price: '0',
        priceCurrency: 'USD',
        description: 'Five free credits for new signed-in accounts.',
      },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: '99',
        priceCurrency: 'USD',
        description: 'Pro subscription, billed monthly.',
      },
    ],
  },
] as const;

const PROMPT_IDEAS = [
  {
    title: 'Product launch still life',
    prompt:
      'Premium matte-black wireless headphones on a sculptural white pedestal, soft studio lighting, subtle shadows, editorial product photography, clean beige backdrop, 4:5 vertical composition',
  },
  {
    title: 'Travel poster',
    prompt:
      'Vintage travel poster for Kyoto in spring, cherry blossoms framing a quiet street, screen-print texture, coral and indigo palette, bold cream typography space at top, 2:3 poster layout',
  },
  {
    title: 'Editorial portrait',
    prompt:
      'Fashion editorial portrait of a person in a tailored cobalt coat, daylight through frosted glass, restrained expression, fine film grain, muted gray background, magazine photography, 3:4',
  },
  {
    title: 'Architectural concept',
    prompt:
      'Compact cliffside reading room built from warm timber and glass, misty coastal morning, dramatic cantilever, architectural visualization, natural materials, wide 16:9 view',
  },
  {
    title: 'App campaign image',
    prompt:
      'A cheerful runner holding a smartphone after a morning workout, sunlit city park, bright athletic campaign art direction, breathable negative space on the left for headline, 4:3',
  },
  {
    title: 'Fantasy book cover',
    prompt:
      'An ancient observatory floating above a sea of clouds at twilight, a lone astronomer on the terrace, luminous constellations, cinematic fantasy illustration, deep navy and gold, 2:3 book-cover composition',
  },
] as const;

const COMPARISON_ROWS = [
  {
    tool: 'Kimi K3',
    price:
      'Five free credits for new signed-in accounts; paid plans start at $19/month.',
    free: 'Credits are available after sign-in; output count can be set from 1 to 4.',
    href: '/pricing',
    label: 'See Kimi K3 pricing',
  },
  {
    tool: 'Midjourney',
    price: 'Plans start at $10/month.',
    free: 'No standing free trial is listed by Midjourney.',
    href: 'https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans',
    label: 'See Midjourney plans',
  },
  {
    tool: 'DALL·E / GPT Image API',
    price: 'Pay as you go; GPT Image API images start at about $0.02 each.',
    free: 'No ongoing free API allowance is listed in the image API pricing.',
    href: 'https://openai.com/index/image-generation-api/',
    label: 'See OpenAI image API pricing',
  },
  {
    tool: 'Stable Diffusion',
    price: 'Stability API image generation starts around $0.03 per image.',
    free: 'Stability lists 25 free credits for new developer accounts.',
    href: 'https://platform.stability.ai/pricing',
    label: 'See Stability pricing',
  },
] as const;

/**
 * Static editorial content intentionally contains no client-only state.
 * It sits after the interactive workspace in the route tree and is rendered
 * into the server HTML, giving crawlers the same meaningful content as users.
 */
export function ImageGeneratorSeoContent() {
  return (
    <article className="bg-background text-foreground border-border border-t">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-primary mb-4 text-sm font-semibold tracking-[0.18em] uppercase">
            Kimi K3 image creation
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Free AI Image Generator - Create Images Online
          </h1>
          <p className="text-muted-foreground mt-6 text-lg leading-8">
            Turn a clear idea into a visual direction, then refine it with a
            prompt, an aspect ratio, and optional reference images. This free AI
            image generator is built for quick concept work, social assets,
            product studies, and visual experiments without a separate design
            workflow.
          </p>
        </header>

        <div className="mx-auto mt-16 max-w-3xl space-y-14 text-[15px] leading-7 sm:text-base">
          <section aria-labelledby="what-is-kimi-k3">
            <h2
              id="what-is-kimi-k3"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              What Is the Kimi K3 AI Image Generator?
            </h2>
            <p className="text-muted-foreground mt-5">
              Kimi K3 turns text instructions into original images through a
              browser-based workspace. Describe the subject, visual style,
              light, composition, and intended format, then choose a model and
              ratio before you generate. The{' '}
              <strong>Kimi image generator</strong> is most useful when you want
              a fast first draft that can be improved with more specific
              direction instead of starting from a blank canvas.
            </p>
            <p className="text-muted-foreground mt-4">
              The fastest prompts establish four things: what is in the image,
              how it should look, where it is framed, and what must be avoided.
              For example, “a ceramic coffee cup” is a subject; “editorial
              studio photograph” adds style; “on a pale stone plinth, 4:5” adds
              composition; and “no text or logos” sets a constraint. This makes
              a free AI image generator online feel more predictable than a
              one-line guess.
            </p>
            <p className="text-muted-foreground mt-4">
              People who search for “ai image generator free” are often
              comparing more than an initial price. A useful choice also makes
              it easy to choose a frame, guide the visual direction, review a
              result, and improve the next attempt without rebuilding the idea
              from scratch.
            </p>
          </section>

          <section aria-labelledby="generate-in-three-steps">
            <h2
              id="generate-in-three-steps"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              How to Generate Images Free in 3 Steps
            </h2>
            <ol className="mt-5 space-y-5">
              <li>
                <h3 className="font-semibold">1. Describe the image clearly</h3>
                <p className="text-muted-foreground mt-1">
                  Use the large prompt field in the workspace above. Start with
                  the main subject, then add material, mood, lighting, camera
                  angle, style, and any text or elements to avoid. You can also
                  upload reference images with the plus button when a specific
                  object, palette, or composition matters.
                </p>
              </li>
              <li>
                <h3 className="font-semibold">
                  2. Set the output count and frame
                </h3>
                <p className="text-muted-foreground mt-1">
                  Choose one to four images for a prompt, then leave the aspect
                  ratio on Smart or select the frame that fits the destination.
                  Square works well for feeds, vertical frames suit stories and
                  posters, and wide frames suit headers or presentation slides.
                  The selected model and settings determine the required
                  credits.
                </p>
              </li>
              <li>
                <h3 className="font-semibold">
                  3. Generate, review, and refine
                </h3>
                <p className="text-muted-foreground mt-1">
                  Sign in, submit with the arrow button, and review results in
                  My Images. If the result is close, preserve the useful parts
                  of the prompt and change only one or two directions—such as
                  “warmer afternoon light” or “closer crop”—for a more
                  controlled next attempt.
                </p>
              </li>
            </ol>
          </section>

          <section aria-labelledby="prompt-ideas">
            <h2
              id="prompt-ideas"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              6 Image Prompt Ideas You Can Copy
            </h2>
            <p className="text-muted-foreground mt-5">
              These starters are deliberately specific enough to produce a
              coherent first result, while leaving room for your own brand,
              product, or story. Copy one into the prompt box, then replace the
              nouns and colors that are unique to your project.
            </p>
            <div className="mt-6 space-y-5">
              {PROMPT_IDEAS.map((idea, index) => (
                <section
                  key={idea.title}
                  aria-labelledby={`prompt-idea-${index + 1}`}
                  className="border-border rounded-2xl border p-5"
                >
                  <h3 id={`prompt-idea-${index + 1}`} className="font-semibold">
                    {index + 1}. {idea.title}
                  </h3>
                  <pre className="bg-muted/55 text-muted-foreground mt-3 overflow-x-auto rounded-xl p-4 font-sans text-sm leading-6 whitespace-pre-wrap">
                    {idea.prompt}
                  </pre>
                </section>
              ))}
            </div>
            <p className="text-muted-foreground mt-5">
              Prompting is iterative. Ask for a concrete medium—photograph,
              paper collage, 3D render, ink sketch, or poster—rather than only
              saying “beautiful.” Then name one compositional choice, such as a
              close-up, overhead view, centered object, or room for a headline.
              That small amount of direction usually improves useful variation
              more than adding a long list of unrelated adjectives.
            </p>
          </section>

          <section aria-labelledby="comparison">
            <h2
              id="comparison"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Kimi K3 vs Other Free AI Image Generators
            </h2>
            <p className="text-muted-foreground mt-5">
              The word “free” means different things across image tools: a
              credit grant, a limited trial, local open-source software, or
              simply an account before API usage is billed. This comparison is a
              practical pricing snapshot, not a quality ranking. Check each
              provider’s current page before a purchase because limits and
              prices can change.
            </p>
            <div className="border-border mt-6 overflow-x-auto rounded-2xl border">
              <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                <thead className="bg-muted/50 text-foreground">
                  <tr>
                    <th scope="col" className="p-4 font-semibold">
                      Tool
                    </th>
                    <th scope="col" className="p-4 font-semibold">
                      Entry price
                    </th>
                    <th scope="col" className="p-4 font-semibold">
                      Free access
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr
                      key={row.tool}
                      className="border-border border-t align-top"
                    >
                      <th scope="row" className="p-4 font-semibold">
                        {row.tool}
                      </th>
                      <td className="text-muted-foreground p-4">{row.price}</td>
                      <td className="text-muted-foreground p-4">
                        {row.free}{' '}
                        {row.href.startsWith('/') ? (
                          <Link
                            href={row.href}
                            className="text-primary underline underline-offset-4"
                          >
                            {row.label}
                          </Link>
                        ) : (
                          <a
                            href={row.href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline underline-offset-4"
                          >
                            {row.label}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground mt-5">
              If you are comparing a no-cost image workspace with a paid
              subscription, test the same prompt in each tool and compare the
              time to a usable output—not just the first picture. Consider
              ratios, reference-image support, download workflow, brand safety,
              and the cost of making the variants your project actually needs.
            </p>
          </section>

          <section aria-labelledby="free-vs-pro">
            <h2
              id="free-vs-pro"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Free vs Pro: What&apos;s Included
            </h2>
            <p className="text-muted-foreground mt-5">
              The free starting credits are a way to try the workflow with a
              real prompt. They are not an unlimited plan: each generation can
              consume credits according to its model, resolution, and number of
              output images. That makes it sensible to begin with one image,
              identify the art direction you want, then ask for a larger batch
              only when the direction is clear.
            </p>
            <p className="text-muted-foreground mt-4">
              Paid plans add a larger monthly credit balance for ongoing work.
              The current plans begin with Lite at $19 per month, while Pro is
              $99 per month for people who need a larger allocation. See the{' '}
              <Link
                href="/pricing"
                className="text-primary font-medium underline underline-offset-4"
              >
                pricing page
              </Link>{' '}
              for the live plan details, included credits, and any changes to
              credit rules before you subscribe.
            </p>
            <p className="text-muted-foreground mt-4">
              If you are specifically searching for a{' '}
              <em>free image generator no signup</em>, it is important to know
              that Kimi K3 asks you to sign in before it creates an image. That
              account step lets the workspace apply the introductory credit
              balance and keep your recent results available in My Images.
            </p>
          </section>

          <section aria-labelledby="faq">
            <h2
              id="faq"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Frequently Asked Questions
            </h2>
            <div className="divide-border border-border mt-5 divide-y rounded-2xl border px-5">
              {IMAGE_GENERATOR_FAQS.map((faq) => (
                <section key={faq.question} className="py-5">
                  <h3 className="font-semibold">{faq.question}</h3>
                  <p className="text-muted-foreground mt-2">{faq.answer}</p>
                </section>
              ))}
            </div>
            <p className="text-muted-foreground mt-5">
              A free AI image generator is most useful when expectations are
              clear: write a descriptive prompt, choose a sensible frame, review
              the result, and keep rights and privacy in mind before you
              publish. For personal or commercial projects, always validate the
              final asset against your own brand, permissions, and delivery
              requirements.
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}
