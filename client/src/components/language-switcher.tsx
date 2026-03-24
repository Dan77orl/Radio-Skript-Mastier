import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const languageCodes = ["ru", "en", "tr"] as const;
const flags: Record<string, string> = { ru: "🇷🇺", en: "🇬🇧", tr: "🇹🇷" };

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="button-language-switcher">
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languageCodes.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => changeLanguage(code)}
            className={i18n.language === code ? "bg-accent" : ""}
            data-testid={`lang-${code}`}
          >
            <span className="mr-2">{flags[code]}</span>
            {t(`languages.${code}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
