import type { Metadata } from "next";
import { Inter, Libre_Baskerville, Noto_Serif_SC } from "next/font/google";
import { getLocale } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { GoogleOneTap } from "@/components/google-one-tap";
import { envConfigs } from "@/config";
import { locales } from "@/config/locale";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif-display",
});
const notoSerifSC = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-serif-sc",
  preload: false,
});

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
      <body
        className={`${inter.variable} ${libreBaskerville.variable} ${notoSerifSC.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-center" richColors />
          <GoogleOneTap />
        </ThemeProvider>
      </body>
    </html>
  );
}
