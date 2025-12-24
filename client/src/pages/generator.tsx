import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wand2, Loader2, Calendar, Clock, User, CheckCircle, Edit3, Send, RefreshCw, ChevronDown, ChevronUp, Play, FileText, Save } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Settings, Dialog, NewsItem } from "@shared/schema";

function getSlotTimeLabel(slotNumber: number, totalSlots: number): string {
  const startHour = 7;
  const endHour = 22;
  const hoursRange = endHour - startHour;
  const slotDuration = hoursRange / totalSlots;
  const slotHour = startHour + (slotNumber - 1) * slotDuration;
  const hour = Math.floor(slotHour);
  const minutes = Math.round((slotHour - hour) * 60);
  return `${hour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function getTimeOfDay(slotNumber: number, totalSlots: number): string {
  const position = slotNumber / totalSlots;
  if (position <= 0.33) return "Утро";
  if (position <= 0.66) return "День";
  return "Вечер";
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  return date.toLocaleDateString('ru-RU', options);
}

function getHolidayInfo(dateString: string): string | null {
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  if (month === 12 && day === 25) return "Рождество (европейское)";
  if (month === 12 && day === 31) return "Канун Нового года";
  if (month === 1 && day === 1) return "Новый год";
  if (month === 1 && day === 7) return "Рождество (православное)";
  if (month === 2 && day === 14) return "День святого Валентина";
  if (month === 3 && day === 8) return "Международный женский день";
  if (month === 4 && day === 23) return "День национального суверенитета Турции";
  if (month === 5 && day === 1) return "День труда";
  if (month === 5 && day === 19) return "День молодёжи Турции";
  if (month === 8 && day === 30) return "День победы Турции";
  if (month === 10 && day === 29) return "День Республики Турции";
  
  return null;
}

export default function Generator() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [expandedSlots, setExpandedSlots] = useState<Set<number>>(new Set());
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState<string>("");
  const [dailyPromptValue, setDailyPromptValue] = useState<string>("");
  const [isDailyPromptDirty, setIsDailyPromptDirty] = useState(false);

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings?.dailyPrompt && !isDailyPromptDirty) {
      setDailyPromptValue(settings.dailyPrompt);
    }
  }, [settings?.dailyPrompt, isDailyPromptDirty]);

  const { data: dialogs, isLoading: dialogsLoading } = useQuery<Dialog[]>({
    queryKey: ["/api/dialogs"],
  });

  const { data: newsItems } = useQuery<NewsItem[]>({
    queryKey: ["/api/news-items"],
  });

  const totalSlots = settings?.dailyDialogsCount || 12;
  const holiday = getHolidayInfo(selectedDate);
  
  const dialogsForDate = dialogs?.filter(d => d.scheduledDate === selectedDate) || [];
  const dialogsBySlot = new Map<number, Dialog>();
  dialogsForDate.forEach(d => {
    if (d.slotNumber) {
      dialogsBySlot.set(d.slotNumber, d);
    }
  });

  const unusedNews = newsItems?.filter(n => !n.isUsed).slice(0, 5) || [];

  const generateAllSlotsMutation = useMutation({
    mutationFn: async (data: { date: string; totalSlots: number }) => {
      const response = await apiRequest("POST", "/api/generate-day-dialogs", data);
      return response.json() as Promise<{ dialogs: Dialog[]; generatedCount: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      toast({
        title: "Диалоги сгенерированы",
        description: `Создано ${data.generatedCount} диалогов на ${formatDate(selectedDate)}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось сгенерировать диалоги",
        variant: "destructive",
      });
    },
  });

  const regenerateSlotMutation = useMutation({
    mutationFn: async (data: { dialogId: string; prompt: string }) => {
      const response = await apiRequest("POST", `/api/dialogs/${data.dialogId}/regenerate`, { prompt: data.prompt });
      return response.json() as Promise<Dialog>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      setEditingSlot(null);
      setEditPrompt("");
      toast({
        title: "Диалог обновлён",
        description: "Текст успешно перегенерирован",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось перегенерировать диалог",
        variant: "destructive",
      });
    },
  });

  const sendToAutomationMutation = useMutation({
    mutationFn: async (data: { date: string }) => {
      const response = await apiRequest("POST", "/api/send-to-automation", data);
      return response.json() as Promise<{ queued: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      toast({
        title: "Отправлено в автоматизацию",
        description: `${data.queued} диалогов добавлено в очередь на генерацию аудио`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось отправить в автоматизацию",
        variant: "destructive",
      });
    },
  });

  const saveDailyPromptMutation = useMutation({
    mutationFn: async (dailyPrompt: string) => {
      const response = await apiRequest("PATCH", "/api/settings", { dailyPrompt });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setIsDailyPromptDirty(false);
      toast({
        title: "Промпт дня сохранён",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось сохранить промпт",
        variant: "destructive",
      });
    },
  });

  const toggleSlot = (slotNumber: number) => {
    const newExpanded = new Set(expandedSlots);
    if (newExpanded.has(slotNumber)) {
      newExpanded.delete(slotNumber);
    } else {
      newExpanded.add(slotNumber);
    }
    setExpandedSlots(newExpanded);
  };

  const startEditing = (slotNumber: number, dialog: Dialog) => {
    setEditingSlot(slotNumber);
    setEditPrompt(dialog.prompt || "");
  };

  const cancelEditing = () => {
    setEditingSlot(null);
    setEditPrompt("");
  };

  const saveEdit = (dialog: Dialog) => {
    if (!editPrompt.trim()) return;
    regenerateSlotMutation.mutate({ dialogId: dialog.id, prompt: editPrompt });
  };

  const onGenerateAllSlots = () => {
    generateAllSlotsMutation.mutate({ date: selectedDate, totalSlots });
  };

  const onSendToAutomation = () => {
    sendToAutomationMutation.mutate({ date: selectedDate });
  };

  const readyDialogsCount = dialogsForDate.filter(d => d.maleText && d.femaleText).length;
  const hasAnyDialogs = dialogsForDate.length > 0;

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Генератор диалогов</h1>
          <p className="text-muted-foreground">Автоматическая генерация текстов на весь день</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Выбор дня
                  </CardTitle>
                  <CardDescription>
                    {formatDate(selectedDate)}
                    {holiday && (
                      <Badge variant="secondary" className="ml-2">
                        {holiday}
                      </Badge>
                    )}
                  </CardDescription>
                </div>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-auto"
                  data-testid="input-date"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Промпт дня
                  </label>
                  {isDailyPromptDirty && (
                    <Button
                      size="sm"
                      onClick={() => saveDailyPromptMutation.mutate(dailyPromptValue)}
                      disabled={saveDailyPromptMutation.isPending}
                      data-testid="button-save-daily-prompt"
                    >
                      {saveDailyPromptMutation.isPending ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-3 w-3" />
                      )}
                      Сохранить
                    </Button>
                  )}
                </div>
                <Textarea
                  value={dailyPromptValue}
                  onChange={(e) => {
                    setDailyPromptValue(e.target.value);
                    setIsDailyPromptDirty(true);
                  }}
                  placeholder="Инструкции для генерации диалогов на весь день..."
                  className="min-h-[100px] text-sm"
                  data-testid="textarea-daily-prompt"
                />
                <p className="text-xs text-muted-foreground">
                  Этот промпт применяется ко всем слотам дня. Включает контекст станции и персон автоматически.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={onGenerateAllSlots}
                  disabled={generateAllSlotsMutation.isPending}
                  data-testid="button-generate-all"
                >
                  {generateAllSlotsMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  Сгенерировать все слоты ({totalSlots})
                </Button>
                
                {hasAnyDialogs && (
                  <Button
                    variant="outline"
                    onClick={onSendToAutomation}
                    disabled={sendToAutomationMutation.isPending || readyDialogsCount === 0}
                    data-testid="button-send-automation"
                  >
                    {sendToAutomationMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Отправить в автоматизацию ({readyDialogsCount})
                  </Button>
                )}
              </div>

              {generateAllSlotsMutation.isPending && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <div>
                    <p className="font-medium">Генерируем диалоги...</p>
                    <p className="text-sm text-muted-foreground">Это может занять 1-2 минуты</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Слоты дня ({dialogsForDate.length}/{totalSlots})
              </CardTitle>
              <CardDescription>Кликните на слот для просмотра и редактирования</CardDescription>
            </CardHeader>
            <CardContent>
              {dialogsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-2">
                    {Array.from({ length: totalSlots }, (_, i) => {
                      const slotNumber = i + 1;
                      const dialog = dialogsBySlot.get(slotNumber);
                      const isExpanded = expandedSlots.has(slotNumber);
                      const isEditing = editingSlot === slotNumber;
                      const timeLabel = getSlotTimeLabel(slotNumber, totalSlots);
                      const timeOfDay = getTimeOfDay(slotNumber, totalSlots);

                      return (
                        <Collapsible
                          key={slotNumber}
                          open={isExpanded}
                          onOpenChange={() => toggleSlot(slotNumber)}
                        >
                          <CollapsibleTrigger asChild>
                            <div
                              className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                                dialog ? "bg-card" : "bg-muted/50"
                              }`}
                              data-testid={`slot-${slotNumber}`}
                            >
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className="font-mono">
                                  {timeLabel}
                                </Badge>
                                <span className="text-sm font-medium">
                                  Слот #{slotNumber}
                                </span>
                                <Badge variant="secondary">
                                  {timeOfDay}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                {dialog ? (
                                  <>
                                    {dialog.maleText && dialog.femaleText ? (
                                      <Badge variant="default" className="bg-green-600">
                                        <CheckCircle className="mr-1 h-3 w-3" />
                                        Готов
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary">
                                        <Clock className="mr-1 h-3 w-3" />
                                        В процессе
                                      </Badge>
                                    )}
                                  </>
                                ) : (
                                  <Badge variant="outline">Пусто</Badge>
                                )}
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            {dialog ? (
                              <div className="mt-2 p-4 rounded-lg border bg-background space-y-4">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <h4 className="font-medium">{dialog.title}</h4>
                                  <div className="flex gap-2">
                                    {!isEditing && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          startEditing(slotNumber, dialog);
                                        }}
                                        data-testid={`button-edit-${slotNumber}`}
                                      >
                                        <Edit3 className="mr-1 h-3 w-3" />
                                        Редактировать
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {isEditing ? (
                                  <div className="space-y-3">
                                    <Textarea
                                      value={editPrompt}
                                      onChange={(e) => setEditPrompt(e.target.value)}
                                      placeholder="Введите промпт для перегенерации..."
                                      className="min-h-[100px]"
                                      data-testid={`textarea-edit-${slotNumber}`}
                                    />
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => saveEdit(dialog)}
                                        disabled={regenerateSlotMutation.isPending}
                                        data-testid={`button-save-${slotNumber}`}
                                      >
                                        {regenerateSlotMutation.isPending ? (
                                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                        ) : (
                                          <RefreshCw className="mr-1 h-3 w-3" />
                                        )}
                                        Перегенерировать
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={cancelEditing}
                                        data-testid={`button-cancel-${slotNumber}`}
                                      >
                                        Отмена
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {dialog.maleText && (
                                      <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                        <div className="flex items-center gap-2 mb-2">
                                          <User className="h-4 w-4 text-blue-500" />
                                          <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                                            Мужской голос
                                          </span>
                                        </div>
                                        <p className="text-sm">{dialog.maleText}</p>
                                      </div>
                                    )}
                                    {dialog.femaleText && (
                                      <div className="p-3 rounded-lg bg-pink-500/10 border border-pink-500/20">
                                        <div className="flex items-center gap-2 mb-2">
                                          <User className="h-4 w-4 text-pink-500" />
                                          <span className="text-sm font-medium text-pink-700 dark:text-pink-400">
                                            Женский голос
                                          </span>
                                        </div>
                                        <p className="text-sm">{dialog.femaleText}</p>
                                      </div>
                                    )}
                                    {dialog.audioUrl && (
                                      <div className="flex items-center gap-2">
                                        <Button size="sm" variant="outline" asChild>
                                          <a href={dialog.audioUrl} target="_blank" rel="noopener noreferrer">
                                            <Play className="mr-1 h-3 w-3" />
                                            Прослушать
                                          </a>
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-2 p-4 rounded-lg border bg-muted/30 text-center">
                                <p className="text-sm text-muted-foreground">
                                  Диалог ещё не сгенерирован. Нажмите "Сгенерировать все слоты" выше.
                                </p>
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Статистика дня</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{dialogsForDate.length}</p>
                  <p className="text-xs text-muted-foreground">Создано</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{readyDialogsCount}</p>
                  <p className="text-xs text-muted-foreground">Готово</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{dialogsForDate.filter(d => d.audioUrl).length}</p>
                  <p className="text-xs text-muted-foreground">С аудио</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{totalSlots - dialogsForDate.length}</p>
                  <p className="text-xs text-muted-foreground">Осталось</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {unusedNews.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Свежие новости</CardTitle>
                <CardDescription>Будут использованы в генерации</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {unusedNews.map((news) => (
                    <div
                      key={news.id}
                      className="p-2 rounded-lg border text-sm"
                    >
                      <p className="font-medium line-clamp-2">{news.title}</p>
                      {news.category && (
                        <Badge variant="outline" className="mt-1">
                          {news.category}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Настройки промптов</CardTitle>
              <CardDescription>Большой дневной промпт и слотовые промпты настраиваются в разделе "Настройки"</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" asChild>
                <a href="/settings">Перейти в настройки</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
