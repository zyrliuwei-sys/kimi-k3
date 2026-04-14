import { getRequestConfig } from 'next-intl/server';

import { defaultLocale, localeMessagesPaths } from '@/config/locale';

import { routing } from './config';

export async function loadMessages(
  path: string,
  locale: string = defaultLocale
) {
  try {
    const messages = await import(
      `@/config/locale/messages/${locale}/${path}.json`
    );
    return messages.default;
  } catch {
    try {
      const messages = await import(
        `@/config/locale/messages/${defaultLocale}/${path}.json`
      );
      return messages.default;
    } catch {
      return {};
    }
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as string)) {
    locale = routing.defaultLocale;
  }

  if (['zh-CN'].includes(locale)) {
    locale = 'zh';
  }

  try {
    const allMessages = await Promise.all(
      localeMessagesPaths.map((path) => loadMessages(path, locale))
    );

    const messages: Record<string, any> = {};

    localeMessagesPaths.forEach((path, index) => {
      const localMessages = allMessages[index];
      const keys = path.split('/');
      let current: Record<string, any> = messages;

      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = localMessages;
    });

    return { locale, messages };
  } catch {
    return {
      locale: defaultLocale,
      messages: {},
    };
  }
});
