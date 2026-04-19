import { getTranslations } from "next-intl/server";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ_KEYS = ["stack", "payment", "database", "customize", "license"] as const;

export async function FAQ() {
  const t = await getTranslations("landing");

  return (
    <section id="faq" className="px-4 py-24 sm:py-32">
      <div className="mx-auto max-w-3xl">
        <div className="text-center mb-16">
          <h2 className="font-serif font-medium text-4xl sm:text-5xl tracking-tight">
            {t("faq.title")}
          </h2>
          <p className="mt-5 text-muted-foreground">
            {t("faq.description")}
          </p>
        </div>
        <Accordion className="w-full">
          {FAQ_KEYS.map((key) => (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger className="cursor-pointer py-6 text-left text-base font-medium hover:no-underline">
                {t(`faq.${key}.question`)}
              </AccordionTrigger>
              <AccordionContent className="pb-6 text-muted-foreground leading-relaxed">
                {t(`faq.${key}.answer`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
