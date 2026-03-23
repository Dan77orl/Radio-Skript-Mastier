import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInput } from "@/components/voice-input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  CloudSun, 
  Newspaper, 
  Sparkles, 
  FileText, 
  Radio,
  Loader2,
  Volume2,
  Settings,
  Zap,
  MapPin,
  Brain,
  Clock,
  Calendar,
  Megaphone,
  Link,
  PackagePlus,
  CheckCircle2,
  XCircle,
  Eye,
  Users,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { ProgramType, Program, Settings as AppSettings, Voice } from "@shared/schema";

const getDefaultProgramTypes = (stationName: string) => [
  {
    name: "Новости",
    slug: "news",
    description: "Новостной выпуск",
    icon: "newspaper",
    dailyCount: 4,
    slotDescriptions: [
      "Утренний выпуск: главные новости дня, что произошло за ночь",
      "Дневной выпуск: актуальные события первой половины дня",
      "Вечерний выпуск: итоги дня, важные события",
      "Ночной выпуск: краткий обзор дня, что ожидать завтра",
    ],
    defaultPrompt: `Создай краткий новостной выпуск для радио "${stationName}".
Тематика: местные новости Аланьи и Турции, интересные мировые события
Стиль: информативный, но не сухой, дайджест-формат
Длительность: 30-40 секунд при чтении
Включи: 3-4 новости коротко, четко, интересно`,
  },
  {
    name: "Дайджест",
    slug: "digest",
    description: "Обзор интересных событий",
    icon: "file-text",
    dailyCount: 2,
    slotDescriptions: [
      "Утренний дайджест: интересные факты и события на сегодня",
      "Вечерний дайджест: что интересного произошло, полезные советы",
    ],
    defaultPrompt: `Создай дайджест интересных событий для радио "${stationName}".
Тематика: события в Аланье, полезные советы для экспатов
Стиль: информативный и дружелюбный, коротко и ёмко
Длительность: 30-40 секунд при чтении`,
  },
  {
    name: "Новости ИИ",
    slug: "ai-news",
    description: "Новости искусственного интеллекта",
    icon: "brain",
    dailyCount: 2,
    slotDescriptions: [
      "Утренний выпуск: главные новости мира ИИ и технологий",
      "Вечерний выпуск: интересные разработки и тренды ИИ",
    ],
    defaultPrompt: `Создай краткий выпуск новостей искусственного интеллекта для радио "${stationName}".
Тематика: новые модели ИИ, интересные применения, тренды технологий
Стиль: доступный, без сложных терминов, с примерами из жизни
Длительность: 25-35 секунд при чтении
Формат: дайджест, коротко, четко, прикольно`,
  },
  {
    name: "Светские новости",
    slug: "celebrity",
    description: "Новости шоу-бизнеса",
    icon: "sparkles",
    dailyCount: 6,
    slotDescriptions: [
      "Утро #1: свежие новости шоу-бизнеса",
      "Утро #2: интересные факты о звёздах",
      "День #1: скандалы и сенсации",
      "День #2: новости кино и музыки",
      "Вечер #1: светская хроника дня",
      "Вечер #2: забавные истории из жизни знаменитостей",
    ],
    defaultPrompt: `Создай выпуск светских новостей для радио "${stationName}".
Тематика: интересные события из мира звёзд, забавные факты
Стиль: лёгкий, с юмором, дайджест-формат
Длительность: 20-30 секунд при чтении
Формат: коротко, ярко, запоминающеся`,
  },
  {
    name: "Прогноз погоды",
    slug: "weather",
    description: "Прогноз погоды для Аланьи",
    icon: "cloud-sun",
    dailyCount: 2,
    slotDescriptions: [
      "Утренний прогноз: какая погода сегодня днём, вечером, совет слушателям",
      "Вечерний прогноз: какая погода ночью и завтра, прогноз на завтра",
    ],
    defaultPrompt: `Создай краткий прогноз погоды для радио "${stationName}".
Город: Аланья, Турция
Стиль: дружелюбный, неформальный
Длительность: 20-30 секунд при чтении
Включи: текущую погоду, прогноз, совет слушателям`,
  },
  {
    name: "Куда сходить в Аланье",
    slug: "alanya-guide",
    description: "Рекомендации мест и развлечений",
    icon: "map-pin",
    dailyCount: 1,
    slotDescriptions: [
      "Рекомендация дня: интересное место, ресторан или мероприятие в Аланье",
    ],
    defaultPrompt: `Создай рекомендацию для рубрики "Куда сходить в Аланье" для радио "${stationName}".
Тематика: интересные места, рестораны, кафе, мероприятия, пляжи, экскурсии
Стиль: дружелюбный, как совет от друга-экспата
Длительность: 25-35 секунд при чтении
Включи: название места, почему стоит посетить, практические советы (время, цены, как добраться)`,
  },
];

