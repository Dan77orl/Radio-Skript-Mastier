import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInput } from "@/components/voice-input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Sparkles, Loader2, Trash2, Play, Building2, ChevronRight, 
  Check, RefreshCw, Volume2, Music, FileText, Link, Instagram,
  Clock, PauseCircle, PlayCircle, ArrowLeft, Upload, X, File
} from "lucide-react";
import type { Ad, Voice } from "@shared/schema";

interface ExtractedFile {
  filename: string;
  text: string;
}

const adFormSchema = z.object({
  prompt: z.string().min(10, "Описание должно быть не менее 10 символов"),
  clientName: z.string().optional(),
  websiteUrl: z.string().optional(),
  instagramUrl: z.string().optional(),
  targetDurationSeconds: z.number().min(10).max(120).default(30),
  category: z.string().default("general"),
});

type AdFormValues = z.infer<typeof adFormSchema>;

const categories = [
  { value: "general", label: "Общая" },
  { value: "restaurant", label: "Рестораны" },
  { value: "real_estate", label: "Недвижимость" },
  { value: "services", label: "Услуги" },
  { value: "shop", label: "Магазины" },
  { value: "events", label: "Мероприятия" },
];

const stages = [
  { key: "prompt", label: "Описание", icon: FileText },
  { key: "variants", label: "Варианты", icon: Sparkles },
  { key: "voices", label: "Голоса", icon: Volume2 },
  { key: "audio", label: "Аудио", icon: Play },
  { key: "music", label: "С музыкой", icon: Music },
];

