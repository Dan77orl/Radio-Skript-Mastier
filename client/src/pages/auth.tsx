import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, Loader2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { TelegramLoginButton } from "@/components/telegram-login";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const [twoFactorPending, setTwoFactorPending] = useState<{ telegramUsername: string | null } | null>(null);

  const finishAuth = (data: any) => {
    if (data?.language) {
      i18n.changeLanguage(data.language);
      localStorage.setItem("radioflow-language", data.language);
    }
    setTwoFactorPending(null);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    setLocation("/");
  };

  const telegramMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/auth/telegram", payload);
      return res.json();
    },
    onSuccess: finishAuth,
    onError: (error: Error) => {
      toast({ title: t("auth.loginError"), description: error.message, variant: "destructive" });
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      // 202 + twoFactorRequired: password was right, Telegram must confirm.
      if (data?.twoFactorRequired) {
        setTwoFactorPending({ telegramUsername: data.telegramUsername ?? null });
        return;
      }
      finishAuth(data);
    },
    onError: (error: Error) => {
      toast({
        title: t("auth.loginError"),
        description: error.message.includes("401") ? t("auth.invalidCredentials") : error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { email: string; password: string; name: string }) => {
      const res = await apiRequest("POST", "/api/auth/register", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: t("auth.registerError"),
        description: error.message.includes("409") ? t("auth.userExists") : error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ email, password, name });
    }
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg">
            <Radio className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("auth.appName")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.subtitle")}</p>
          </div>
        </div>

        <Card className="shadow-xl border-border/50">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">
              {isLogin ? t("auth.loginTitle") : t("auth.registerTitle")}
            </CardTitle>
            <CardDescription>
              {isLogin ? t("auth.loginDescription") : t("auth.registerDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name">{t("auth.nameField")}</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder={t("auth.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required={!isLogin}
                    data-testid="input-name"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("auth.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="input-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={isLogin ? t("auth.passwordPlaceholderLogin") : t("auth.passwordPlaceholderRegister")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isLogin ? 1 : 6}
                  data-testid="input-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isPending}
                data-testid="button-auth-submit"
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLogin ? t("auth.login") : t("auth.register")}
              </Button>
            </form>

            {twoFactorPending ? (
              <div className="mt-6 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
                <p className="text-sm font-semibold">{t("auth.twoFactorTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {twoFactorPending.telegramUsername
                    ? t("auth.twoFactorDescNamed", { username: twoFactorPending.telegramUsername })
                    : t("auth.twoFactorDesc")}
                </p>
                <TelegramLoginButton onAuth={(data) => telegramMutation.mutate(data)} />
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">{t("auth.orContinueWith")}</span>
                  </div>
                </div>
                <TelegramLoginButton onAuth={(data) => telegramMutation.mutate(data)} />
              </div>
            )}

            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">
                {isLogin ? t("auth.noAccount") : t("auth.hasAccount")}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setEmail("");
                  setPassword("");
                  setName("");
                }}
                className="text-primary hover:underline font-medium"
                data-testid="button-toggle-auth-mode"
              >
                {isLogin ? t("auth.register") : t("auth.login")}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
