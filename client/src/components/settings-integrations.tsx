import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cloud, Send, Check, Loader2 } from "lucide-react";
import { TelegramLoginButton } from "@/components/telegram-login";

interface StorageStatus {
  provider: string;
  googleDrive: { available: boolean; connected: boolean; email: string | null; folderId: string | null };
  yandex: { connected: boolean };
}

interface TelegramStatus {
  linked: boolean;
  telegramUsername: string | null;
  requireTelegramLogin: boolean;
  hasPassword: boolean;
}

export function StorageSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: status } = useQuery<StorageStatus>({ queryKey: ["/api/storage/status"] });

  // The Google callback redirects back here with a result in the query string.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("google");
    if (!result) return;
    if (result === "connected") {
      toast({ title: t("settings.googleConnected") });
      queryClient.invalidateQueries({ queryKey: ["/api/storage/status"] });
    } else {
      toast({ title: t("settings.googleConnectFailed"), description: result, variant: "destructive" });
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [t, toast]);

  const setProvider = useMutation({
    mutationFn: async (provider: string) => (await apiRequest("POST", "/api/storage/provider", { provider })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage/status"] });
      toast({ title: t("common.saved") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const connectGoogle = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/storage/google/auth-url")).json(),
    onSuccess: (data: { url: string }) => { window.location.href = data.url; },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const disconnectGoogle = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/storage/google/disconnect", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage/status"] });
      toast({ title: t("settings.googleDisconnected") });
    },
  });

  if (!status) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          {t("settings.storageTitle")}
        </CardTitle>
        <CardDescription>{t("settings.storageDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>{t("settings.storageProvider")}</Label>
          <Select value={status.provider} onValueChange={(v) => setProvider.mutate(v)}>
            <SelectTrigger data-testid="select-storage-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yandex">{t("settings.storageYandex")}</SelectItem>
              <SelectItem value="google_drive" disabled={!status.googleDrive.connected}>
                {t("settings.storageGoogle")}
              </SelectItem>
              <SelectItem value="none">{t("settings.storageNone")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Google Drive</p>
              <p className="text-xs text-muted-foreground">
                {!status.googleDrive.available
                  ? t("settings.googleNotConfigured")
                  : status.googleDrive.connected
                    ? status.googleDrive.email || t("settings.googleConnected")
                    : t("settings.googleNotConnected")}
              </p>
            </div>
            {status.googleDrive.available && (
              status.googleDrive.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnectGoogle.mutate()}
                  disabled={disconnectGoogle.isPending}
                  data-testid="button-google-disconnect"
                >
                  {t("settings.disconnect")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => connectGoogle.mutate()}
                  disabled={connectGoogle.isPending}
                  data-testid="button-google-connect"
                >
                  {connectGoogle.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("settings.connect")}
                </Button>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TelegramSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: status } = useQuery<TelegramStatus>({ queryKey: ["/api/auth/telegram/status"] });

  const linkTelegram = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiRequest("POST", "/api/auth/telegram", payload)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/telegram/status"] });
      toast({ title: t("settings.telegramLinked") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const unlink = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/telegram/unlink", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/telegram/status"] });
      toast({ title: t("settings.telegramUnlinked") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const setRequired = useMutation({
    mutationFn: async (required: boolean) => (await apiRequest("POST", "/api/auth/telegram/require", { required })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/telegram/status"] });
      toast({ title: t("common.saved") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  if (!status) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          {t("settings.telegramTitle")}
        </CardTitle>
        <CardDescription>{t("settings.telegramDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.linked ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Check className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm truncate">
                  {status.telegramUsername ? `@${status.telegramUsername}` : t("settings.telegramLinked")}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => unlink.mutate()}
                disabled={unlink.isPending || !status.hasPassword}
                data-testid="button-telegram-unlink"
              >
                {t("settings.disconnect")}
              </Button>
            </div>
            {!status.hasPassword && (
              <p className="text-xs text-muted-foreground">{t("settings.telegramOnlyWayIn")}</p>
            )}

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label className="text-sm font-medium">{t("settings.telegramTwoFactor")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.telegramTwoFactorDesc")}</p>
              </div>
              <Switch
                checked={status.requireTelegramLogin}
                onCheckedChange={(checked) => setRequired.mutate(checked)}
                disabled={setRequired.isPending || !status.hasPassword}
                data-testid="switch-telegram-2fa"
              />
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("settings.telegramNotLinked")}</p>
            <TelegramLoginButton onAuth={(data) => linkTelegram.mutate(data)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
