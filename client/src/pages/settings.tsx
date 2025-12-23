import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, Key, Mic, Settings2, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, HardDrive } from "lucide-react";
import type { Settings } from "@shared/schema";

const settingsFormSchema = z.object({
  elevenLabsApiKey: z.string().optional(),
  yandexDiskToken: z.string().optional(),
  maleVoiceId: z.string().min(1, "Укажите ID голоса"),
  femaleVoiceId: z.string().min(1, "Укажите ID голоса"),
  dailyDialogsCount: z.coerce.number().min(1).max(50),
  defaultPrompt: z.string().min(10, "Промпт должен быть не менее 10 символов"),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export default function SettingsPage() {
  const { toast } = useToast();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showYandexToken, setShowYandexToken] = useState(false);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      elevenLabsApiKey: "",
      yandexDiskToken: "",
      maleVoiceId: "onwK4e9ZLuTAKqWW03F9",
      femaleVoiceId: "EXAVITQu4vr4xnSDxMaL",
      dailyDialogsCount: 12,
      defaultPrompt: `Создай короткий диалог между ведущими радио "Алания FM" (мужчина и женщина). 
Тема: жизнь экспатов в Аланье, Турция. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.`,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        elevenLabsApiKey: settings.elevenLabsApiKey || "",
        yandexDiskToken: settings.yandexDiskToken || "",
        maleVoiceId: settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9",
        femaleVoiceId: settings.femaleVoiceId || "EXAVITQu4vr4xnSDxMaL",
        dailyDialogsCount: settings.dailyDialogsCount || 12,
        defaultPrompt: settings.defaultPrompt || "",
      });
    }
  }, [settings, form]);

  const saveMutation = useMutation({
    mutationFn: async (data: SettingsFormValues) => {
      return apiRequest("POST", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Сохранено",
        description: "Настройки успешно обновлены",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось сохранить настройки",
        variant: "destructive",
      });
    },
  });

  const testElevenLabsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/test-elevenlabs", {
        apiKey: form.getValues("elevenLabsApiKey"),
      });
    },
    onSuccess: () => {
      toast({
        title: "Успешно",
        description: "Подключение к ElevenLabs работает",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка подключения",
        description: error.message || "Не удалось подключиться к ElevenLabs",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SettingsFormValues) => {
    saveMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Настройки</h1>
        <p className="text-muted-foreground">Управление параметрами приложения</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API ключи
              </CardTitle>
              <CardDescription>Ключи для внешних сервисов</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="elevenLabsApiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ElevenLabs API Key</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <div className="relative flex-1">
                          <Input
                            type={showApiKey ? "text" : "password"}
                            placeholder="Введите API ключ ElevenLabs"
                            {...field}
                            data-testid="input-elevenlabs-key"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0"
                            onClick={() => setShowApiKey(!showApiKey)}
                          >
                            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => testElevenLabsMutation.mutate()}
                        disabled={testElevenLabsMutation.isPending || !field.value}
                        data-testid="button-test-elevenlabs"
                      >
                        {testElevenLabsMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Проверить"
                        )}
                      </Button>
                    </div>
                    <FormDescription>
                      Получите ключ на{" "}
                      <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        elevenlabs.io
                      </a>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <FormField
                control={form.control}
                name="yandexDiskToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4" />
                      Яндекс.Диск OAuth Token
                    </FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <div className="relative flex-1">
                          <Input
                            type={showYandexToken ? "text" : "password"}
                            placeholder="Введите OAuth токен Яндекс.Диска"
                            {...field}
                            data-testid="input-yandex-token"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0"
                            onClick={() => setShowYandexToken(!showYandexToken)}
                          >
                            {showYandexToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </FormControl>
                    </div>
                    <FormDescription>
                      Токен для загрузки файлов на Яндекс.Диск (настроим позже)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Голоса ElevenLabs
              </CardTitle>
              <CardDescription>ID голосов для мужского и женского ведущих</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="maleVoiceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Мужской голос (Voice ID)</FormLabel>
                      <FormControl>
                        <Input placeholder="ID голоса" {...field} data-testid="input-male-voice" />
                      </FormControl>
                      <FormDescription>По умолчанию: Daniel (русский)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="femaleVoiceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Женский голос (Voice ID)</FormLabel>
                      <FormControl>
                        <Input placeholder="ID голоса" {...field} data-testid="input-female-voice" />
                      </FormControl>
                      <FormDescription>По умолчанию: Sarah (русский)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Генерация
              </CardTitle>
              <CardDescription>Параметры создания подводок</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="dailyDialogsCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Количество подводок в день</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        className="w-32"
                        {...field}
                        data-testid="input-daily-count"
                      />
                    </FormControl>
                    <FormDescription>От 1 до 50 подводок в день</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <FormField
                control={form.control}
                name="defaultPrompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Промпт по умолчанию</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Базовый промпт для генерации диалогов..."
                        className="min-h-[150px]"
                        {...field}
                        data-testid="textarea-default-prompt"
                      />
                    </FormControl>
                    <FormDescription>
                      Этот промпт будет использоваться по умолчанию при создании новых подводок
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Сохранить настройки
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
