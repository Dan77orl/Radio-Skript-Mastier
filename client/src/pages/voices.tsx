import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
import { Play, Pause, Plus, Trash2, Volume2, User, Users, Mic, Edit2, Search, Loader2, Globe } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VoiceInput } from "@/components/voice-input";
import { HintTooltip } from "@/components/hint-tooltip";
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
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<Voice | null>(null);
  const [selectedElevenLabsVoice, setSelectedElevenLabsVoice] = useState<ElevenLabsVoice | null>(null);
  const [personaName, setPersonaName] = useState("");
  const [personaGender, setPersonaGender] = useState("male");
  const [selectedProgramTypes, setSelectedProgramTypes] = useState<string[]>([]);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceSearchQuery, setVoiceSearchQuery] = useState("");
  const [voiceTab, setVoiceTab] = useState<"my" | "search">("my");
  const [searchGender, setSearchGender] = useState("all");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const { data: searchData, isLoading: isSearching, isError: isSearchError } = useQuery<{ voices: ElevenLabsVoice[]; has_more: boolean; total_count: number }>({
    queryKey: ["/api/elevenlabs/voices/search", voiceSearchQuery, searchGender],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (voiceSearchQuery) params.append("q", voiceSearchQuery);
      if (searchGender !== "all") params.append("gender", searchGender);
      const res = await fetch(`/api/elevenlabs/voices/search?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: voiceTab === "search",
    retry: false,
  });

  const selectVoice = (voice: ElevenLabsVoice) => {
    setSelectedElevenLabsVoice(voice);
    setPersonaName(voice.name);
    const gender = voice.labels?.gender;
    if (gender === "female") {
      setPersonaGender("female");
    } else if (gender === "male") {
      setPersonaGender("male");
    }
  };

  const handleSearchInput = (value: string) => {
    setVoiceSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setVoiceSearchQuery(value);
    }, 500);
  };

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
        title: t("voices.voiceAdded"),
        description: t("voices.personaCreated"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [editPersonaName, setEditPersonaName] = useState("");
  const [editGender, setEditGender] = useState("male");
  const [editVoiceChanged, setEditVoiceChanged] = useState(false);
  const [editSelectedElevenLabsVoice, setEditSelectedElevenLabsVoice] = useState<ElevenLabsVoice | null>(null);
  const [editPlayingPreview, setEditPlayingPreview] = useState<string | null>(null);
  const editAudioRef = useRef<HTMLAudioElement | null>(null);

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const response = await apiRequest("PATCH", `/api/voices/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voices"] });
      setIsEditDialogOpen(false);
      setEditingVoice(null);
      setSelectedProgramTypes([]);
      setEditVoiceChanged(false);
      setEditSelectedElevenLabsVoice(null);
      toast({
        title: t("common.saved"),
        description: t("voices.settingsSaved"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
        description: error.message,
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
        title: t("common.deleted"),
        description: t("voices.voiceDeleted"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
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
        title: t("voices.playbackError"),
        description: t("voices.playbackErrorDescription"),
        variant: "destructive",
      });
    };
  };

  const handleAddVoice = async () => {
    if (!selectedElevenLabsVoice || !personaName.trim()) {
      toast({
        title: t("voices.fillAllFields"),
        description: t("voices.enterNameAndVoice"),
        variant: "destructive",
      });
      return;
    }

    let voiceId = selectedElevenLabsVoice.voice_id;
    const isSharedVoice = voiceTab === "search" && (selectedElevenLabsVoice as any).public_owner_id;

    if (isSharedVoice) {
      try {
        const res = await apiRequest("POST", "/api/elevenlabs/voices/add-shared", {
          public_owner_id: (selectedElevenLabsVoice as any).public_owner_id,
          voice_id: selectedElevenLabsVoice.voice_id,
          name: selectedElevenLabsVoice.name,
        });
        const data = await res.json();
        voiceId = data.voice_id;
      } catch (err) {
        toast({
          title: t("common.error"),
          description: t("voices.libraryAddError"),
          variant: "destructive",
        });
        return;
      }
    }

    createMutation.mutate({
      name: personaName.trim(),
      elevenLabsVoiceId: voiceId,
      gender: personaGender,
      previewUrl: selectedElevenLabsVoice.preview_url,
      description: selectedElevenLabsVoice.name,
      assignedProgramTypeIds: selectedProgramTypes.length > 0 ? selectedProgramTypes : undefined,
    });
  };

  const handleEditVoice = (voice: Voice) => {
    setEditingVoice(voice);
    setEditPersonaName(voice.name);
    setEditGender(voice.gender);
    setSelectedProgramTypes(voice.assignedProgramTypeIds || []);
    setEditVoiceChanged(false);
    setEditSelectedElevenLabsVoice(null);
    setIsEditDialogOpen(true);
  };

  const playEditPreview = (url: string) => {
    if (editAudioRef.current) {
      editAudioRef.current.pause();
    }
    if (editPlayingPreview === url) {
      setEditPlayingPreview(null);
      return;
    }
    const audio = new Audio(url);
    editAudioRef.current = audio;
    setEditPlayingPreview(url);
    audio.play();
    audio.onended = () => setEditPlayingPreview(null);
    audio.onerror = () => setEditPlayingPreview(null);
  };

  const handleSaveEdit = () => {
    if (!editingVoice) return;
    const data: Record<string, any> = {
      name: editPersonaName.trim() || editingVoice.name,
      gender: editGender,
      assignedProgramTypeIds: selectedProgramTypes,
    };
    if (editVoiceChanged && editSelectedElevenLabsVoice) {
      data.elevenLabsVoiceId = editSelectedElevenLabsVoice.voice_id;
      data.previewUrl = editSelectedElevenLabsVoice.preview_url;
      data.description = editSelectedElevenLabsVoice.name;
    }
    updateMutation.mutate({ id: editingVoice.id, data });
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
      if (id === "dialogs") return t("voices.dialogs");
      return programTypes?.find(pt => pt.id === id)?.name;
    }).filter(Boolean) as string[];
  };

  const voicesCount = voices?.length || 0;

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("voices.title")}</h1>
          <p className="text-muted-foreground">{t("voices.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            <Users className="mr-1 h-3 w-3" />
            {voicesCount} {t("voices.personas")}
          </Badge>
          <Dialog open={isAddDialogOpen} onOpenChange={(open) => { if (open) { setVoiceTab("my"); setVoiceSearch(""); setVoiceSearchQuery(""); setSearchGender("all"); } setIsAddDialogOpen(open); }}>
            <HintTooltip hint={t("hints.voices.addPersona")}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-voice">
                  <Plus className="mr-2 h-4 w-4" />
                  {t("voices.addPersona")}
                </Button>
              </DialogTrigger>
            </HintTooltip>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("voices.addPersonaTitle")}</DialogTitle>
                <DialogDescription>
                  {t("voices.addPersonaDescription")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("voices.personaName")}</label>
                    <div className="flex gap-1 items-center">
                      <Input
                        placeholder={t("voices.personaNamePlaceholder")}
                        value={personaName}
                        onChange={(e) => setPersonaName(e.target.value)}
                        data-testid="input-persona-name"
                        className="flex-1"
                      />
                      <VoiceInput onTranscript={(text) => setPersonaName(prev => prev + text)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("voices.gender")}</label>
                    <Select value={personaGender} onValueChange={setPersonaGender}>
                      <SelectTrigger data-testid="select-gender">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">{t("common.male")}</SelectItem>
                        <SelectItem value="female">{t("common.female")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("voices.assignToShows")}</label>
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
                        <span className="text-sm">{t("voices.dialogs")}</span>
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
                    {t("voices.selectShowsHint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("voices.elevenLabsVoice")}</label>
                  <Tabs value={voiceTab} onValueChange={(v) => setVoiceTab(v as "my" | "search")}>
                    <TabsList className="w-full">
                      <TabsTrigger value="my" className="flex-1" data-testid="tab-my-voices" onClick={() => setSelectedElevenLabsVoice(null)}>
                        <Mic className="h-4 w-4 mr-1" /> {t("voices.myVoices")}
                      </TabsTrigger>
                      <TabsTrigger value="search" className="flex-1" data-testid="tab-search-voices" onClick={() => setSelectedElevenLabsVoice(null)}>
                        <Globe className="h-4 w-4 mr-1" /> {t("voices.searchLibrary")}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="my" className="mt-2">
                      {isLoadingElevenLabs ? (
                        <div className="space-y-2">
                          {Array.from({ length: 3 }, (_, i) => (
                            <Skeleton key={i} className="h-16 w-full" />
                          ))}
                        </div>
                      ) : isElevenLabsError ? (
                        <div className="text-center py-6 border rounded-lg bg-destructive/5">
                          <Volume2 className="h-10 w-10 mx-auto mb-2 text-destructive/50" />
                          <p className="text-sm text-destructive mb-1">{t("voices.loadError")}</p>
                          <p className="text-xs text-muted-foreground">{t("voices.checkApiKey")}</p>
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
                              onClick={() => selectVoice(voice)}
                              data-testid={`voice-option-${voice.voice_id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium">{voice.name}</span>
                                  {voice.labels?.gender && (
                                    <Badge variant="secondary" className="text-xs">
                                      {voice.labels.gender === "male" ? t("common.maleShort") : t("common.femaleShort")}
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
                                    {t("common.accent")}: {voice.labels.accent}
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
                        <div className="text-center py-6 text-muted-foreground">
                          <Volume2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">{t("voices.addApiKey")}</p>
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="search" className="mt-2 space-y-3">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder={t("voices.searchVoices")}
                            value={voiceSearch}
                            onChange={(e) => handleSearchInput(e.target.value)}
                            className="pl-9"
                            data-testid="input-voice-search"
                          />
                        </div>
                        <Select value={searchGender} onValueChange={setSearchGender}>
                          <SelectTrigger className="w-32" data-testid="select-search-gender">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("common.all")}</SelectItem>
                            <SelectItem value="male">{t("common.male")}</SelectItem>
                            <SelectItem value="female">{t("common.female")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {isSearching ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          <span className="ml-2 text-sm text-muted-foreground">{t("common.loading")}</span>
                        </div>
                      ) : isSearchError ? (
                        <div className="text-center py-6 border rounded-lg bg-destructive/5">
                          <Volume2 className="h-10 w-10 mx-auto mb-2 text-destructive/50" />
                          <p className="text-sm text-destructive mb-1">{t("voices.searchError")}</p>
                          <p className="text-xs text-muted-foreground">{t("voices.checkApiKey")}</p>
                        </div>
                      ) : searchData?.voices && searchData.voices.length > 0 ? (
                        <div className="grid gap-2 max-h-[300px] overflow-y-auto">
                          {searchData.voices.map((voice) => (
                            <div
                              key={voice.voice_id}
                              className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer hover-elevate ${
                                selectedElevenLabsVoice?.voice_id === voice.voice_id
                                  ? "border-primary bg-primary/5"
                                  : ""
                              }`}
                              onClick={() => selectVoice(voice)}
                              data-testid={`voice-search-option-${voice.voice_id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium truncate">{voice.name}</span>
                                  {voice.labels?.gender && (
                                    <Badge variant="secondary" className="text-xs">
                                      {voice.labels.gender === "male" ? t("common.maleShort") : t("common.femaleShort")}
                                    </Badge>
                                  )}
                                  <Badge variant="outline" className="text-xs">
                                    {voice.category}
                                  </Badge>
                                </div>
                                <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                                  {voice.labels?.accent && <span>{t("voices.accent")}: {voice.labels.accent}</span>}
                                  {voice.labels?.language && <span>• {voice.labels.language}</span>}
                                  {voice.labels?.use_case && <span>• {voice.labels.use_case}</span>}
                                </div>
                              </div>
                              {voice.preview_url && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    playPreview(voice.preview_url, voice.voice_id);
                                  }}
                                  data-testid={`button-search-preview-${voice.voice_id}`}
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
                          {searchData.has_more && (
                            <p className="text-xs text-center text-muted-foreground py-2">
                              {t("voices.showingResults", { shown: searchData.voices.length, total: searchData.total_count })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-6 text-muted-foreground">
                          <Search className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">
                            {voiceSearchQuery ? t("voices.notFound") : t("voices.enterQuery")}
                          </p>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleAddVoice}
                  disabled={!selectedElevenLabsVoice || !personaName.trim() || createMutation.isPending}
                  data-testid="button-confirm-add"
                >
                  {createMutation.isPending ? t("common.loading") : t("common.add")}
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
                        {voice.gender === "female" ? t("generator.femaleVoice") : t("generator.maleVoice")}
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
                            {t("common.pause")}
                          </>
                        ) : (
                          <>
                            <Play className="mr-2 h-4 w-4" />
                            {t("generator.listen")}
                          </>
                        )}
                      </Button>
                    )}
                    <HintTooltip hint={t("hints.voices.editVoice")}>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleEditVoice(voice)}
                        data-testid={`button-edit-${voice.id}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </HintTooltip>
                    <AlertDialog>
                      <HintTooltip hint={t("hints.voices.deleteVoice")}>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="icon">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                      </HintTooltip>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("voices.deleteVoice")}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("voices.deleteVoiceConfirm")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(voice.id)}>
                            {t("common.delete")}
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
              <h3 className="text-lg font-medium mb-2">{t("voices.noVoicesConfigured")}</h3>
              <p className="text-muted-foreground text-center mb-4">
                {t("voices.addFirstVoice")}
              </p>
              <Button onClick={() => { setVoiceTab("my"); setVoiceSearch(""); setVoiceSearchQuery(""); setSearchGender("all"); setIsAddDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />
                {t("voices.addPersona")}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={(open) => { if (!open && editAudioRef.current) editAudioRef.current.pause(); setIsEditDialogOpen(open); }}>
        <DialogContent className="!w-[min(38rem,calc(100vw-2rem))] !max-w-none max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("voices.editVoice")}</DialogTitle>
            <DialogDescription>
              {editingVoice?.description && `ElevenLabs: ${editingVoice.description}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("voices.personaName")}</label>
                <Input
                  value={editPersonaName}
                  onChange={(e) => setEditPersonaName(e.target.value)}
                  data-testid="input-edit-persona-name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("voices.gender")}</label>
                <Select value={editGender} onValueChange={setEditGender}>
                  <SelectTrigger data-testid="select-edit-gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">{t("generator.maleVoice")}</SelectItem>
                    <SelectItem value="female">{t("generator.femaleVoice")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{t("voices.elevenLabsVoice")}</label>
                {editingVoice?.previewUrl && !editVoiceChanged && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => playEditPreview(editingVoice.previewUrl!)}
                    data-testid="button-edit-current-preview"
                  >
                    {editPlayingPreview === editingVoice.previewUrl ? <Pause className="mr-1 h-3 w-3" /> : <Play className="mr-1 h-3 w-3" />}
                    {t("voices.currentVoice")}
                  </Button>
                )}
              </div>
              {!editVoiceChanged ? (
                <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
                  <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 truncate">{editingVoice?.description || editingVoice?.elevenLabsVoiceId}</span>
                  <Button variant="outline" size="sm" onClick={() => setEditVoiceChanged(true)} data-testid="button-change-voice">
                    {t("voices.changeVoice")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {editSelectedElevenLabsVoice ? (
                    <div className="flex items-center gap-2 p-3 border rounded-lg border-primary/50 bg-primary/5">
                      <Volume2 className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm flex-1 truncate">{editSelectedElevenLabsVoice.name}</span>
                      {editSelectedElevenLabsVoice.preview_url && (
                        <Button variant="ghost" size="sm" onClick={() => playEditPreview(editSelectedElevenLabsVoice.preview_url)} data-testid="button-edit-new-preview">
                          {editPlayingPreview === editSelectedElevenLabsVoice.preview_url ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setEditSelectedElevenLabsVoice(null)} data-testid="button-clear-new-voice">
                        &times;
                      </Button>
                    </div>
                  ) : (
                    <div className="border rounded-lg max-h-[200px] overflow-y-auto">
                      {isLoadingElevenLabs ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">{t("common.loading")}...</div>
                      ) : elevenLabsData?.voices && elevenLabsData.voices.length > 0 ? (
                        elevenLabsData.voices.map((elv) => (
                          <div
                            key={elv.voice_id}
                            className={`flex items-center gap-2 p-2 cursor-pointer hover:bg-accent/50 border-b last:border-b-0 ${editingVoice?.elevenLabsVoiceId === elv.voice_id ? "bg-accent/30" : ""}`}
                            onClick={() => setEditSelectedElevenLabsVoice(elv)}
                            data-testid={`edit-voice-option-${elv.voice_id}`}
                          >
                            <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm truncate block">{elv.name}</span>
                              {elv.labels?.gender && (
                                <span className="text-xs text-muted-foreground">{elv.labels.gender}</span>
                              )}
                            </div>
                            {editingVoice?.elevenLabsVoiceId === elv.voice_id && (
                              <Badge variant="secondary" className="text-xs shrink-0">{t("voices.current")}</Badge>
                            )}
                            {elv.preview_url && (
                              <Button variant="ghost" size="sm" className="shrink-0 h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); playEditPreview(elv.preview_url); }}>
                                {editPlayingPreview === elv.preview_url ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              </Button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center text-sm text-muted-foreground">{t("voices.noVoicesInElevenLabs")}</div>
                      )}
                    </div>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { setEditVoiceChanged(false); setEditSelectedElevenLabsVoice(null); }} data-testid="button-cancel-voice-change">
                    {t("common.cancel")}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("voices.assignToShows")}</label>
              <div className="grid gap-2 max-h-[200px] overflow-y-auto border rounded-lg p-3">
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
                    <span className="text-sm">{t("voices.dialogs")}</span>
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
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending || (editVoiceChanged && !editSelectedElevenLabsVoice)}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
