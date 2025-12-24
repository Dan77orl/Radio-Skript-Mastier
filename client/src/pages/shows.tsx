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
  Edit
} from "lucide-react";
import type { ProgramType, Program } from "@shared/schema";

const defaultProgramTypes = [
  {
    name: "Прогноз погоды",
    slug: "weather",
    description: "Прогноз погоды для Аланьи",
    icon: "cloud-sun",
    defaultPrompt: `Создай краткий прогноз погоды для радио "Алания FM".
Город: Аланья, Турция
Стиль: дружелюбный, неформальный
Длительность: 20-30 секунд при чтении
Включи: текущую погоду, прогноз на день, совет слушателям`,
  },
  {
    name: "Новости",
    slug: "news",
    description: "Новостной выпуск",
    icon: "newspaper",
    defaultPrompt: `Создай краткий новостной выпуск для радио "Алания FM".
Тематика: местные новости Аланьи и Турции, интересные мировые события
Стиль: информативный, но не сухой
Длительность: 40-60 секунд при чтении
Включи: 3-4 новости с краткими комментариями`,
  },
  {
    name: "Светские новости",
    slug: "celebrity",
    description: "Новости шоу-бизнеса",
    icon: "sparkles",
    defaultPrompt: `Создай выпуск светских новостей для радио "Алания FM".
Тематика: интересные события из мира звезд, забавные факты
Стиль: легкий, с юмором
Длительность: 30-40 секунд при чтении`,
  },
  {
    name: "Дайджест",
    slug: "digest",
    description: "Обзор интересных событий",
    icon: "file-text",
    defaultPrompt: `Создай дайджест интересных событий для радио "Алания FM".
Тематика: события в Аланье, полезные советы для экспатов
Стиль: информативный и дружелюбный
Длительность: 40-50 секунд при чтении`,
  },
];

const iconMap: Record<string, typeof Radio> = {
  "cloud-sun": CloudSun,
  "newspaper": Newspaper,
  "sparkles": Sparkles,
  "file-text": FileText,
  "radio": Radio,
};