const iconMap: Record<string, typeof Radio> = {
  "cloud-sun": CloudSun,
  "newspaper": Newspaper,
  "sparkles": Sparkles,
  "file-text": FileText,
  "radio": Radio,
  "brain": Brain,
  "map-pin": MapPin,
  "zap": Zap,
  "megaphone": Megaphone,
};

export default function ShowsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isAddTypeDialogOpen, setIsAddTypeDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isEditPromptDialogOpen, setIsEditPromptDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<ProgramType | null>(null);
  const [settingsType, setSettingsType] = useState<ProgramType | null>(null);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeSlug, setNewTypeSlug] = useState("");
  const [newTypeDescription, setNewTypeDescription] = useState("");
  const [newTypePrompt, setNewTypePrompt] = useState("");
  const [newTypeDailyCount, setNewTypeDailyCount] = useState(1);
  const [playingProgramId, setPlayingProgramId] = useState<string | null>(null);
  const [slotInputs, setSlotInputs] = useState<string[]>([]);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [batchUrl, setBatchUrl] = useState("");
  const [batchText, setBatchText] = useState("");
  const [batchMode, setBatchMode] = useState<"url" | "text">("text");
  const [batchCount, setBatchCount] = useState(10);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchResult, setBatchResult] = useState<{ created: number; total: number; errors: string[] } | null>(null);
  const [viewScriptProgram, setViewScriptProgram] = useState<Program | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: appSettings } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: voices } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const stationName = appSettings?.stationName || "Радио";
  const defaultProgramTypes = getDefaultProgramTypes(stationName);

  const { data: programTypes, isLoading: isLoadingTypes } = useQuery<ProgramType[]>({
    queryKey: ["/api/program-types"],
  });

  const { data: programs, isLoading: isLoadingPrograms } = useQuery<Program[]>({
    queryKey: ["/api/programs", activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/programs?typeId=${activeTab}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!activeTab,
  });

  const filteredPrograms = programs?.filter(p => p.programTypeId === activeTab) || [];
  const today = new Date().toISOString().split("T")[0];
  const todayPrograms = filteredPrograms.filter(p => p.scheduledDate === today);

  const createTypeMutation = useMutation({
    mutationFn: async (data: { name: string; slug: string; description: string; defaultPrompt: string; dailyCount?: number; slotDescriptions?: string[] }) => {
      const response = await apiRequest("POST", "/api/program-types", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
      setIsAddTypeDialogOpen(false);
      resetNewTypeForm();
      toast({ title: "Тип передачи создан" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const updateTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ProgramType> }) => {
      const response = await apiRequest("PATCH", `/api/program-types/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
      setIsEditPromptDialogOpen(false);
      setIsSettingsDialogOpen(false);
      setEditingType(null);
      setSettingsType(null);
      toast({ title: "Настройки обновлены" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const autoCreateMutation = useMutation({
    mutationFn: async (typeId: string) => {
      const response = await apiRequest("POST", `/api/programs/auto-create/${typeId}`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: "Передача создана", description: data.title });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const generateAudioMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/programs/${id}/generate-audio`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: "Аудио сгенерировано" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const generateScriptMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/programs/${id}/generate`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: "Скрипт сгенерирован" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const deleteProgramMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/programs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: "Передача удалена" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const deleteTypeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/program-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
      setActiveTab(null);
      toast({ title: "Тип передачи удалён" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!activeTab && programTypes && programTypes.length > 0) {
      setActiveTab(programTypes[0].id);
    }
  }, [activeTab, programTypes]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const resetNewTypeForm = () => {
    setNewTypeName("");
    setNewTypeSlug("");
    setNewTypeDescription("");
    setNewTypePrompt("");
    setNewTypeDailyCount(1);
  };

  const seedDefaultTypes = async () => {
    for (const type of defaultProgramTypes) {
      await createTypeMutation.mutateAsync(type);
    }
  };

  const playAudio = (audioUrl: string, programId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (playingProgramId === programId) {
      setPlayingProgramId(null);
      return;
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play();
    setPlayingProgramId(programId);
    audio.onended = () => setPlayingProgramId(null);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
      pending: { label: "Ожидает", variant: "outline" },
      script_ready: { label: "Скрипт готов", variant: "secondary" },
      ready: { label: "Готово", variant: "default" },
      error: { label: "Ошибка", variant: "destructive" },
    };
    const config = variants[status] || variants.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const speakerColors = [
    "text-violet-600 dark:text-violet-400",
    "text-emerald-600 dark:text-emerald-400",
    "text-blue-600 dark:text-blue-400",
    "text-orange-600 dark:text-orange-400",
    "text-pink-600 dark:text-pink-400",
  ];

  const emotionTagPattern = /\[(energetic|fast|slow|surprised|thoughtful|happy|sad|exclaims|announcer|serious|calm|excited|warm|dramatic|whisper|loud|gentle|playful|confident|nervous|angry|romantic|mysterious|urgent|casual|formal|ironic|sarcastic)\]/gi;

  const renderTextWithEmotionTags = (text: string) => {
    const parts: Array<{ type: "text" | "tag"; value: string }> = [];
    let lastIdx = 0;
    let m;
    const regex = new RegExp(emotionTagPattern.source, "gi");
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIdx) {
        parts.push({ type: "text", value: text.slice(lastIdx, m.index) });
      }
      parts.push({ type: "tag", value: m[0] });
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < text.length) {
      parts.push({ type: "text", value: text.slice(lastIdx) });
    }
    return parts.map((p, j) =>
      p.type === "tag" ? (
        <span key={j} className="inline-block px-1 rounded text-xs bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 mx-0.5">{p.value}</span>
      ) : (
        <span key={j}>{p.value}</span>
      )
    );
  };

  const renderMultiSpeakerScript = (scriptText: string) => {
    const lines = scriptText.split("\n");
    const speakerMap = new Map<string, number>();
    let speakerIdx = 0;

    return lines.map((line, i) => {
      const match = line.match(/^\s*\[([^\]]+)\]:\s*(.*)/);
      if (match) {
        const speaker = match[1];
        const content = match[2];
        if (!speakerMap.has(speaker)) {
          speakerMap.set(speaker, speakerIdx++);
        }
        const colorIdx = speakerMap.get(speaker)! % speakerColors.length;
        return (
          <div key={i} className="py-1.5 border-b border-border/30 last:border-0">
            <span className={`font-semibold ${speakerColors[colorIdx]}`}>[{speaker}]:</span>{" "}
            {renderTextWithEmotionTags(content)}
          </div>
        );
      }
      if (line.trim()) {
        return <div key={i} className="py-0.5 text-muted-foreground">{line}</div>;
      }
      return null;
    });
  };

  const isMultiSpeaker = (text: string) => {
    const matches = text.match(/^\[([^\]]+)\]:/gm);
    return !!matches && matches.length >= 2;
  };

  const openSettingsDialog = (type: ProgramType) => {
    setSettingsType({ ...type });
    setSlotInputs(type.slotDescriptions || []);
    setIsSettingsDialogOpen(true);
  };

  const saveSettings = () => {
    if (!settingsType) return;
    const voiceIdsFromAssignment = voices
      ?.filter(v => v.isActive && v.assignedProgramTypeIds?.includes(settingsType.id))
      .map(v => v.id) || [];
    updateTypeMutation.mutate({
      id: settingsType.id,
      data: {
        dailyCount: settingsType.dailyCount,
        slotDescriptions: slotInputs.filter(s => s.trim()),
        sponsorName: settingsType.sponsorName,
        sponsorText: settingsType.sponsorText,
        assignedVoiceIds: voiceIdsFromAssignment,
        defaultDurationSeconds: settingsType.defaultDurationSeconds,
      },
    });
  };

  const startBatchGeneration = async () => {
    if (!activeTab) return;
    setBatchGenerating(true);
    setBatchResult(null);
    try {
      let referenceContent = "";
      let referenceUrl = "";

      if (batchMode === "url" && batchUrl.trim()) {
        const urlResponse = await apiRequest("POST", "/api/fetch-url-content", { url: batchUrl.trim() });
        const urlData = await urlResponse.json();
        referenceContent = urlData.text;
        referenceUrl = batchUrl.trim();
        toast({ title: "Контент загружен", description: `${Math.round(urlData.length / 1000)}K символов` });
      } else if (batchMode === "text" && batchText.trim()) {
        referenceContent = batchText.trim();
      }

      if (!referenceContent) {
        toast({ title: "Нет контента", description: "Вставьте текст или укажите ссылку", variant: "destructive" });
        setBatchGenerating(false);
        return;
      }

      const response = await apiRequest("POST", `/api/programs/batch-create/${activeTab}`, {
        count: batchCount,
        referenceContent,
        referenceUrl: referenceUrl || null,
      });
      const data = await response.json();
      setBatchResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ 
        title: "Готово!", 
        description: `Создано ${data.created} из ${data.total} передач`,
      });
    } catch (error) {
      toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Ошибка генерации", variant: "destructive" });
    } finally {
      setBatchGenerating(false);
    }
  };

  const resetBatchDialog = () => {
    setBatchUrl("");
    setBatchText("");
    setBatchMode("text");
    setBatchCount(10);
    setBatchResult(null);
    setBatchGenerating(false);
  };

  if (isLoadingTypes) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const hasTypes = programTypes && programTypes.length > 0;

  if (!hasTypes) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader className="text-center">
            <Radio className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <CardTitle>Нет типов передач</CardTitle>
            <CardDescription>
              Создайте типы передач для генерации контента
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <Button onClick={seedDefaultTypes} disabled={createTypeMutation.isPending} data-testid="button-seed-types">
              {createTypeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Создание...
                </>
              ) : (
                "Создать стандартные типы"
              )}
            </Button>
            <span className="text-sm text-muted-foreground">или</span>
            <Button variant="outline" onClick={() => setIsAddTypeDialogOpen(true)} data-testid="button-create-custom-type">
              <Plus className="mr-2 h-4 w-4" />
              Создать свой тип
            </Button>
          </CardContent>
        </Card>
        {renderAddTypeDialog()}
      </div>
    );
  }

  const currentType = programTypes?.find(t => t.id === activeTab);
  const IconComponent = currentType?.icon ? iconMap[currentType.icon] || Radio : Radio;
  const dailyCount = currentType?.dailyCount || 1;
  const todayCreated = todayPrograms.length;
  const canCreateMore = todayCreated < dailyCount;

  function renderAddTypeDialog() {
    return (
      <Dialog open={isAddTypeDialogOpen} onOpenChange={setIsAddTypeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Новый тип передачи</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Название</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="Например: Прогноз погоды"
                  value={newTypeName}
                  onChange={(e) => {
                    setNewTypeName(e.target.value);
                    if (!newTypeSlug) {
                      setNewTypeSlug(e.target.value.toLowerCase().replace(/[^a-zа-я0-9]/g, "-").replace(/-+/g, "-"));
                    }
                  }}
                  className="flex-1"
                />
                <VoiceInput onTranscript={(text) => setNewTypeName(prev => prev + text)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Slug (для URL)</Label>
              <Input
                placeholder="weather"
                value={newTypeSlug}
                onChange={(e) => setNewTypeSlug(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Описание</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="Краткое описание"
                  value={newTypeDescription}
                  onChange={(e) => setNewTypeDescription(e.target.value)}
                  className="flex-1"
                />
                <VoiceInput onTranscript={(text) => setNewTypeDescription(prev => prev + text)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Выпусков в день</Label>
              <Select value={String(newTypeDailyCount)} onValueChange={(v) => setNewTypeDailyCount(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Промпт по умолчанию</Label>
              <div className="flex gap-1 items-start">
                <Textarea
                  placeholder="Промпт для генерации..."
                  value={newTypePrompt}
                  onChange={(e) => setNewTypePrompt(e.target.value)}
                  rows={5}
                  className="flex-1"
                />
                <VoiceInput onTranscript={(text) => setNewTypePrompt(prev => prev + " " + text)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddTypeDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => createTypeMutation.mutate({
                name: newTypeName,
                slug: newTypeSlug,
                description: newTypeDescription,
                defaultPrompt: newTypePrompt,
                dailyCount: newTypeDailyCount,
              })}
              disabled={!newTypeName || !newTypeSlug || !newTypePrompt || createTypeMutation.isPending}
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Передачи</h1>
          <p className="text-muted-foreground">Генерация контента для радиопередач</p>
        </div>
      </div>

      <Tabs value={activeTab || ""} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList className="flex-wrap">
            {programTypes?.map((type) => {
              const Icon = type.icon ? iconMap[type.icon] || Radio : Radio;
              return (
                <TabsTrigger key={type.id} value={type.id} className="gap-2" data-testid={`tab-${type.slug}`}>
                  <Icon className="h-4 w-4" />
                  {type.name}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <Button variant="outline" size="sm" onClick={() => setIsAddTypeDialogOpen(true)} data-testid="button-add-type">
            <Plus className="mr-2 h-4 w-4" />
            Новый тип
          </Button>
        </div>

        {programTypes?.map((type) => {
          const Icon = type.icon ? iconMap[type.icon] || Radio : Radio;
          const typeDaily = type.dailyCount || 1;
          const typeTodayPrograms = (programs?.filter(p => p.programTypeId === type.id && p.scheduledDate === today) || []);
          const typeTodayCount = typeTodayPrograms.length;
          const typeCanCreate = typeTodayCount < typeDaily;
          const currentSlotDesc = type.slotDescriptions?.[typeTodayCount] || "";

          return (
            <TabsContent key={type.id} value={type.id} className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      <Icon className="h-5 w-5" />
                      {type.name}
                    </CardTitle>
                    <CardDescription>{type.description}</CardDescription>
                    <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {typeTodayCount}/{typeDaily} на сегодня
                      </span>
                      {type.sponsorName && (
                        <span className="flex items-center gap-1">
                          <Megaphone className="h-3.5 w-3.5" />
                          Спонсор: {type.sponsorName}
                        </span>
                      )}
                      {currentSlotDesc && typeCanCreate && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          След.: {currentSlotDesc.length > 50 ? currentSlotDesc.substring(0, 50) + "..." : currentSlotDesc}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingType(type);
                        setIsEditPromptDialogOpen(true);
                      }}
                      data-testid="button-edit-prompt"
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Промпт
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openSettingsDialog(type)}
                      data-testid="button-type-settings"
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Настройки
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => autoCreateMutation.mutate(type.id)}
                      disabled={autoCreateMutation.isPending || !typeCanCreate}
                      data-testid="button-auto-create"
                    >
                      {autoCreateMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="mr-2 h-4 w-4" />
                      )}
                      {typeCanCreate 
                        ? `Создать #${typeTodayCount + 1}`
                        : "Все на сегодня готовы"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        resetBatchDialog();
                        setIsBatchDialogOpen(true);
                      }}
                      data-testid="button-batch-create"
                    >
                      <PackagePlus className="mr-2 h-4 w-4" />
                      Пакетная
                    </Button>
                  </div>
                </CardHeader>
              </Card>

              {isLoadingPrograms ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : filteredPrograms.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Volume2 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">Нет передач этого типа</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Нажмите "Создать" для автоматической генерации
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {filteredPrograms.map((program) => (
                    <Card key={program.id}>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-medium truncate" data-testid={`text-program-title-${program.id}`}>{program.title}</h3>
                              {getStatusBadge(program.status)}
                              {program.slotNumber && (
                                <Badge variant="outline" className="text-xs">
                                  #{program.slotNumber}
                                </Badge>
                              )}
                            </div>
                            {program.scriptText && (
                              <div className="mt-1">
                                {isMultiSpeaker(program.scriptText) ? (
                                  <div className="flex items-center gap-1.5">
                                    <Users className="h-3.5 w-3.5 text-violet-500" />
                                    <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">Мульти-спикер</span>
                                    <span className="text-xs text-muted-foreground">•</span>
                                    <span className="text-xs text-muted-foreground truncate max-w-xs">
                                      {program.scriptText.match(/^\[([^\]]+)\]:/gm)?.map(m => m.replace(/[\[\]:]/g, "")).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
                                    </span>
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {program.scriptText.substring(0, 200)}...
                                  </p>
                                )}
                              </div>
                            )}
                            {program.scheduledDate && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {program.scheduledDate}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {program.status === "pending" && (
                              <Button
                                size="sm"
                                onClick={() => generateScriptMutation.mutate(program.id)}
                                disabled={generateScriptMutation.isPending}
                                data-testid={`button-generate-script-${program.id}`}
                              >
                                {generateScriptMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Сгенерировать скрипт"
                                )}
                              </Button>
                            )}
                            {program.scriptText && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setViewScriptProgram(program)}
                                data-testid={`button-view-script-${program.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                            {program.status === "script_ready" && (
                              <Button
                                size="sm"
                                onClick={() => generateAudioMutation.mutate(program.id)}
                                disabled={generateAudioMutation.isPending}
                                data-testid={`button-generate-audio-${program.id}`}
                              >
                                {generateAudioMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Озвучить"
                                )}
                              </Button>
                            )}
                            {program.audioUrl && (
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={() => playAudio(program.audioUrl!, program.id)}
                                data-testid={`button-play-${program.id}`}
                              >
                                {playingProgramId === program.id ? (
                                  <Pause className="h-4 w-4" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" data-testid={`button-delete-${program.id}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Удалить передачу?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Это действие нельзя отменить.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteProgramMutation.mutate(program.id)}
                                  >
                                    Удалить
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {renderAddTypeDialog()}

      <Dialog open={isEditPromptDialogOpen} onOpenChange={setIsEditPromptDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Редактировать промпт: {editingType?.name}</DialogTitle>
            <DialogDescription>
              Этот промпт используется для генерации всех выпусков этого типа
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex gap-1 items-start">
              <Textarea
                value={editingType?.defaultPrompt || ""}
                onChange={(e) => setEditingType(prev => prev ? { ...prev, defaultPrompt: e.target.value } : null)}
                rows={12}
                className="font-mono text-sm flex-1"
              />
              <VoiceInput onTranscript={(text) => setEditingType(prev => prev ? { ...prev, defaultPrompt: prev.defaultPrompt + " " + text } : null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditPromptDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => editingType && updateTypeMutation.mutate({
                id: editingType.id,
                data: { defaultPrompt: editingType.defaultPrompt },
              })}
              disabled={updateTypeMutation.isPending}
            >
              {updateTypeMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Настройки: {settingsType?.name}</DialogTitle>
            <DialogDescription>
              Расписание, спонсоры, голоса и другие параметры
            </DialogDescription>
          </DialogHeader>
          {settingsType && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Выпусков в день</Label>
                  <Select
                    value={String(settingsType.dailyCount || 1)}
                    onValueChange={(v) => {
                      const count = Number(v);
                      setSettingsType(prev => prev ? { ...prev, dailyCount: count } : null);
                      setSlotInputs(prev => {
                        const arr = [...prev];
                        while (arr.length < count) arr.push("");
                        return arr.slice(0, count);
                      });
                    }}
                  >
                    <SelectTrigger data-testid="select-daily-count">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Длительность (сек)</Label>
                  <Input
                    type="number"
                    value={settingsType.defaultDurationSeconds || 60}
                    onChange={(e) => setSettingsType(prev => prev ? { ...prev, defaultDurationSeconds: Number(e.target.value) } : null)}
                    data-testid="input-duration"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label>Описание слотов (что генерировать для каждого выпуска)</Label>
                {Array.from({ length: settingsType.dailyCount || 1 }, (_, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Badge variant="outline" className="mt-2 shrink-0">#{i + 1}</Badge>
                    <div className="flex gap-1 flex-1">
                      <Input
                        placeholder={`Описание выпуска #${i + 1}...`}
                        value={slotInputs[i] || ""}
                        onChange={(e) => {
                          const arr = [...slotInputs];
                          arr[i] = e.target.value;
                          setSlotInputs(arr);
                        }}
                        className="flex-1"
                        data-testid={`input-slot-${i}`}
                      />
                      <VoiceInput onTranscript={(text) => {
                        setSlotInputs(prev => {
                          const arr = [...prev];
                          arr[i] = (arr[i] || "") + text;
                          return arr;
                        });
                      }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <Label>Спонсор</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Название спонсора</span>
                    <Input
                      placeholder="Компания или бренд"
                      value={settingsType.sponsorName || ""}
                      onChange={(e) => setSettingsType(prev => prev ? { ...prev, sponsorName: e.target.value } : null)}
                      data-testid="input-sponsor-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Текст спонсора</span>
                    <Input
                      placeholder="Спонсор прогноза погоды..."
                      value={settingsType.sponsorText || ""}
                      onChange={(e) => setSettingsType(prev => prev ? { ...prev, sponsorText: e.target.value } : null)}
                      data-testid="input-sponsor-text"
                    />
                  </div>
                </div>
              </div>

              {voices && voices.length > 0 && (() => {
                const assignedVoices = voices.filter(v => v.isActive && v.assignedProgramTypeIds?.includes(settingsType.id));
                return assignedVoices.length > 0 ? (
                  <div className="space-y-2">
                    <Label>Назначенные голоса</Label>
                    <div className="flex flex-wrap gap-2">
                      {assignedVoices.map(voice => (
                        <Badge key={voice.id} variant="secondary" className="text-sm py-1 px-3" data-testid={`badge-voice-${voice.id}`}>
                          {voice.personaName || voice.name}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Назначение голосов — на странице «Голоса»</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Назначенные голоса</Label>
                    <p className="text-sm text-muted-foreground">Нет назначенных голосов. Назначьте на странице «Голоса».</p>
                  </div>
                );
              })()}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="w-full" data-testid="button-delete-type">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Удалить тип передачи
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Удалить "{settingsType.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Это удалит тип передачи и все связанные данные.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                      deleteTypeMutation.mutate(settingsType.id);
                      setIsSettingsDialogOpen(false);
                    }}>
                      Удалить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSettingsDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={saveSettings} disabled={updateTypeMutation.isPending}>
              {updateTypeMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBatchDialogOpen} onOpenChange={(open) => {
        if (!batchGenerating) {
          setIsBatchDialogOpen(open);
          if (!open) resetBatchDialog();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" />
              Пакетная генерация: {currentType?.name}
            </DialogTitle>
            <DialogDescription>
              Скопируйте текст из ChatGPT/Claude или вставьте ссылку на веб-страницу
            </DialogDescription>
          </DialogHeader>

          {batchResult ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                {batchResult.errors.length === 0 ? (
                  <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-8 w-8 text-yellow-500 shrink-0" />
                )}
                <div>
                  <p className="font-medium text-lg">
                    Создано {batchResult.created} из {batchResult.total} передач
                  </p>
                </div>
              </div>
              {batchResult.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">Ошибки:</p>
                  {batchResult.errors.map((err, i) => (
                    <p key={i} className="text-sm text-muted-foreground">{err}</p>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => {
                  setIsBatchDialogOpen(false);
                  resetBatchDialog();
                }}>
                  Закрыть
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-5 py-4">
              <div className="flex gap-1 mb-1">
                <Button
                  variant={batchMode === "text" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setBatchMode("text")}
                  disabled={batchGenerating}
                  data-testid="button-batch-mode-text"
                >
                  Вставить текст
                </Button>
                <Button
                  variant={batchMode === "url" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setBatchMode("url")}
                  disabled={batchGenerating}
                  data-testid="button-batch-mode-url"
                >
                  Ссылка на страницу
                </Button>
              </div>

              {batchMode === "text" ? (
                <div className="space-y-2">
                  <Label>Скопируйте текст из ChatGPT / Claude</Label>
                  <Textarea
                    placeholder="Скопируйте и вставьте сюда текст из чата, где вы генерировали передачи..."
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    rows={8}
                    disabled={batchGenerating}
                    data-testid="input-batch-text"
                  />
                  <p className="text-xs text-muted-foreground">
                    Откройте чат в ChatGPT или Claude, выделите весь текст (Ctrl+A), скопируйте (Ctrl+C) и вставьте сюда
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Link className="h-4 w-4" />
                    Ссылка на веб-страницу
                  </Label>
                  <Input
                    placeholder="https://example.com/article..."
                    value={batchUrl}
                    onChange={(e) => setBatchUrl(e.target.value)}
                    disabled={batchGenerating}
                    data-testid="input-batch-url"
                  />
                  <p className="text-xs text-muted-foreground">
                    Работает с обычными веб-страницами, статьями, блогами. Ссылки ChatGPT/Claude не поддерживаются — используйте вставку текста.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Сколько выпусков создать</Label>
                <Select
                  value={String(batchCount)}
                  onValueChange={(v) => setBatchCount(Number(v))}
                  disabled={batchGenerating}
                >
                  <SelectTrigger data-testid="select-batch-count">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 10, 15, 20, 25, 30, 40, 50].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {batchGenerating && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Генерирую выпуски... Это может занять несколько минут</span>
                  </div>
                  <Progress value={undefined} className="h-2" />
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsBatchDialogOpen(false)} disabled={batchGenerating}>
                  Отмена
                </Button>
                <Button
                  onClick={startBatchGeneration}
                  disabled={batchGenerating || (batchMode === "url" ? !batchUrl.trim() : !batchText.trim())}
                  data-testid="button-start-batch"
                >
                  {batchGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Генерация...
                    </>
                  ) : (
                    <>
                      <PackagePlus className="mr-2 h-4 w-4" />
                      Создать {batchCount} выпусков
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewScriptProgram} onOpenChange={(open) => !open && setViewScriptProgram(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewScriptProgram?.scriptText && isMultiSpeaker(viewScriptProgram.scriptText) && (
                <Users className="h-5 w-5 text-violet-500" />
              )}
              {viewScriptProgram?.title}
            </DialogTitle>
            <DialogDescription>
              {viewScriptProgram?.scheduledDate && `Дата: ${viewScriptProgram.scheduledDate}`}
              {viewScriptProgram?.slotNumber && ` • Слот #${viewScriptProgram.slotNumber}`}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            {viewScriptProgram?.scriptText && isMultiSpeaker(viewScriptProgram.scriptText) ? (
              <div className="space-y-0">{renderMultiSpeakerScript(viewScriptProgram.scriptText)}</div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
                {viewScriptProgram?.scriptText}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
