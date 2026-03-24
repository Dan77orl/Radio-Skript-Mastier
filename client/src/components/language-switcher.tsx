import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const languageGroups = [
  {
    label: "popular",
    codes: ["ru", "en", "tr", "de", "es", "fr", "pt", "it", "zh", "ja", "ko", "ar"],
  },
  {
    label: "europe",
    codes: ["uk", "pl", "nl", "sv", "da", "no", "fi", "cs", "sk", "hu", "ro", "bg", "el", "hr", "sr", "sl", "bs", "mk", "sq", "lt", "lv", "et"],
  },
  {
    label: "asia",
    codes: ["kk", "uz", "ky", "tg", "mn", "az", "ka", "hy", "he", "fa", "hi", "bn", "ta", "th", "vi", "id", "ms"],
  },
  {
    label: "other",
    codes: ["sw"],
  },
];

const allCodes = languageGroups.flatMap(g => g.codes);

const flags: Record<string, string> = {
  ru: "🇷🇺", en: "🇬🇧", tr: "🇹🇷", de: "🇩🇪", es: "🇪🇸", fr: "🇫🇷",
  pt: "🇧🇷", it: "🇮🇹", uk: "🇺🇦", pl: "🇵🇱", nl: "🇳🇱", sv: "🇸🇪",
  da: "🇩🇰", no: "🇳🇴", fi: "🇫🇮", cs: "🇨🇿", sk: "🇸🇰", hu: "🇭🇺",
  ro: "🇷🇴", bg: "🇧🇬", el: "🇬🇷", hr: "🇭🇷", sr: "🇷🇸", sl: "🇸🇮",
  bs: "🇧🇦", mk: "🇲🇰", sq: "🇦🇱", lt: "🇱🇹", lv: "🇱🇻", et: "🇪🇪",
  kk: "🇰🇿", uz: "🇺🇿", ky: "🇰🇬", tg: "🇹🇯", mn: "🇲🇳", az: "🇦🇿",
  ka: "🇬🇪", hy: "🇦🇲", ar: "🇸🇦", he: "🇮🇱", fa: "🇮🇷", zh: "🇨🇳",
  ja: "🇯🇵", ko: "🇰🇷", hi: "🇮🇳", bn: "🇧🇩", ta: "🇱🇰", th: "🇹🇭",
  vi: "🇻🇳", id: "🇮🇩", ms: "🇲🇾", sw: "🇰🇪",
};

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const changeLanguage = async (code: string) => {
    i18n.changeLanguage(code);
    if (isAuthenticated) {
      try {
        await apiRequest("PATCH", "/api/auth/language", { language: code });
      } catch (e) {
        toast({
          title: t("common.error"),
          description: t("languages.saveError"),
          variant: "destructive",
        });
      }
    }
  };

  const filteredCodes = useMemo(() => {
    if (!searchQuery.trim()) return allCodes;
    const q = searchQuery.toLowerCase();
    return allCodes.filter(code => {
      const name = t(`languages.${code}`).toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [searchQuery, t]);

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setSearchQuery(""); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="button-language-switcher">
          <span className="text-sm mr-0.5">{flags[i18n.language] || "🌐"}</span>
          <Globe className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("common.search")}
              className="h-8 pl-7 text-sm"
              data-testid="input-language-search"
            />
          </div>
        </div>
        <ScrollArea className="h-[300px]">
          {filteredCodes.map((code) => (
            <DropdownMenuItem
              key={code}
              onClick={() => changeLanguage(code)}
              className={i18n.language === code ? "bg-accent" : ""}
              data-testid={`lang-${code}`}
            >
              <span className="mr-2">{flags[code] || "🌐"}</span>
              <span className="truncate">{t(`languages.${code}`)}</span>
            </DropdownMenuItem>
          ))}
          {filteredCodes.length === 0 && (
            <div className="px-2 py-4 text-sm text-center text-muted-foreground">
              {t("common.noData")}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