export default function ShowsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isAddTypeDialogOpen, setIsAddTypeDialogOpen] = useState(false);
  const [isAddProgramDialogOpen, setIsAddProgramDialogOpen] = useState(false);
  const [isEditPromptDialogOpen, setIsEditPromptDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<ProgramType | null>(null);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeSlug, setNewTypeSlug] = useState("");
  const [newTypeDescription, setNewTypeDescription] = useState("");
  const [newTypePrompt, setNewTypePrompt] = useState("");
  const [newProgramTitle, setNewProgramTitle] = useState("");
  const [newProgramPrompt, setNewProgramPrompt] = useState("");
  const [playingProgramId, setPlayingProgramId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: programTypes, isLoading: isLoadingTypes } = useQuery<ProgramType[]>({
    queryKey: ["/api/program-types"],
  });

  const { data: programs, isLoading: isLoadingPrograms } = useQuery<Program[]>({
    queryKey: ["/api/programs", activeTab],
    enabled: !!activeTab,
  });

  const filteredPrograms = programs?.filter(p => p.programTypeId === activeTab) || [];

  const createTypeMutation = useMutation({
    mutationFn: async (data: { name: string; slug: string; description: string; defaultPrompt: string }) => {
      const response = await apiRequest("POST", "/api/program-types", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
      setIsAddTypeDialogOpen(false);
      setNewTypeName("");
      setNewTypeSlug("");
      setNewTypeDescription("");
      setNewTypePrompt("");
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
      setEditingType(null);
      toast({ title: "Промпт обновлен" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const createProgramMutation = useMutation({
    mutationFn: async (data: { programTypeId: string; title: string; prompt?: string }) => {
      const response = await apiRequest("POST", "/api/programs", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      setIsAddProgramDialogOpen(false);
      setNewProgramTitle("");
      setNewProgramPrompt("");
      toast({ title: "Передача создана" });
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
            <Dialog open={isAddTypeDialogOpen} onOpenChange={setIsAddTypeDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-create-custom-type">
                  <Plus className="mr-2 h-4 w-4" />
                  Создать свой тип
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новый тип передачи</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Название</label>
                    <div className="flex gap-1">
                      <Input
                        placeholder="Например: Прогноз погоды"
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                        className="flex-1"
                      />
                      <VoiceInput onTranscript={(text) => setNewTypeName(prev => prev + text)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Slug (для URL)</label>
                    <Input
                      placeholder="weather"
                      value={newTypeSlug}
                      onChange={(e) => setNewTypeSlug(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Описание</label>
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
                    <label className="text-sm font-medium">Промпт по умолчанию</label>
                    <div className="flex gap-1">
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
                    })}
                    disabled={!newTypeName || !newTypeSlug || !newTypePrompt || createTypeMutation.isPending}
                  >
                    Создать
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentType = programTypes?.find(t => t.id === activeTab);
  const IconComponent = currentType?.icon ? iconMap[currentType.icon] || Radio : Radio;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Передачи</h1>
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
          <div className="flex items-center gap-2 flex-wrap">
            <Dialog open={isAddTypeDialogOpen} onOpenChange={setIsAddTypeDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-add-type">
                  <Plus className="mr-2 h-4 w-4" />
                  Новый тип
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новый тип передачи</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Название</label>
                    <div className="flex gap-1">
                      <Input
                        placeholder="Например: Прогноз погоды"
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                        className="flex-1"
                      />
                      <VoiceInput onTranscript={(text) => setNewTypeName(prev => prev + text)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Slug</label>
                    <Input
                      placeholder="weather"
                      value={newTypeSlug}
                      onChange={(e) => setNewTypeSlug(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Описание</label>
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
                    <label className="text-sm font-medium">Промпт по умолчанию</label>
                    <div className="flex gap-1">
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
                    })}
                    disabled={!newTypeName || !newTypeSlug || !newTypePrompt || createTypeMutation.isPending}
                  >
                    Создать
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {programTypes?.map((type) => (
          <TabsContent key={type.id} value={type.id} className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <IconComponent className="h-5 w-5" />
                    {type.name}
                  </CardTitle>
                  <CardDescription>{type.description}</CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingType(type);
                      setIsEditPromptDialogOpen(true);
                    }}
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Редактировать промпт
                  </Button>
                  <Dialog open={isAddProgramDialogOpen} onOpenChange={setIsAddProgramDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" />
                        Создать передачу
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Новая передача: {type.name}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Название</label>
                          <div className="flex gap-1">
                            <Input
                              placeholder="Название передачи"
                              value={newProgramTitle}
                              onChange={(e) => setNewProgramTitle(e.target.value)}
                              data-testid="input-program-title"
                              className="flex-1"
                            />
                            <VoiceInput onTranscript={(text) => setNewProgramTitle(prev => prev + text)} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Промпт (опционально)</label>
                          <div className="flex gap-1">
                            <Textarea
                              placeholder={`Оставьте пустым для использования промпта по умолчанию`}
                              value={newProgramPrompt}
                              onChange={(e) => setNewProgramPrompt(e.target.value)}
                              rows={4}
                              data-testid="textarea-program-prompt"
                              className="flex-1"
                            />
                            <VoiceInput onTranscript={(text) => setNewProgramPrompt(prev => prev + " " + text)} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Промпт по умолчанию: {type.defaultPrompt.substring(0, 100)}...
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddProgramDialogOpen(false)}>
                          Отмена
                        </Button>
                        <Button
                          onClick={() => createProgramMutation.mutate({
                            programTypeId: type.id,
                            title: newProgramTitle,
                            prompt: newProgramPrompt || undefined,
                          })}
                          disabled={!newProgramTitle || createProgramMutation.isPending}
                          data-testid="button-create-program"
                        >
                          {createProgramMutation.isPending ? "Создание..." : "Создать"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
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
                    Нажмите "Создать передачу" для начала
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
                            <h3 className="font-medium truncate">{program.title}</h3>
                            {getStatusBadge(program.status)}
                          </div>
                          {program.scriptText && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {program.scriptText.substring(0, 150)}...
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
                                "Сгенерировать аудио"
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
        ))}
      </Tabs>

      <Dialog open={isEditPromptDialogOpen} onOpenChange={setIsEditPromptDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Редактировать промпт: {editingType?.name}</DialogTitle>
            <DialogDescription>
              Этот промпт будет использоваться по умолчанию для всех новых передач этого типа
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex gap-1">
              <Textarea
                value={editingType?.defaultPrompt || ""}
                onChange={(e) => setEditingType(prev => prev ? { ...prev, defaultPrompt: e.target.value } : null)}
                rows={10}
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
    </div>
  );
}
