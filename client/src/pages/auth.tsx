import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, Loader2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation("/");
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
            <h1 className="text-2xl font-bold tracking-tight">RadioFlow AI</h1>
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
                  placeholder="your@email.com"
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
