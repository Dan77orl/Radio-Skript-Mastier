import { useState, useEffect, useRef } from "react";
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
import { Wand2, Mic, MicOff, User, Loader2, Sparkles, Sun, Palmtree, Coffee, MapPin, Utensils, Lightbulb, PlayCircle, Download, Shield, CheckCircle, AlertTriangle, FileText, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Settings, Dialog } from "@shared/schema";

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

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
  const [moderationResult, setModerationResult] = useState<{ approved: boolean; notes: string; suggestions: string[] } | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const { data: settings, isSuccess: settingsLoaded } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: dialogs, isLoading: dialogsLoading } = useQuery<Dialog[]>({
    queryKey: ["/api/dialogs"],
  });

  const [expandedDialogId, setExpandedDialogId] = useState<string | null>(null);

  const buildDynamicPrompt = (s: Settings | undefined) => {
    const stationName = s?.stationName || "Радио";
    const location = s?.stationLocation || "Турция";
    const description = s?.stationDescription || "";
    
    let basePrompt = `Создай короткий диалог между ведущими радио "${stationName}" (мужчина и женщина). 
Тема: жизнь в ${location}. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.
Обязательно включи: приветствие слушателей, интересный факт или совет про жизнь в ${location}.`;

    if (description) {
      basePrompt += `\nО станции: ${description}`;
    }

    return basePrompt;
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
      title: "",
      scheduledDate: new Date().toISOString().split("T")[0],
      slotNumber: "1",
    },
  });

  useEffect(() => {
    if (settingsLoaded) {
      const dynamicPrompt = buildDynamicPrompt(settings);
      form.setValue("prompt", dynamicPrompt);
    }
  }, [settingsLoaded, settings, form]);

  const generateScriptMutation = useMutation({
    mutationFn: async (data: { prompt: string }) => {
      const response = await apiRequest("POST", "/api/generate-script", data);
      return response.json() as Promise<{ maleText: string; femaleText: string }>;
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
      return response.json() as Promise<Dialog>;
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
      return response.json() as Promise<{ improvedPrompt: string }>;
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

  const moderateMutation = useMutation({
    mutationFn: async (data: { maleText: string; femaleText: string }) => {
      const response = await apiRequest("POST", "/api/moderate-script", data);
      return response.json() as Promise<{ approved: boolean; notes: string; suggestions: string[] }>;
    },
    onSuccess: (data) => {
      setModerationResult(data);
      toast({
        title: data.approved ? "Контент одобрен" : "Требуется проверка",
        description: data.notes,
        variant: data.approved ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка модерации",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onModerateScript = () => {
    if (!generatedScript) return;
    moderateMutation.mutate({
      maleText: generatedScript.male,
      femaleText: generatedScript.female,
    });
  };

  const startVoiceInput = () => {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      toast({
        title: "Не поддерживается",
        description: "Голосовой ввод не поддерживается вашим браузером",
        variant: "destructive",
      });
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const currentPrompt = form.getValues("prompt");
      if (event.results[event.results.length - 1].isFinal) {
        form.setValue("prompt", currentPrompt + " " + transcript);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      toast({
        title: "Ошибка записи",
        description: "Не удалось распознать речь",
        variant: "destructive",
      });
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopVoiceInput = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  };

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
                      variant={isListening ? "destructive" : "outline"}
                      size="sm"
                      onClick={toggleVoiceInput}
                      data-testid="button-voice-input"
                    >
                      {isListening ? (
                        <>
                          <MicOff className="mr-2 h-4 w-4" />
                          Остановить
                        </>
                      ) : (
                        <>
                          <Mic className="mr-2 h-4 w-4" />
                          Голосовой ввод
                        </>
                      )}
                    </Button>
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
                  {isListening && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                      Запись... Говорите в микрофон
                    </div>
                  )}
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
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      ИИ Модератор
                    </CardTitle>
                    <CardDescription>Проверка контента перед публикацией</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    onClick={onModerateScript}
                    disabled={moderateMutation.isPending}
                    data-testid="button-moderate"
                  >
                    {moderateMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="mr-2 h-4 w-4" />
                    )}
                    Проверить контент
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {moderateMutation.isPending ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : moderationResult ? (
                  <div className="space-y-3">
                    <div className={`flex items-center gap-2 p-3 rounded-lg ${moderationResult.approved ? "bg-green-500/10" : "bg-yellow-500/10"}`}>
                      {moderationResult.approved ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      )}
                      <span className={moderationResult.approved ? "text-green-700 dark:text-green-400" : "text-yellow-700 dark:text-yellow-400"}>
                        {moderationResult.notes}
                      </span>
                    </div>
                    {moderationResult.suggestions && moderationResult.suggestions.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Рекомендации:</p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {moderationResult.suggestions.map((s, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-muted-foreground">-</span>
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Нажмите "Проверить контент" для модерации скрипта
                  </p>
                )}
              </CardContent>
            </Card>
          )}

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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                История диалогов
              </CardTitle>
              <CardDescription>Все сгенерированные тексты</CardDescription>
            </CardHeader>
            <CardContent>
              {dialogsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : dialogs && dialogs.length > 0 ? (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3 pr-4">
                    {dialogs
                      .filter(d => d.maleText || d.femaleText)
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map((dialog) => (
                        <Collapsible
                          key={dialog.id}
                          open={expandedDialogId === dialog.id}
                          onOpenChange={(open) => setExpandedDialogId(open ? dialog.id : null)}
                        >
                          <div className="rounded-lg border p-3">
                            <CollapsibleTrigger className="w-full">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Badge variant="outline" className="shrink-0">
                                    {dialog.status === "ready" ? "Готово" : dialog.status === "generating" ? "Генерация..." : "Ожидание"}
                                  </Badge>
                                  <span className="font-medium truncate">{dialog.title}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {new Date(dialog.createdAt).toLocaleDateString("ru-RU")}
                                  </span>
                                  {expandedDialogId === dialog.id ? (
                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-3 space-y-3">
                                {dialog.maleText && (
                                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                      <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Мужской голос</span>
                                    </div>
                                    <p className="text-sm whitespace-pre-wrap">{dialog.maleText}</p>
                                  </div>
                                )}
                                {dialog.femaleText && (
                                  <div className="rounded-lg bg-pink-50 dark:bg-pink-950/30 p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                      <User className="h-4 w-4 text-pink-600 dark:text-pink-400" />
                                      <span className="text-sm font-medium text-pink-600 dark:text-pink-400">Женский голос</span>
                                    </div>
                                    <p className="text-sm whitespace-pre-wrap">{dialog.femaleText}</p>
                                  </div>
                                )}
                                {dialog.audioUrl && (
                                  <div className="rounded-lg bg-muted p-3">
                                    <audio controls className="w-full" src={dialog.audioUrl}>
                                      Ваш браузер не поддерживает аудио
                                    </audio>
                                  </div>
                                )}
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Нет сгенерированных диалогов
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
