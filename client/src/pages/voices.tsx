import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Play, Pause, Plus, Trash2, Volume2, User, Users, Mic, Edit2 } from "lucide-react";
import { VoiceInput } from "@/components/voice-input";
import type { Voice, ProgramType } from "@shared/schema";

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url: string;
  description: string;
}

export default function VoicesPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<Voice | null>(null);
  const [selectedElevenLabsVoice, setSelectedElevenLabsVoice] = useState<ElevenLabsVoice | null>(null);
  const [personaName, setPersonaName] = useState("");
  const [personaGender, setPersonaGender] = useState("male");
  const [selectedProgramTypes, setSelectedProgramTypes] = useState<string[]>([]);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: voices, isLoading } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const { data: programTypes } = useQuery<ProgramType[]>({
    queryKey: ["/api/program-types"],
  });

  const { data: elevenLabsData, isLoading: isLoadingElevenLabs, isError: isElevenLabsError, error: elevenLabsError } = useQuery<{ voices: ElevenLabsVoice[] }>({
    queryKey: ["/api/elevenlabs/voices"],
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; elevenLabsVoiceId: string; gender: string; previewUrl: string; description: string; assignedProgramTypeIds?: string[] }) => {
      const response = await apiRequest("POST", "/api/voices", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voices"] });
      setIsAddDialogOpen(false);
      setSelectedElevenLabsVoice(null);
      setPersonaName("");
      setPersonaGender("male");
      setSelectedProgramTypes([]);
      toast({
        title: "Голос добавлен",
        description: "Персона успешно создана",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось добавить голос",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { assignedProgramTypeIds?: string[] } }) => {
      const response = await apiRequest("PATCH", `/api/voices/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voices"] });
      setIsEditDialogOpen(false);
      setEditingVoice(null);
      setSelectedProgramTypes([]);
      toast({
        title: "Сохранено",
        description: "Назначения персоны обновлены",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось обновить персону",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/voices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voices"] });
      toast({
        title: "Удалено",
        description: "Голос удален",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const playPreview = (url: string, voiceId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }

    if (playingVoiceId === voiceId) {
      setPlayingVoiceId(null);
      return;
    }

    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingVoiceId(voiceId);
    
    audio.play();
    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => {
      setPlayingVoiceId(null);
      toast({
        title: "Ошибка воспроизведения",
        description: "Не удалось воспроизвести образец голоса",
        variant: "destructive",
      });
    };
  };

  const handleAddVoice = () => {
    if (!selectedElevenLabsVoice || !personaName.trim()) {
      toast({
        title: "Заполните все поля",
        description: "Введите имя персоны и выберите голос",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      name: personaName.trim(),
      elevenLabsVoiceId: selectedElevenLabsVoice.voice_id,
      gender: personaGender,
      previewUrl: selectedElevenLabsVoice.preview_url,
      description: selectedElevenLabsVoice.name,
      assignedProgramTypeIds: selectedProgramTypes.length > 0 ? selectedProgramTypes : undefined,
    });
  };

  const handleEditVoice = (voice: Voice) => {
    setEditingVoice(voice);
    setSelectedProgramTypes(voice.assignedProgramTypeIds || []);
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingVoice) return;
    updateMutation.mutate({
      id: editingVoice.id,
      data: { assignedProgramTypeIds: selectedProgramTypes },
    });
  };

  const toggleProgramType = (programTypeId: string) => {
    setSelectedProgramTypes(prev => 
      prev.includes(programTypeId) 
        ? prev.filter(id => id !== programTypeId)
        : [...prev, programTypeId]
    );
  };

  const getProgramTypeNames = (ids: string[] | null | undefined): string[] => {
    if (!ids) return [];
    return ids.map(id => {
      if (id === "dialogs") return "Подводки / Диалоги";
      return programTypes?.find(pt => pt.id === id)?.name;
    }).filter(Boolean) as string[];
  };

  const voicesCount = voices?.length || 0;
  const canAddMore = voicesCount < 4;

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Голоса</h1>
          <p className="text-muted-foreground">Управление персонами для радио-диалогов</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            <Users className="mr-1 h-3 w-3" />
            {voicesCount} / 4 персон
          </Badge>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={!canAddMore} data-testid="button-add-voice">
                <Plus className="mr-2 h-4 w-4" />
                Добавить персону
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Добавить персону</DialogTitle>
                <DialogDescription>
                  Выберите голос из коллекции ElevenLabs и задайте имя персоны
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Имя персоны</label>
                    <div className="flex gap-1 items-center">
                      <Input
                        placeholder="Например: Алексей"
                        value={personaName}
                        onChange={(e) => setPersonaName(e.target.value)}
                        data-testid="input-persona-name"
                        className="flex-1"
                      />
                      <VoiceInput onTranscript={(text) => setPersonaName(prev => prev + text)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Пол</label>
                    <Select value={personaGender} onValueChange={setPersonaGender}>
                      <SelectTrigger data-testid="select-gender">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Мужской</SelectItem>
                        <SelectItem value="female">Женский</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Назначить на передачи</label>
                  <div className="grid gap-2 max-h-[150px] overflow-y-auto border rounded-lg p-3">
                    <div 
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => toggleProgramType("dialogs")}
                    >
                      <Checkbox 
                        checked={selectedProgramTypes.includes("dialogs")} 
                        onCheckedChange={() => toggleProgramType("dialogs")}
                        data-testid="checkbox-program-dialogs"
                      />
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Подводки / Диалоги</span>
                      </div>
                    </div>
                    {programTypes?.map((pt) => (
                      <div 
                        key={pt.id} 
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => toggleProgramType(pt.id)}
                      >
                        <Checkbox 
                          checked={selectedProgramTypes.includes(pt.id)} 
                          onCheckedChange={() => toggleProgramType(pt.id)}
                          data-testid={`checkbox-program-${pt.id}`}
                        />
                        <div className="flex items-center gap-2">
                          <Mic className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{pt.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Выберите передачи, которые будет вести эта персона
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Голос ElevenLabs</label>
                  {isLoadingElevenLabs ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : isElevenLabsError ? (
                    <div className="text-center py-8 border rounded-lg bg-destructive/5">
                      <Volume2 className="h-12 w-12 mx-auto mb-3 text-destructive/50" />
                      <p className="text-sm text-destructive mb-2">Не удалось загрузить голоса</p>
                      <p className="text-xs text-muted-foreground">
                        Проверьте API ключ ElevenLabs в настройках
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-3"
                        onClick={() => window.location.href = "/settings"}
                      >
                        Перейти в настройки
                      </Button>
                    </div>
                  ) : elevenLabsData?.voices && elevenLabsData.voices.length > 0 ? (
                    <div className="grid gap-2 max-h-[300px] overflow-y-auto">
                      {elevenLabsData.voices.map((voice) => (
                        <div
                          key={voice.voice_id}
                          className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer hover-elevate ${
                            selectedElevenLabsVoice?.voice_id === voice.voice_id
                              ? "border-primary bg-primary/5"
                              : ""
                          }`}
                          onClick={() => setSelectedElevenLabsVoice(voice)}
                          data-testid={`voice-option-${voice.voice_id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{voice.name}</span>
                              {voice.labels?.gender && (
                                <Badge variant="secondary" className="text-xs">
                                  {voice.labels.gender === "male" ? "М" : "Ж"}
                                </Badge>
                              )}
                              {voice.category && (
                                <Badge variant="outline" className="text-xs">
                                  {voice.category}
                                </Badge>
                              )}
                            </div>
                            {voice.labels?.accent && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Акцент: {voice.labels.accent}
                              </p>
                            )}
                          </div>
                          {voice.preview_url && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                playPreview(voice.preview_url, voice.voice_id);
                              }}
                              data-testid={`button-preview-${voice.voice_id}`}
                            >
                              {playingVoiceId === voice.voice_id ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Volume2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Добавьте API ключ ElevenLabs в настройках</p>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Отмена
                </Button>
                <Button
                  onClick={handleAddVoice}
                  disabled={!selectedElevenLabsVoice || !personaName.trim() || createMutation.isPending}
                  data-testid="button-confirm-add"
                >
                  {createMutation.isPending ? "Добавление..." : "Добавить"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {isLoading ? (
          Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))
        ) : voices && voices.length > 0 ? (
          voices.map((voice, index) => (
            <Card key={voice.id} data-testid={`voice-card-${voice.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      voice.gender === "female" ? "bg-pink-500/10 text-pink-600" : "bg-blue-500/10 text-blue-600"
                    }`}>
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{voice.name}</CardTitle>
                      <CardDescription>
                        {voice.gender === "female" ? "Женский голос" : "Мужской голос"}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline">#{index + 1}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {voice.description && (
                    <p className="text-sm text-muted-foreground">
                      ElevenLabs: {voice.description}
                    </p>
                  )}
                  {voice.assignedProgramTypeIds && voice.assignedProgramTypeIds.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {getProgramTypeNames(voice.assignedProgramTypeIds).map((name, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          <Mic className="mr-1 h-3 w-3" />
                          {name}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {voice.previewUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => playPreview(voice.previewUrl!, voice.id)}
                        data-testid={`button-play-${voice.id}`}
                      >
                        {playingVoiceId === voice.id ? (
                          <>
                            <Pause className="mr-2 h-4 w-4" />
                            Стоп
                          </>
                        ) : (
                          <>
                            <Play className="mr-2 h-4 w-4" />
                            Прослушать
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEditVoice(voice)}
                      data-testid={`button-edit-${voice.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="icon">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Удалить персону?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Персона "{voice.name}" будет удалена. Это действие нельзя отменить.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(voice.id)}>
                            Удалить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Нет персон</h3>
              <p className="text-muted-foreground text-center mb-4">
                Добавьте до 4 персон с голосами для радио-диалогов
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)} disabled={!canAddMore}>
                <Plus className="mr-2 h-4 w-4" />
                Добавить первую персону
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {!canAddMore && voices && voices.length >= 4 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground text-center">
              Достигнут лимит в 4 персоны. Удалите существующую персону, чтобы добавить новую.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать персону</DialogTitle>
            <DialogDescription>
              Назначьте передачи для {editingVoice?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Назначить на передачи</label>
              <div className="grid gap-2 max-h-[250px] overflow-y-auto border rounded-lg p-3">
                <div 
                  className="flex items-center gap-2 cursor-pointer hover-elevate p-2 rounded-md"
                  onClick={() => toggleProgramType("dialogs")}
                >
                  <Checkbox 
                    checked={selectedProgramTypes.includes("dialogs")} 
                    onCheckedChange={() => toggleProgramType("dialogs")}
                    data-testid="edit-checkbox-program-dialogs"
                  />
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Подводки / Диалоги</span>
                  </div>
                </div>
                {programTypes?.map((pt) => (
                  <div 
                    key={pt.id} 
                    className="flex items-center gap-2 cursor-pointer hover-elevate p-2 rounded-md"
                    onClick={() => toggleProgramType(pt.id)}
                  >
                    <Checkbox 
                      checked={selectedProgramTypes.includes(pt.id)} 
                      onCheckedChange={() => toggleProgramType(pt.id)}
                      data-testid={`edit-checkbox-program-${pt.id}`}
                    />
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{pt.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