export default function AdsPage() {
  const { toast } = useToast();
  const [currentAd, setCurrentAd] = useState<Ad | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { data: ads, isLoading } = useQuery<Ad[]>({
    queryKey: ["/api/ads"],
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasGenerating = data?.some(ad => ad.status === "generating");
      return hasGenerating ? 2000 : false;
    },
  });

  const { data: voices } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const { data: elevenLabsVoices } = useQuery<{ voices: Array<{ voice_id: string; name: string; labels?: { gender?: string } }> }>({
    queryKey: ["/api/elevenlabs/voices"],
  });

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const form = useForm<AdFormValues>({
    resolver: zodResolver(adFormSchema),
    defaultValues: {
      prompt: "",
      clientName: "",
      websiteUrl: "",
      instagramUrl: "",
      targetDurationSeconds: 30,
      category: "general",
    },
  });

  const createAdMutation = useMutation({
    mutationFn: async (data: AdFormValues) => {
      const response = await apiRequest("POST", "/api/ads", {
        title: data.clientName || "Новая реклама",
        ...data,
        status: "draft",
        stage: "prompt",
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      setCurrentAd(data);
      toast({ title: "Реклама создана", description: "Теперь сгенерируйте варианты текста" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const generateVariantsMutation = useMutation({
    mutationFn: async (adId: string) => {
      const response = await apiRequest("POST", `/api/ads/${adId}/generate-variants`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      setCurrentAd(data);
      toast({ title: "Варианты созданы", description: "Выберите лучший вариант" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка генерации", description: error.message, variant: "destructive" });
    },
  });

  const selectVariantMutation = useMutation({
    mutationFn: async ({ adId, variantIndex }: { adId: string; variantIndex: number }) => {
      const response = await apiRequest("POST", `/api/ads/${adId}/select-variant`, { variantIndex });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      setCurrentAd(data);
      toast({ title: "Вариант выбран", description: "Теперь выберите голос" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const regenerateVariantMutation = useMutation({
    mutationFn: async ({ adId, baseText, instructions }: { adId: string; baseText: string; instructions?: string }) => {
      const response = await apiRequest("POST", `/api/ads/${adId}/regenerate-variant`, { baseText, instructions });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      setCurrentAd(data.ad);
      toast({ title: "Новый вариант создан" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const synthesizeAudioMutation = useMutation({
    mutationFn: async ({ adId, voiceIds }: { adId: string; voiceIds: string[] }) => {
      const response = await apiRequest("POST", `/api/ads/${adId}/synthesize-audio`, { voiceIds });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Синтез запущен", description: "Аудио генерируется..." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      }, 3000);
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка синтеза", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      if (currentAd) setCurrentAd(null);
      toast({ title: "Удалено" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (currentAd && ads) {
      const updated = ads.find(a => a.id === currentAd.id);
      if (updated && (updated.stage !== currentAd.stage || updated.status !== currentAd.status || updated.audioUrl !== currentAd.audioUrl)) {
        setCurrentAd(updated);
      }
    }
  }, [ads, currentAd]);

  const onSubmit = (data: AdFormValues) => {
    createAdMutation.mutate(data);
  };

  const playAudio = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (playingAudio) {
      setPlayingAudio(false);
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(console.error);
    setPlayingAudio(true);
    audio.onended = () => setPlayingAudio(false);
  };

  const getCategoryLabel = (value: string) => {
    return categories.find(c => c.value === value)?.label || value;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const file = files[0];
    
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/extract-text", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Не удалось обработать файл");
      }

      const data = await response.json();
      setExtractedFiles(prev => [...prev, { filename: data.filename, text: data.text }]);
      
      const currentPrompt = form.getValues("prompt");
      const separator = currentPrompt ? "\n\n--- Из файла " + data.filename + " ---\n" : "";
      form.setValue("prompt", currentPrompt + separator + data.text);
      
      toast({ 
        title: "Файл обработан", 
        description: `Текст из "${data.filename}" добавлен в описание` 
      });
    } catch (error) {
      toast({ 
        title: "Ошибка", 
        description: error instanceof Error ? error.message : "Не удалось обработать файл",
        variant: "destructive" 
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removeExtractedFile = (index: number) => {
    setExtractedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const insertVoiceText = (currentValue: string, newText: string): string => {
    const fileMarkerPattern = /\n\n--- Из файла /;
    const match = currentValue.match(fileMarkerPattern);
    
    if (match && match.index !== undefined) {
      const beforeFiles = currentValue.substring(0, match.index);
      const filesSection = currentValue.substring(match.index);
      const separator = beforeFiles ? " " : "";
      return beforeFiles + separator + newText + filesSection;
    } else {
      const separator = currentValue ? " " : "";
      return currentValue + separator + newText;
    }
  };

  const getCurrentStageIndex = () => {
    if (!currentAd?.stage) return 0;
    return stages.findIndex(s => s.key === currentAd.stage) || 0;
  };

  const renderStageProgress = () => {
    const currentIndex = getCurrentStageIndex();
    return (
      <div className="flex items-center gap-2 mb-6">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const isActive = index === currentIndex;
          const isCompleted = index < currentIndex;
          return (
            <div key={stage.key} className="flex items-center gap-2">
              <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm ${
                isActive ? "bg-primary text-primary-foreground" :
                isCompleted ? "bg-green-500/20 text-green-600 dark:text-green-400" :
                "bg-muted text-muted-foreground"
              }`}>
                {isCompleted ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                <span className="hidden sm:inline">{stage.label}</span>
              </div>
              {index < stages.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          );
        })}
      </div>
    );
  };

  const renderCurrentStage = () => {
    if (!currentAd) return null;

    switch (currentAd.stage) {
      case "prompt":
        return (
          <Card>
            <CardHeader>
              <CardTitle>Шаг 1: Генерация вариантов</CardTitle>
              <CardDescription>
                На основе вашего описания ИИ создаст 5 разных вариантов текста
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm font-medium mb-2">Ваше описание:</p>
                <p className="text-sm">{currentAd.prompt}</p>
                {currentAd.websiteUrl && (
                  <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
                    <Link className="h-3 w-3" /> {currentAd.websiteUrl}
                  </p>
                )}
                {currentAd.instagramUrl && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Instagram className="h-3 w-3" /> {currentAd.instagramUrl}
                  </p>
                )}
              </div>
              <Button
                onClick={() => generateVariantsMutation.mutate(currentAd.id)}
                disabled={generateVariantsMutation.isPending}
                className="w-full"
                data-testid="button-generate-variants"
              >
                {generateVariantsMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Генерация вариантов...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Сгенерировать 5 вариантов
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        );

      case "variants":
        return (
          <Card>
            <CardHeader>
              <CardTitle>Шаг 2: Выберите вариант</CardTitle>
              <CardDescription>
                Нажмите на лучший вариант или создайте новый на основе выбранного
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-4 pr-4">
                  {currentAd.variants?.map((variant, index) => (
                    <div
                      key={index}
                      className={`rounded-lg border p-4 cursor-pointer transition-colors hover-elevate ${
                        currentAd.selectedVariantIndex === index ? "border-primary bg-primary/5" : ""
                      }`}
                      onClick={() => selectVariantMutation.mutate({ adId: currentAd.id, variantIndex: index })}
                      data-testid={`variant-${index}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Badge variant="outline">Вариант {index + 1}</Badge>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              regenerateVariantMutation.mutate({
                                adId: currentAd.id,
                                baseText: variant,
                              });
                            }}
                            disabled={regenerateVariantMutation.isPending}
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{variant}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        );

      case "voices":
        return (
          <Card>
            <CardHeader>
              <CardTitle>Шаг 3: Выберите голос</CardTitle>
              <CardDescription>
                Рекомендуемое количество ведущих: {currentAd.speakersCount}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4 mb-4">
                <p className="text-sm font-medium mb-2">Выбранный текст:</p>
                <p className="text-sm">{currentAd.selectedVariantText}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {voices?.filter(v => v.isActive).map((voice) => (
                  <div
                    key={voice.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover-elevate ${
                      selectedVoiceId === voice.elevenLabsVoiceId ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() => setSelectedVoiceId(voice.elevenLabsVoiceId)}
                    data-testid={`voice-${voice.id}`}
                  >
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      voice.gender === "male" ? "bg-blue-500/20" : "bg-pink-500/20"
                    }`}>
                      <Volume2 className={`h-5 w-5 ${
                        voice.gender === "male" ? "text-blue-500" : "text-pink-500"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{voice.personaName || voice.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {voice.gender === "male" ? "Мужской" : "Женский"}
                      </p>
                    </div>
                    {selectedVoiceId === voice.elevenLabsVoiceId && (
                      <Check className="h-5 w-5 text-primary" />
                    )}
                  </div>
                ))}
              </div>

              {(!voices || voices.length === 0) && elevenLabsVoices?.voices && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {elevenLabsVoices.voices.slice(0, 8).map((voice) => (
                    <div
                      key={voice.voice_id}
                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover-elevate ${
                        selectedVoiceId === voice.voice_id ? "border-primary bg-primary/5" : ""
                      }`}
                      onClick={() => setSelectedVoiceId(voice.voice_id)}
                    >
                      <div className="h-10 w-10 rounded-full flex items-center justify-center bg-muted">
                        <Volume2 className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{voice.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {voice.labels?.gender || "ElevenLabs"}
                        </p>
                      </div>
                      {selectedVoiceId === voice.voice_id && (
                        <Check className="h-5 w-5 text-primary" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={() => {
                  if (selectedVoiceId) {
                    synthesizeAudioMutation.mutate({
                      adId: currentAd.id,
                      voiceIds: [selectedVoiceId],
                    });
                  }
                }}
                disabled={!selectedVoiceId || synthesizeAudioMutation.isPending}
                className="w-full"
                data-testid="button-synthesize"
              >
                {synthesizeAudioMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Синтез...
                  </>
                ) : (
                  <>
                    <Volume2 className="mr-2 h-4 w-4" />
                    Синтезировать аудио
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        );

      case "audio":
        return (
          <Card>
            <CardHeader>
              <CardTitle>Шаг 4: Прослушайте результат</CardTitle>
              <CardDescription>
                Аудио готово! Можете прослушать или добавить музыку
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-green-500/10 border-green-500 border p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="font-medium">Аудио готово</p>
                      <p className="text-sm text-muted-foreground">
                        {currentAd.duration ? `${currentAd.duration} сек` : ""}
                      </p>
                    </div>
                  </div>
                  {currentAd.audioUrl && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => playAudio(currentAd.audioUrl!)}
                      data-testid="button-play-audio"
                    >
                      {playingAudio ? (
                        <PauseCircle className="h-5 w-5" />
                      ) : (
                        <PlayCircle className="h-5 w-5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm">{currentAd.selectedVariantText}</p>
              </div>

              <Button
                variant="outline"
                className="w-full"
                disabled
                data-testid="button-add-music"
              >
                <Music className="mr-2 h-4 w-4" />
                Добавить музыку (скоро)
              </Button>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Реклама</h1>
          <p className="text-muted-foreground">Создание рекламных роликов с помощью ИИ</p>
        </div>
        {currentAd && (
          <Button variant="outline" onClick={() => setCurrentAd(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            К списку
          </Button>
        )}
      </div>

      {currentAd ? (
        <>
          {renderStageProgress()}
          {currentAd.status === "generating" ? (
            <Card>
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <p className="font-medium">Генерация аудио...</p>
                  <p className="text-sm text-muted-foreground">Это может занять несколько секунд</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/ads"] })}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Обновить статус
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            renderCurrentStage()
          )}
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Создать рекламу
              </CardTitle>
              <CardDescription>Опишите рекламируемый продукт или услугу</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Название клиента</FormLabel>
                        <div className="flex gap-1 items-center">
                          <FormControl>
                            <Input
                              placeholder="Например: Ресторан У Моря"
                              {...field}
                              data-testid="input-client-name"
                              className="flex-1"
                            />
                          </FormControl>
                          <VoiceInput onTranscript={(text) => field.onChange((field.value || "") + text)} />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="websiteUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Сайт</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="https://..."
                                className="pl-9"
                                {...field}
                                data-testid="input-website"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="instagramUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Instagram</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="@username"
                                className="pl-9"
                                {...field}
                                data-testid="input-instagram"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Категория</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-category">
                                <SelectValue placeholder="Выберите категорию" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.map((cat) => (
                                <SelectItem key={cat.value} value={cat.value}>
                                  {cat.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="targetDurationSeconds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Длительность (сек)</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="number"
                                min={10}
                                max={120}
                                className="pl-9"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 30)}
                                data-testid="input-duration"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="prompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Описание рекламы</FormLabel>
                        <div className="flex gap-1 items-start">
                          <FormControl>
                            <Textarea
                              placeholder="Опишите что нужно рекламировать: продукт, услугу, акцию, контактные данные..."
                              rows={5}
                              {...field}
                              data-testid="textarea-ad-prompt"
                              className="flex-1"
                            />
                          </FormControl>
                          <div className="flex flex-col gap-1">
                            <VoiceInput onTranscript={(text) => field.onChange(insertVoiceText(field.value || "", text))} />
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.gif,.webp"
                              onChange={handleFileUpload}
                              className="hidden"
                              data-testid="input-file-upload"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isUploading}
                              title="Загрузить файл (PDF, Word, изображение)"
                            >
                              {isUploading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <FormDescription>
                          ИИ создаст 5 вариантов текста на выбор
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {extractedFiles.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Загруженные файлы:</p>
                      <div className="flex flex-wrap gap-2">
                        {extractedFiles.map((file, index) => (
                          <Badge key={index} variant="secondary" className="gap-1 pr-1">
                            <File className="h-3 w-3" />
                            {file.filename}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-4 w-4 ml-1"
                              onClick={() => removeExtractedFile(index)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createAdMutation.isPending}
                    data-testid="button-create-ad"
                  >
                    {createAdMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Создание...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Создать рекламу
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Все рекламы</CardTitle>
              <CardDescription>Нажмите для продолжения работы</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : ads && ads.length > 0 ? (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3 pr-4">
                    {ads.map((ad) => (
                      <div
                        key={ad.id}
                        className="flex items-center justify-between gap-4 rounded-lg border p-4 cursor-pointer hover-elevate"
                        onClick={() => setCurrentAd(ad)}
                        data-testid={`ad-item-${ad.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium truncate">{ad.title}</h4>
                            <Badge variant="secondary" className="text-xs">
                              {getCategoryLabel(ad.category || "general")}
                            </Badge>
                          </div>
                          {ad.clientName && (
                            <p className="text-sm text-muted-foreground truncate">{ad.clientName}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Этап: {stages.find(s => s.key === ad.stage)?.label || ad.stage}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {ad.status === "ready" ? (
                            <Badge className="bg-green-500">Готов</Badge>
                          ) : ad.status === "generating" ? (
                            <Badge className="bg-yellow-500">Генерация</Badge>
                          ) : (
                            <Badge variant="outline">В работе</Badge>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Удалить рекламу?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Это действие нельзя отменить.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Отмена</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMutation.mutate(ad.id)}>
                                  Удалить
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Пока нет рекламных роликов</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
