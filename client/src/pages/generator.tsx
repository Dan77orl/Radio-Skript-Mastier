import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wand2, Mic, User, Loader2, Sparkles, Sun, Palmtree, Coffee, MapPin, Utensils, Lightbulb, PlayCircle, Download } from "lucide-react";
import type { Settings, Dialog } from "@shared/schema";

const topicSuggestions = [
  { id: "weather", title: "Погода в Аланье", icon: Sun, category: "weather" },
  { id: "beach", title: "Пляжи и море", icon: Palmtree, category: "expat_life" },
  { id: "morning", title: "Доброе утро", icon: Coffee, category: "expat_life" },
  { id: "places", title: "Интересные места", icon: MapPin, category: "travel" },
  { id: "food", title: "Турецкая кухня", icon: Utensils, category: "food" },
  { id: "tips", title: "Полезные советы", icon: Lightbulb, category: "tips" },
];

const formSchema = z.object({
  prompt: z.string().min(10, "Промпт должен быть не менее 10 символов"),
  title: z.string().min(1, "Введите название"),
  scheduledDate: z.string().optional(),
  slotNumber: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function Generator() {
  const { toast } = useToast();
  const [generatedScript, setGeneratedScript] = useState<{ male: string; female: string } | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const { data: settings, isSuccess: settingsLoaded } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const defaultPrompt = `Создай короткий диалог между ведущими радио "Алания FM" (мужчина и женщина). 
Тема: жизнь экспатов в Аланье, Турция. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.`;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: defaultPrompt,
      title: "",
      scheduledDate: new Date().toISOString().split("T")[0],
      slotNumber: "1",
    },
  });

  useEffect(() => {
    if (settingsLoaded && settings?.defaultPrompt) {
      form.setValue("prompt", settings.defaultPrompt);
    }
  }, [settingsLoaded, settings?.defaultPrompt, form]);

  const generateScriptMutation = useMutation({
    mutationFn: async (data: { prompt: string }) => {
      const response = await apiRequest("POST", "/api/generate-script", data);
      return response as { maleText: string; femaleText: string };
    },
    onSuccess: (data) => {
      setGeneratedScript({ male: data.maleText, female: data.femaleText });
      toast({
        title: "Скрипт создан",
        description: "Диалог успешно сгенерирован. Теперь можете создать аудио.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось сгенерировать скрипт",
        variant: "destructive",
      });
    },
  });

  const generateAudioMutation = useMutation({
    mutationFn: async (data: { maleText: string; femaleText: string; title: string; scheduledDate?: string; slotNumber?: number }) => {
      const response = await apiRequest("POST", "/api/generate-audio", data);
      return response as Dialog;
    },
    onSuccess: (data) => {
      setAudioUrl(data.audioUrl || null);
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      toast({
        title: "Аудио создано",
        description: "Подводка успешно сгенерирована и сохранена.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось создать аудио",
        variant: "destructive",
      });
    },
  });

  const addTopicToPrompt = (topic: string) => {
    const currentPrompt = form.getValues("prompt");
    form.setValue("prompt", `${currentPrompt}\n\nТема сегодня: ${topic}`);
  };

  const onGenerateScript = () => {
    const prompt = form.getValues("prompt");
    if (prompt.length < 10) {
      toast({
        title: "Ошибка",
        description: "Промпт слишком короткий",
        variant: "destructive",
      });
      return;
    }
    generateScriptMutation.mutate({ prompt });
  };

  const onGenerateAudio = () => {
    if (!generatedScript) return;
    const values = form.getValues();
    generateAudioMutation.mutate({
      maleText: generatedScript.male,
      femaleText: generatedScript.female,
      title: values.title || "Подводка",
      scheduledDate: values.scheduledDate,
      slotNumber: values.slotNumber ? parseInt(values.slotNumber) : undefined,
    });
  };

  const improvePromptMutation = useMutation({
    mutationFn: async (data: { prompt: string }) => {
      const response = await apiRequest("POST", "/api/improve-prompt", data);
      return response as { improvedPrompt: string };
    },
    onSuccess: (data) => {
      form.setValue("prompt", data.improvedPrompt);
      toast({
        title: "Промпт улучшен",
        description: "ИИ оптимизировал ваш промпт",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось улучшить промпт",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Генератор диалогов</h1>
        <p className="text-muted-foreground">Создайте подводку для радио с помощью ИИ</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" />
                Редактор промпта
              </CardTitle>
              <CardDescription>Опишите, какой диалог нужно создать</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Form {...form}>
                <form className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Название подводки</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Например: Утренняя подводка про погоду"
                            {...field}
                            data-testid="input-title"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="prompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Промпт для генерации</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Опишите, какой диалог нужно создать..."
                            className="min-h-[200px] resize-none"
                            {...field}
                            data-testid="textarea-prompt"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => improvePromptMutation.mutate({ prompt: form.getValues("prompt") })}
                      disabled={improvePromptMutation.isPending}
                      data-testid="button-improve-prompt"
                    >
                      {improvePromptMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      Улучшить с ИИ
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => form.setValue("prompt", settings?.defaultPrompt || "")}
                      data-testid="button-reset-prompt"
                    >
                      Сбросить
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Быстрые темы</CardTitle>
              <CardDescription>Добавьте тему в промпт одним кликом</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {topicSuggestions.map((topic) => (
                  <Button
                    key={topic.id}
                    variant="outline"
                    size="sm"
                    onClick={() => addTopicToPrompt(topic.title)}
                    data-testid={`button-topic-${topic.id}`}
                  >
                    <topic.icon className="mr-2 h-4 w-4" />
                    {topic.title}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Планирование</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Form {...form}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="scheduledDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Дата</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-date" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="slotNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Слот</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-slot">
                              <SelectValue placeholder="Выберите слот" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Array.from({ length: settings?.dailyDialogsCount || 12 }, (_, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>
                                Слот #{i + 1}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>
              </Form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Генерация</CardTitle>
                  <CardDescription>Создайте скрипт и аудио</CardDescription>
                </div>
                <Button
                  onClick={onGenerateScript}
                  disabled={generateScriptMutation.isPending}
                  data-testid="button-generate-script"
                >
                  {generateScriptMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  Сгенерировать скрипт
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {generateScriptMutation.isPending ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                  <p className="text-muted-foreground">Генерируем диалог...</p>
                </div>
              ) : generatedScript ? (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        <User className="mr-1 h-3 w-3" />
                        Мужчина
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed">{generatedScript.male}</p>
                  </div>
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge>
                        <User className="mr-1 h-3 w-3" />
                        Женщина
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed">{generatedScript.female}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Mic className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">
                    Нажмите "Сгенерировать скрипт", чтобы создать диалог
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {generatedScript && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle>Синтез голоса</CardTitle>
                    <CardDescription>Озвучка через ElevenLabs</CardDescription>
                  </div>
                  <Button
                    onClick={onGenerateAudio}
                    disabled={generateAudioMutation.isPending}
                    data-testid="button-generate-audio"
                  >
                    {generateAudioMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="mr-2 h-4 w-4" />
                    )}
                    Создать аудио
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {generateAudioMutation.isPending ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                    <p className="text-muted-foreground">Синтезируем голоса...</p>
                    <p className="text-xs text-muted-foreground mt-1">Это может занять до минуты</p>
                  </div>
                ) : audioUrl ? (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-muted p-4">
                      <audio controls className="w-full" src={audioUrl} data-testid="audio-player">
                        Ваш браузер не поддерживает аудио
                      </audio>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" size="sm" asChild>
                        <a href={audioUrl} download data-testid="button-download">
                          <Download className="mr-2 h-4 w-4" />
                          Скачать
                        </a>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <PlayCircle className="h-10 w-10 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Аудио появится здесь после генерации
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
