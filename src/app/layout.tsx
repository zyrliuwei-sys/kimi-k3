import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getLocale } from "next-intl/server";
import { envConfigs } from "@/config";
import { locales } from "@/config/locale";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: envConfigs.app_name,
  description: envConfigs.app_description,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const appUrl = envConfigs.app_url || '';

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {locales.map((loc) => (
          <link
            key={loc}
            rel="alternate"
            hrefLang={loc}
            href={`${appUrl}${loc === 'en' ? '' : `/${loc}`}`}
          />
        ))}
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}
