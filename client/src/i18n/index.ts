import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { z } from "zod";

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

const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  const t = i18n.t.bind(i18n);

  switch (issue.code) {
    case z.ZodIssueCode.too_small:
      if (issue.type === "string") {
        if (issue.minimum === 1) return { message: t("validation.required") };
        return { message: t("validation.minLength", { min: issue.minimum }) };
      }
      if (issue.type === "number") {
        return { message: t("validation.minValue", { min: issue.minimum }) };
      }
      break;
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") {
        return { message: t("validation.maxLength", { max: issue.maximum }) };
      }
      if (issue.type === "number") {
        return { message: t("validation.maxValue", { max: issue.maximum }) };
      }
      break;
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: t("validation.email") };
      if (issue.validation === "url") return { message: t("validation.url") };
      break;
    case z.ZodIssueCode.invalid_type:
      if (issue.expected === "string") return { message: t("validation.required") };
      return { message: t("validation.invalidType") };
  }

  return { message: ctx.defaultError };
};

z.setErrorMap(customErrorMap);

export default i18n;
