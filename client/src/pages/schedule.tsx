import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog as DialogUI,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, CheckCircle, Clock, AlertCircle, Mic, PlayCircle, PauseCircle, Calendar as CalendarIcon, Sparkles, Loader2, FileText, User, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceInput } from "@/components/voice-input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Dialog, Settings } from "@shared/schema";

function getStatusInfo(status: string) {
  switch (status) {
    case "ready":
      return { icon: CheckCircle, label: "Готов", color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10 border-green-500" };
    case "generating":
      return { icon: Clock, label: "Генерация", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500" };
    case "error":
      return { icon: AlertCircle, label: "Ошибка", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10 border-red-500" };
    default:
      return { icon: Clock, label: "Ожидание", color: "text-muted-foreground", bg: "border-dashed border-muted" };
  }
}

export default function Schedule() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [autoGenPrompt, setAutoGenPrompt] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [playingDialogId, setPlayingDialogId] = useState<string | null>(null);
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: dialogs, isLoading: dialogsLoading } = useQuery<Dialog[]>({
    queryKey: ["/api/dialogs"],
  });

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playAudio = (audioUrl: string, dialogId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (playingDialogId === dialogId) {
      setPlayingDialogId(null);
      return;
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play().catch((err) => {
      console.error("Error playing audio:", err);
      toast({ title: "Ошибка воспроизведения", variant: "destructive" });
    });
    setPlayingDialogId(dialogId);
    audio.onended = () => setPlayingDialogId(null);
  };

  const { data: settings, isLoading: settingsLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const dailyCount = settings?.dailyDialogsCount || 12;

  const autoGenerateMutation = useMutation({
    mutationFn: async (data: { date: string; prompt?: string }) => {
      const response = await apiRequest("POST", "/api/auto-generate-day", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      setDialogOpen(false);
      setAutoGenPrompt("");
      toast({
        title: "Подводки созданы",
        description: `Создано ${data.count} подводок на день`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось создать подводки",
        variant: "destructive",
      });
    },
  });

  const handleAutoGenerate = (date: Date) => {
    setSelectedDate(date);
    setAutoGenPrompt(settings?.defaultPrompt || "");
    setDialogOpen(true);
  };

  const submitAutoGenerate = () => {
    if (!selectedDate) return;
    autoGenerateMutation.mutate({
      date: selectedDate.toISOString().split("T")[0],
      prompt: autoGenPrompt || undefined,
    });
  };

  const getWeekDays = () => {
    const days = [];
    const startOfWeek = new Date(currentDate);
    const dayOfWeek = startOfWeek.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOfWeek.setDate(startOfWeek.getDate() + diff);

    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const weekDays = getWeekDays();

  const getDialogsForDate = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return dialogs?.filter(d => d.scheduledDate === dateStr) || [];
  };

  const navigateWeek = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + direction * 7);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const formatMonthYear = () => {
    return currentDate.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Расписание</h1>
          <p className="text-muted-foreground">Подводки по дням недели</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigateWeek(-1)} data-testid="button-prev-week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={goToToday} data-testid="button-today">
            <CalendarIcon className="mr-2 h-4 w-4" />
            Сегодня
          </Button>
          <Button variant="outline" size="icon" onClick={() => navigateWeek(1)} data-testid="button-next-week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="capitalize">{formatMonthYear()}</CardTitle>
          <CardDescription>{dailyCount} подводок в день</CardDescription>
        </CardHeader>
        <CardContent>
          {dialogsLoading || settingsLoading ? (
            <div className="grid grid-cols-7 gap-4">
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-64" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((day, dayIndex) => {
                const dayDialogs = getDialogsForDate(day);
                const readyCount = dayDialogs.filter(d => d.status === "ready").length;
                const isCurrentDay = isToday(day);

                return (
                  <div
                    key={day.toISOString()}
                    className={`rounded-lg border p-3 cursor-pointer transition-colors hover-elevate ${
                      isCurrentDay ? "border-primary bg-primary/5" : ""
                    } ${viewingDate === day.toISOString().split("T")[0] ? "ring-2 ring-primary" : ""}`}
                    data-testid={`day-${day.toISOString().split("T")[0]}`}
                    onClick={() => setViewingDate(day.toISOString().split("T")[0])}
                  >
                    <div className="mb-3 text-center">
                      <div className="text-xs font-medium text-muted-foreground">{dayNames[dayIndex]}</div>
                      <div className={`text-lg font-bold ${isCurrentDay ? "text-primary" : ""}`}>
                        {day.getDate()}
                      </div>
                      {dayDialogs.length > 0 && (
                        <Badge variant={readyCount === dailyCount ? "default" : "secondary"} className="mt-1">
                          {dayDialogs.length}/{dailyCount}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1">
                      {Array.from({ length: Math.min(dailyCount, 6) }, (_, slotIndex) => {
                        const slotDialog = dayDialogs.find(d => d.slotNumber === slotIndex + 1);
                        const statusInfo = slotDialog ? getStatusInfo(slotDialog.status) : getStatusInfo("pending");
                        const StatusIcon = statusInfo.icon;

                        return (
                          <div
                            key={slotIndex}
                            className={`flex items-center justify-center rounded border-2 p-1 text-xs ${statusInfo.bg}`}
                            title={slotDialog?.title || `Слот #${slotIndex + 1}`}
                          >
                            <StatusIcon className={`h-3 w-3 ${statusInfo.color}`} />
                          </div>
                        );
                      })}
                      {dailyCount > 6 && (
                        <div className="text-center text-xs text-muted-foreground">
                          +{dailyCount - 6} слотов
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewingDate(day.toISOString().split("T")[0]);
                        }}
                        data-testid={`button-view-${day.toISOString().split("T")[0]}`}
                      >
                        <FileText className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAutoGenerate(day);
                        }}
                        disabled={autoGenerateMutation.isPending}
                        data-testid={`button-autogen-${day.toISOString().split("T")[0]}`}
                      >
                        <Sparkles className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>
              {viewingDate 
                ? `Детали ${new Date(viewingDate).toLocaleDateString("ru-RU", { weekday: "long" })}`
                : "Детали дня"
              }
            </CardTitle>
            <CardDescription>
              {viewingDate 
                ? new Date(viewingDate).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })
                : "Выберите день в календаре выше"
              }
            </CardDescription>
          </div>
          {!viewingDate && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewingDate(new Date().toISOString().split("T")[0])}
              data-testid="button-select-today"
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              Сегодня
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!viewingDate ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Нажмите на день в календаре для просмотра слотов</p>
            </div>
          ) : dialogsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: dailyCount }, (_, i) => {
                const selectedDialogs = dialogs?.filter(d => d.scheduledDate === viewingDate) || [];
                const slotDialog = selectedDialogs.find(d => d.slotNumber === i + 1);
                const statusInfo = slotDialog ? getStatusInfo(slotDialog.status) : getStatusInfo("pending");
                const StatusIcon = statusInfo.icon;

                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-lg border-2 p-3 ${statusInfo.bg}`}
                    data-testid={`slot-${i + 1}`}
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${slotDialog?.status === "ready" ? "bg-green-500" : "bg-muted"}`}>
                      {slotDialog?.status === "ready" ? (
                        <Mic className="h-4 w-4 text-white" />
                      ) : (
                        <span className="text-sm font-medium">#{i + 1}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {slotDialog?.title || `Слот #${i + 1}`}
                      </p>
                      <p className={`text-xs ${statusInfo.color}`}>
                        {statusInfo.label}
                      </p>
                    </div>
                    {slotDialog?.audioUrl && (
                      <Button 
                        size="icon" 
                        variant="ghost"
                        onClick={() => playAudio(slotDialog.audioUrl!, slotDialog.id)}
                        data-testid={`button-play-dialog-${slotDialog.id}`}
                      >
                        {playingDialogId === slotDialog.id ? (
                          <PauseCircle className="h-4 w-4" />
                        ) : (
                          <PlayCircle className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Тексты диалогов
            </CardTitle>
            <CardDescription>
              {viewingDate 
                ? new Date(viewingDate).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })
                : "Выберите день для просмотра текстов"
              }
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={viewingDate === new Date().toISOString().split("T")[0] ? "default" : "outline"}
              size="sm"
              onClick={() => setViewingDate(new Date().toISOString().split("T")[0])}
              data-testid="button-view-today"
            >
              Сегодня
            </Button>
            {viewingDate && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewingDate(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {viewingDate ? (
            <ScrollArea className="h-[500px]">
              {(() => {
                const dayDialogs = dialogs?.filter(d => d.scheduledDate === viewingDate) || [];
                const sortedDialogs = [...dayDialogs].sort((a, b) => (a.slotNumber || 0) - (b.slotNumber || 0));
                
                if (sortedDialogs.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">Нет диалогов на этот день</p>
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={() => {
                          setSelectedDate(new Date(viewingDate));
                          setDialogOpen(true);
                        }}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Сгенерировать
                      </Button>
                    </div>
                  );
                }
                
                return (
                  <div className="space-y-6">
                    {sortedDialogs.map((dialog, index) => (
                      <div key={dialog.id} className="space-y-3 pb-6 border-b last:border-b-0">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">#{dialog.slotNumber || index + 1}</Badge>
                            <span className="font-medium">{dialog.title}</span>
                          </div>
                          {dialog.audioUrl && (
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => playAudio(dialog.audioUrl!, dialog.id)}
                            >
                              {playingDialogId === dialog.id ? (
                                <PauseCircle className="h-4 w-4" />
                              ) : (
                                <PlayCircle className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                        
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
                      </div>
                    ))}
                  </div>
                );
              })()}
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Нажмите "Сегодня" или выберите день в календаре выше</p>
            </div>
          )}
        </CardContent>
      </Card>

      <DialogUI open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Авто-генерация подводок
            </DialogTitle>
            <DialogDescription>
              {selectedDate && (
                <>
                  Создать {dailyCount} подводок на {selectedDate.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="auto-prompt">Промпт для генерации</Label>
              <div className="flex gap-1 items-start">
                <Textarea
                  id="auto-prompt"
                  placeholder="Опишите темы и стиль подводок..."
                  value={autoGenPrompt}
                  onChange={(e) => setAutoGenPrompt(e.target.value)}
                  rows={6}
                  data-testid="textarea-auto-prompt"
                  className="flex-1"
                />
                <VoiceInput onTranscript={(text) => setAutoGenPrompt(prev => prev + " " + text)} />
              </div>
              <p className="text-xs text-muted-foreground">
                ИИ создаст разнообразные подводки на основе этого промпта
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={submitAutoGenerate}
              disabled={autoGenerateMutation.isPending}
              data-testid="button-submit-autogen"
            >
              {autoGenerateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Генерация...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Создать подводки
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogUI>
    </div>
  );
}
