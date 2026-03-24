import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ru from "./locales/ru/translation.json";
import en from "./locales/en/translation.json";
import tr from "./locales/tr/translation.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
      tr: { translation: tr },
    },
    fallbackLng: "ru",
    supportedLngs: ["ru", "en", "tr"],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "radioflow-language",
      caches: ["localStorage"],
    },
  });

export default i18n;
