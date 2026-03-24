import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { z } from "zod";

import ru from "./locales/ru/translation.json";
import en from "./locales/en/translation.json";
import tr from "./locales/tr/translation.json";
import de from "./locales/de/translation.json";
import es from "./locales/es/translation.json";
import fr from "./locales/fr/translation.json";
import pt from "./locales/pt/translation.json";
import it from "./locales/it/translation.json";
import uk from "./locales/uk/translation.json";
import pl from "./locales/pl/translation.json";
import nl from "./locales/nl/translation.json";
import sv from "./locales/sv/translation.json";
import da from "./locales/da/translation.json";
import no from "./locales/no/translation.json";
import fi from "./locales/fi/translation.json";
import cs from "./locales/cs/translation.json";
import sk from "./locales/sk/translation.json";
import hu from "./locales/hu/translation.json";
import ro from "./locales/ro/translation.json";
import bg from "./locales/bg/translation.json";
import el from "./locales/el/translation.json";
import hr from "./locales/hr/translation.json";
import sr from "./locales/sr/translation.json";
import sl from "./locales/sl/translation.json";
import bs from "./locales/bs/translation.json";
import mk from "./locales/mk/translation.json";
import sq from "./locales/sq/translation.json";
import lt from "./locales/lt/translation.json";
import lv from "./locales/lv/translation.json";
import et from "./locales/et/translation.json";
import kk from "./locales/kk/translation.json";
import uz from "./locales/uz/translation.json";
import ky from "./locales/ky/translation.json";
import tg from "./locales/tg/translation.json";
import mn from "./locales/mn/translation.json";
import az from "./locales/az/translation.json";
import ka from "./locales/ka/translation.json";
import hy from "./locales/hy/translation.json";
import ar from "./locales/ar/translation.json";
import he from "./locales/he/translation.json";
import fa from "./locales/fa/translation.json";
import zh from "./locales/zh/translation.json";
import ja from "./locales/ja/translation.json";
import ko from "./locales/ko/translation.json";
import hi from "./locales/hi/translation.json";
import bn from "./locales/bn/translation.json";
import ta from "./locales/ta/translation.json";
import th from "./locales/th/translation.json";
import vi from "./locales/vi/translation.json";
import id from "./locales/id/translation.json";
import ms from "./locales/ms/translation.json";
import sw from "./locales/sw/translation.json";

const supportedLngs = [
  "ru", "en", "tr", "de", "es", "fr", "pt", "it", "uk", "pl",
  "nl", "sv", "da", "no", "fi", "cs", "sk", "hu", "ro", "bg",
  "el", "hr", "sr", "sl", "bs", "mk", "sq", "lt", "lv", "et",
  "kk", "uz", "ky", "tg", "mn", "az", "ka", "hy", "ar", "he",
  "fa", "zh", "ja", "ko", "hi", "bn", "ta", "th", "vi", "id",
  "ms", "sw",
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
      tr: { translation: tr },
      de: { translation: de },
      es: { translation: es },
      fr: { translation: fr },
      pt: { translation: pt },
      it: { translation: it },
      uk: { translation: uk },
      pl: { translation: pl },
      nl: { translation: nl },
      sv: { translation: sv },
      da: { translation: da },
      no: { translation: no },
      fi: { translation: fi },
      cs: { translation: cs },
      sk: { translation: sk },
      hu: { translation: hu },
      ro: { translation: ro },
      bg: { translation: bg },
      el: { translation: el },
      hr: { translation: hr },
      sr: { translation: sr },
      sl: { translation: sl },
      bs: { translation: bs },
      mk: { translation: mk },
      sq: { translation: sq },
      lt: { translation: lt },
      lv: { translation: lv },
      et: { translation: et },
      kk: { translation: kk },
      uz: { translation: uz },
      ky: { translation: ky },
      tg: { translation: tg },
      mn: { translation: mn },
      az: { translation: az },
      ka: { translation: ka },
      hy: { translation: hy },
      ar: { translation: ar },
      he: { translation: he },
      fa: { translation: fa },
      zh: { translation: zh },
      ja: { translation: ja },
      ko: { translation: ko },
      hi: { translation: hi },
      bn: { translation: bn },
      ta: { translation: ta },
      th: { translation: th },
      vi: { translation: vi },
      id: { translation: id },
      ms: { translation: ms },
      sw: { translation: sw },
    },
    fallbackLng: "en",
    supportedLngs,
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
