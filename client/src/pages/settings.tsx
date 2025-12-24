import { useEffect, useState, useRef } from "react";
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
import { Save, Key, Mic, Settings2, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, HardDrive, Radio, Upload, Globe, X, FileText } from "lucide-react";
import { VoiceInput } from "@/components/voice-input";
import type { Settings } from "@shared/schema";

const settingsFormSchema = z.object({
  elevenLabsApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  yandexDiskToken: z.string().optional(),
  maleVoiceId: z.string().min(1, "Укажите ID голоса"),
  femaleVoiceId: z.string().min(1, "Укажите ID голоса"),
  dailyDialogsCount: z.coerce.number().min(1).max(50),
  defaultPrompt: z.string().min(10, "Промпт должен быть не менее 10 символов"),
  stationName: z.string().optional(),
  stationLogo: z.string().optional(),
  stationDescription: z.string().optional(),
  stationWebsite: z.string().optional(),
  stationLocation: z.string().optional(),
  stationAttachments: z.array(z.string()).optional(),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export default function SettingsPage() {
  const { toast } = useToast();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showYandexToken, setShowYandexToken] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      elevenLabsApiKey: "",
      anthropicApiKey: "",
      yandexDiskToken: "",
      maleVoiceId: "onwK4e9ZLuTAKqWW03F9",
      femaleVoiceId: "EXAVITQu4vr4xnSDxMaL",
      dailyDialogsCount: 12,
      defaultPrompt: `Создай короткий диалог между ведущими радио "Алания FM" (мужчина и женщина). 
Тема: жизнь экспатов в Аланье, Турция. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.`,
      stationName: "Alanya FM",
      stationLogo: "",
      stationDescription: "",
      stationWebsite: "",
      stationLocation: "Аланья, Турция",
      stationAttachments: [],
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        elevenLabsApiKey: settings.elevenLabsApiKey || "",
        anthropicApiKey: settings.anthropicApiKey || "",
        yandexDiskToken: settings.yandexDiskToken || "",
        maleVoiceId: settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9",
        femaleVoiceId: settings.femaleVoiceId || "EXAVITQu4vr4xnSDxMaL",
        dailyDialogsCount: settings.dailyDialogsCount || 12,
        defaultPrompt: settings.defaultPrompt || "",
        stationName: settings.stationName || "Alanya FM",
        stationLogo: settings.stationLogo || "",
        stationDescription: settings.stationDescription || "",
        stationWebsite: settings.stationWebsite || "",
        stationLocation: settings.stationLocation || "Аланья, Турция",
        stationAttachments: settings.stationAttachments || [],
      });
    }
  }, [settings, form]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingLogo(true);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch("/api/upload/logo", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) throw new Error("Ошибка загрузки");
      
      const data = await response.json();
      form.setValue("stationLogo", data.url);
      toast({ title: "Логотип загружен" });
    } catch (error) {
      toast({ title: "Ошибка загрузки логотипа", variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch("/api/upload/attachment", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) throw new Error("Ошибка загрузки");
      
      const data = await response.json();
      const currentAttachments = form.getValues("stationAttachments") || [];
      form.setValue("stationAttachments", [...currentAttachments, data.url]);
      toast({ title: "Файл добавлен" });
    } catch (error) {
      toast({ title: "Ошибка загрузки файла", variant: "destructive" });
    }
  };

  const removeAttachment = (index: number) => {
    const currentAttachments = form.getValues("stationAttachments") || [];
    form.setValue("stationAttachments", currentAttachments.filter((_, i) => i !== index));
  };

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

  const testAnthropicMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/test-anthropic", {
        apiKey: form.getValues("anthropicApiKey"),
      });
    },
    onSuccess: () => {
      toast({
        title: "Успешно",
        description: "Подключение к Claude (Anthropic) работает",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка подключения",
        description: error.message || "Не удалось подключиться к Anthropic",
        variant: "destructive",
      });
    },
  });

  const testYandexMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/test-yandex", {
        token: form.getValues("yandexDiskToken"),
      });
    },
    onSuccess: () => {
      toast({
        title: "Успешно",
        description: "Подключение к Яндекс.Диску работает",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка подключения",
        description: error.message || "Не удалось подключиться к Яндекс.Диску",
        variant: "destructive",
      });
    },
  });

  const saveFieldMutation = useMutation({
    mutationFn: async (fieldData: Partial<SettingsFormValues>) => {
      return apiRequest("POST", "/api/settings", { ...form.getValues(), ...fieldData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Сохранено",
        description: "API ключ сохранён",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось сохранить",
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
                    <div className="flex gap-2 items-center">
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
                        size="icon"
                        onClick={() => saveFieldMutation.mutate({ elevenLabsApiKey: field.value })}
                        disabled={saveFieldMutation.isPending || !field.value}
                        data-testid="button-save-elevenlabs"
                      >
                        {saveFieldMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
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
                name="anthropicApiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claude (Anthropic) API Key</FormLabel>
                    <div className="flex gap-2 items-center">
                      <FormControl>
                        <div className="relative flex-1">
                          <Input
                            type={showAnthropicKey ? "text" : "password"}
                            placeholder="Введите API ключ Anthropic"
                            {...field}
                            data-testid="input-anthropic-key"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0"
                            onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                          >
                            {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => saveFieldMutation.mutate({ anthropicApiKey: field.value })}
                        disabled={saveFieldMutation.isPending || !field.value}
                        data-testid="button-save-anthropic"
                      >
                        {saveFieldMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => testAnthropicMutation.mutate()}
                        disabled={testAnthropicMutation.isPending || !field.value}
                        data-testid="button-test-anthropic"
                      >
                        {testAnthropicMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Проверить"
                        )}
                      </Button>
                    </div>
                    <FormDescription>
                      Claude создаёт более качественные тексты. Получите ключ на{" "}
                      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        console.anthropic.com
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
                    <div className="flex gap-2 items-center">
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
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => saveFieldMutation.mutate({ yandexDiskToken: field.value })}
                        disabled={saveFieldMutation.isPending || !field.value}
                        data-testid="button-save-yandex"
                      >
                        {saveFieldMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => testYandexMutation.mutate()}
                        disabled={testYandexMutation.isPending || !field.value}
                        data-testid="button-test-yandex"
                      >
                        {testYandexMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Проверить"
                        )}
                      </Button>
                    </div>
                    <FormDescription>
                      Токен для загрузки файлов на Яндекс.Диск
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
                    <div className="flex gap-1 items-start">
                      <FormControl>
                        <Textarea
                          placeholder="Базовый промпт для генерации диалогов..."
                          className="min-h-[150px] flex-1"
                          {...field}
                          data-testid="textarea-default-prompt"
                        />
                      </FormControl>
                      <VoiceInput onTranscript={(text) => field.onChange(field.value + " " + text)} />
                    </div>
                    <FormDescription>
                      Этот промпт будет использоваться по умолчанию при создании новых подводок
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
                <Radio className="h-5 w-5" />
                О радиостанции
              </CardTitle>
              <CardDescription>Информация о вашей радиостанции</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="stationName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Название станции</FormLabel>
                      <FormControl>
                        <Input placeholder="Alanya FM" {...field} data-testid="input-station-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="stationWebsite"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Сайт станции
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="https://alanyafm.com" {...field} data-testid="input-station-website" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="stationLocation"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Местоположение</FormLabel>
                      <FormControl>
                        <Input placeholder="Аланья, Турция" {...field} data-testid="input-station-location" />
                      </FormControl>
                      <FormDescription>
                        Отображается внизу боковой панели
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="stationLogo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Логотип</FormLabel>
                    <div className="flex items-center gap-4">
                      {field.value ? (
                        <div className="relative">
                          <img 
                            src={field.value} 
                            alt="Логотип" 
                            className="h-16 w-16 rounded-md object-cover border"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="destructive"
                            className="absolute -top-2 -right-2 h-6 w-6"
                            onClick={() => form.setValue("stationLogo", "")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="h-16 w-16 rounded-md border-2 border-dashed flex items-center justify-center text-muted-foreground">
                          <Radio className="h-6 w-6" />
                        </div>
                      )}
                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          ref={logoInputRef}
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => logoInputRef.current?.click()}
                          disabled={uploadingLogo}
                          data-testid="button-upload-logo"
                        >
                          {uploadingLogo ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="mr-2 h-4 w-4" />
                          )}
                          Загрузить логотип
                        </Button>
                      </div>
                    </div>
                    <FormDescription>
                      Рекомендуемый размер: 200x200 px
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <FormField
                control={form.control}
                name="stationDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Описание / Промпт о станции</FormLabel>
                    <div className="flex gap-1 items-start">
                      <FormControl>
                        <Textarea
                          placeholder="Опишите вашу радиостанцию: формат, аудиторию, стиль вещания. Эта информация будет использоваться в генерации контента."
                          className="min-h-[120px] flex-1"
                          {...field}
                          data-testid="textarea-station-description"
                        />
                      </FormControl>
                      <VoiceInput onTranscript={(text) => field.onChange(field.value + " " + text)} />
                    </div>
                    <FormDescription>
                      Используется как контекст при генерации диалогов и передач
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <FormField
                control={form.control}
                name="stationAttachments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Прикреплённые файлы
                    </FormLabel>
                    <div className="space-y-2">
                      {(field.value || []).map((url, index) => (
                        <div key={index} className="flex items-center gap-2 p-2 rounded-md bg-muted">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="flex-1 text-sm truncate">{url.split("/").pop()}</span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeAttachment(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <div>
                        <input
                          type="file"
                          ref={attachmentInputRef}
                          onChange={handleAttachmentUpload}
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => attachmentInputRef.current?.click()}
                          data-testid="button-add-attachment"
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Добавить файл
                        </Button>
                      </div>
                    </div>
                    <FormDescription>
                      Дополнительные материалы о станции (PDF, документы)
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
