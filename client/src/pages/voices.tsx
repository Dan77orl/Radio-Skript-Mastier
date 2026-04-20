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
import { Play, Pause, Plus, Trash2, Volume2, User, Users, Mic, Edit2, Search, Loader2, Globe, SlidersHorizontal, GripVertical } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VoiceInput } from "@/components/voice-input";
import { HintTooltip } from "@/components/hint-tooltip";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Voice, ProgramType } from "@shared/schema";

interface VoiceDragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
}

function SortableVoiceCard({ id, children }: { id: string; children: (handleProps: VoiceDragHandleProps) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} data-testid={`sortable-voice-${id}`}>
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}

function ShowDropZone({
  programId,
  name,
  icon,
  children,
}: {
  programId: string;
  name: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `show:${programId}` });
  return (
    <div
      ref={setNodeRef}
      data-testid={`show-drop-${programId}`}
      className={`rounded-lg border p-3 transition-colors ${
        isOver ? "border-primary bg-primary/10 ring-2 ring-primary" : "bg-card"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium truncate">{name}</span>
      </div>
      <div className="flex flex-wrap gap-1 min-h-[32px]">{children}</div>
    </div>
  );
}

function AssignedVoiceChip({
  voiceId,
  programId,
  name,
}: {
  voiceId: string;
  programId: string;
  name: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip:${voiceId}:${programId}`,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`chip-assigned-${voiceId}-${programId}`}
      className={`inline-flex items-center gap-1 rounded-md border bg-secondary px-2 py-1 text-xs cursor-grab active:cursor-grabbing touch-none select-none hover-elevate ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground" />
      <Mic className="h-3 w-3" />
      <span>{name}</span>
    </div>
  );
}

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
  const [myVoicesFilter, setMyVoicesFilter] = useState("");
  const [voiceTab, setVoiceTab] = useState<"my" | "search">("my");
  const [searchGender, setSearchGender] = useState("all");
  const [searchLanguage, setSearchLanguage] = useState("all");
  const [searchAccent, setSearchAccent] = useState("all");
  const [searchAge, setSearchAge] = useState("all");
  const [searchUseCase, setSearchUseCase] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
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

  const activeFilterCount = [searchGender, searchLanguage, searchAccent, searchAge, searchUseCase].filter(v => v !== "all").length;

  const { data: searchData, isLoading: isSearching, isError: isSearchError } = useQuery<{ voices: ElevenLabsVoice[]; has_more: boolean; total_count: number }>({
    queryKey: ["/api/elevenlabs/voices/search", voiceSearchQuery, searchGender, searchLanguage, searchAccent, searchAge, searchUseCase],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (voiceSearchQuery) params.append("q", voiceSearchQuery);
      if (searchGender !== "all") params.append("gender", searchGender);
      if (searchLanguage !== "all") params.append("language", searchLanguage);
      if (searchAccent !== "all") params.append("accent", searchAccent);
      if (searchAge !== "all") params.append("age", searchAge);
      if (searchUseCase !== "all") params.append("use_case", searchUseCase);
      const res = await fetch(`/api/elevenlabs/voices/search?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: voiceTab === "search",
    retry: false,
  });

  const filteredMyVoices = elevenLabsData?.voices?.filter(v => {
    if (!myVoicesFilter) return true;
    const q = myVoicesFilter.toLowerCase();
    return v.name.toLowerCase().includes(q) ||
      v.labels?.accent?.toLowerCase().includes(q) ||
      v.category?.toLowerCase().includes(q);
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

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderVoicesMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      return apiRequest("POST", "/api/voices/reorder", { orderedIds });
    },
    onError: () => {
      toast({
        description: t("voices.reorderError", { defaultValue: "Couldn't save voice order" }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/voices"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voices"] });
    },
  });

  const assignProgramMutation = useMutation({
    mutationFn: async ({ voiceId, assignedProgramTypeIds }: { voiceId: string; assignedProgramTypeIds: string[] }) => {
      const response = await apiRequest("PATCH", `/api/voices/${voiceId}`, { assignedProgramTypeIds });
      return response.json();
    },
    onMutate: async ({ voiceId, assignedProgramTypeIds }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/voices"] });
      const previous = queryClient.getQueryData<Voice[]>(["/api/voices"]);
      queryClient.setQueryData<Voice[]>(["/api/voices"], (old) =>
        old?.map((v) => (v.id === voiceId ? { ...v, assignedProgramTypeIds } : v)) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["/api/voices"], context.previous);
      toast({
        title: t("common.error"),
        description: t("voices.assignError", { defaultValue: "Couldn't update assignment" }),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voices"] });
    },
  });

  const handleVoiceDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);
    const overId = over ? String(over.id) : null;
    const list = voices ?? [];

    if (activeId.startsWith("chip:")) {
      const parts = activeId.split(":");
      const voiceId = parts[1];
      const fromProgramId = parts.slice(2).join(":");
      const voice = list.find((v) => v.id === voiceId);
      if (!voice) return;
      const current = voice.assignedProgramTypeIds || [];

      if (overId?.startsWith("show:")) {
        const toProgramId = overId.slice(5);
        if (toProgramId === fromProgramId) return;
        const next = current.filter((id) => id !== fromProgramId);
        if (!next.includes(toProgramId)) next.push(toProgramId);
        assignProgramMutation.mutate({ voiceId, assignedProgramTypeIds: next });
      } else {
        const next = current.filter((id) => id !== fromProgramId);
        assignProgramMutation.mutate({ voiceId, assignedProgramTypeIds: next });
      }
      return;
    }

    if (overId?.startsWith("show:")) {
      const programId = overId.slice(5);
      const voice = list.find((v) => v.id === activeId);
      if (!voice) return;
      const current = voice.assignedProgramTypeIds || [];
      if (current.includes(programId)) return;
      assignProgramMutation.mutate({
        voiceId: activeId,
        assignedProgramTypeIds: [...current, programId],
      });
      return;
    }

    if (!over || activeId === overId) return;
    const oldIndex = list.findIndex((v) => v.id === activeId);
    const newIndex = list.findIndex((v) => v.id === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(list, oldIndex, newIndex).map((v, i) => ({ ...v, sortOrder: i }));
    queryClient.setQueryData<Voice[]>(["/api/voices"], reordered);
    reorderVoicesMutation.mutate(reordered.map((v) => v.id));
  };

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
      } catch (err: any) {
        let errorDetail = t("voices.libraryAddError");
        try {
          const msg = err.message || "";
          const jsonPart = msg.substring(msg.indexOf("{"));
          if (jsonPart) {
            const errData = JSON.parse(jsonPart);
            if (errData.error) errorDetail = errData.error;
          }
        } catch {}
        toast({
          title: t("common.error"),
          description: errorDetail,
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
          <Dialog open={isAddDialogOpen} onOpenChange={(open) => { if (open) { setVoiceTab("my"); setVoiceSearch(""); setVoiceSearchQuery(""); setMyVoicesFilter(""); setSearchGender("all"); setSearchLanguage("all"); setSearchAccent("all"); setSearchAge("all"); setSearchUseCase("all"); setShowFilters(false); } setIsAddDialogOpen(open); }}>
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
                      <HintTooltip hint={t("hints.voices.myVoicesTab")}>
                        <TabsTrigger value="my" className="flex-1" data-testid="tab-my-voices" onClick={() => setSelectedElevenLabsVoice(null)}>
                          <Mic className="h-4 w-4 mr-1" /> {t("voices.myVoices")}
                        </TabsTrigger>
                      </HintTooltip>
                      <HintTooltip hint={t("hints.voices.searchVoicesTab")}>
                        <TabsTrigger value="search" className="flex-1" data-testid="tab-search-voices" onClick={() => setSelectedElevenLabsVoice(null)}>
                          <Globe className="h-4 w-4 mr-1" /> {t("voices.searchLibrary")}
                        </TabsTrigger>
                      </HintTooltip>
                    </TabsList>
                    <TabsContent value="my" className="mt-2 space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={t("voices.searchMyVoices")}
                          value={myVoicesFilter}
                          onChange={(e) => setMyVoicesFilter(e.target.value)}
                          className="pl-9"
                          data-testid="input-my-voices-search"
                        />
                      </div>
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
                      ) : filteredMyVoices && filteredMyVoices.length > 0 ? (
                        <div className="grid gap-2 max-h-[300px] overflow-y-auto">
                          {filteredMyVoices.map((voice) => (
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
                      ) : myVoicesFilter ? (
                        <div className="text-center py-6 text-muted-foreground">
                          <Search className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">{t("voices.notFound")}</p>
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
                        <HintTooltip hint={t("hints.voices.searchInput")}>
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
                        </HintTooltip>
                        <Button
                          variant={showFilters ? "default" : "outline"}
                          size="icon"
                          onClick={() => setShowFilters(!showFilters)}
                          className="relative shrink-0"
                          data-testid="button-toggle-filters"
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
                              {activeFilterCount}
                            </span>
                          )}
                        </Button>
                      </div>
                      {showFilters && (
                        <div className="flex flex-wrap gap-2">
                          <Select value={searchLanguage} onValueChange={setSearchLanguage}>
                            <SelectTrigger className="w-auto h-8 text-xs gap-1" data-testid="select-search-language">
                              <span className="text-muted-foreground">{t("voices.filterLanguage")}:</span>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("common.all")}</SelectItem>
                              <SelectItem value="russian">Russian</SelectItem>
                              <SelectItem value="english">English</SelectItem>
                              <SelectItem value="turkish">Turkish</SelectItem>
                              <SelectItem value="kazakh">Kazakh</SelectItem>
                              <SelectItem value="spanish">Spanish</SelectItem>
                              <SelectItem value="french">French</SelectItem>
                              <SelectItem value="german">German</SelectItem>
                              <SelectItem value="italian">Italian</SelectItem>
                              <SelectItem value="portuguese">Portuguese</SelectItem>
                              <SelectItem value="chinese">Chinese</SelectItem>
                              <SelectItem value="japanese">Japanese</SelectItem>
                              <SelectItem value="korean">Korean</SelectItem>
                              <SelectItem value="arabic">Arabic</SelectItem>
                              <SelectItem value="hindi">Hindi</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={searchGender} onValueChange={setSearchGender}>
                            <SelectTrigger className="w-auto h-8 text-xs gap-1" data-testid="select-search-gender">
                              <span className="text-muted-foreground">{t("voices.filterGender")}:</span>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("common.all")}</SelectItem>
                              <SelectItem value="male">{t("common.male")}</SelectItem>
                              <SelectItem value="female">{t("common.female")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={searchAccent} onValueChange={setSearchAccent}>
                            <SelectTrigger className="w-auto h-8 text-xs gap-1" data-testid="select-search-accent">
                              <span className="text-muted-foreground">{t("voices.filterAccent")}:</span>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("common.all")}</SelectItem>
                              <SelectItem value="american">American</SelectItem>
                              <SelectItem value="british">British</SelectItem>
                              <SelectItem value="australian">Australian</SelectItem>
                              <SelectItem value="indian">Indian</SelectItem>
                              <SelectItem value="russian">Russian</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={searchAge} onValueChange={setSearchAge}>
                            <SelectTrigger className="w-auto h-8 text-xs gap-1" data-testid="select-search-age">
                              <span className="text-muted-foreground">{t("voices.filterAge")}:</span>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("common.all")}</SelectItem>
                              <SelectItem value="young">Young</SelectItem>
                              <SelectItem value="middle_aged">Middle Aged</SelectItem>
                              <SelectItem value="old">Old</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={searchUseCase} onValueChange={setSearchUseCase}>
                            <SelectTrigger className="w-auto h-8 text-xs gap-1" data-testid="select-search-usecase">
                              <span className="text-muted-foreground">{t("voices.filterCategory")}:</span>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("common.all")}</SelectItem>
                              <SelectItem value="narration">Narration</SelectItem>
                              <SelectItem value="conversational">Conversational</SelectItem>
                              <SelectItem value="news">News</SelectItem>
                              <SelectItem value="characters">Characters</SelectItem>
                              <SelectItem value="meditation">Meditation</SelectItem>
                              <SelectItem value="social_media">Social Media</SelectItem>
                            </SelectContent>
                          </Select>
                          {activeFilterCount > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => { setSearchGender("all"); setSearchLanguage("all"); setSearchAccent("all"); setSearchAge("all"); setSearchUseCase("all"); }}
                              data-testid="button-clear-filters"
                            >
                              {t("voices.clearFilters")}
                            </Button>
                          )}
                        </div>
                      )}
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
                                <div className="flex gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                                  {voice.labels?.language && <span>{voice.labels.language}</span>}
                                  {voice.labels?.accent && <span>• {t("voices.accent")}: {voice.labels.accent}</span>}
                                  {voice.labels?.age && <span>• {voice.labels.age}</span>}
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
                <HintTooltip hint={t("hints.voices.confirmAdd")}>
                  <Button
                    onClick={handleAddVoice}
                    disabled={!selectedElevenLabsVoice || !personaName.trim() || createMutation.isPending}
                    data-testid="button-confirm-add"
                  >
                    {createMutation.isPending ? t("common.loading") : t("common.add")}
                  </Button>
                </HintTooltip>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : voices && voices.length > 0 ? (
        <DndContext
          sensors={dndSensors}
          collisionDetection={(args) => {
            const pointer = pointerWithin(args);
            if (pointer.length > 0) return pointer;
            const intersect = rectIntersection(args);
            if (intersect.length > 0) return intersect;
            return closestCenter(args);
          }}
          onDragEnd={handleVoiceDragEnd}
        >
          <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{t("voices.assignToShows")}</h2>
                <span className="text-xs text-muted-foreground">
                  {t("voices.dragVoiceToShowHint", { defaultValue: "Drag a voice onto a show to assign it. Drag a chip away to unassign." })}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <ShowDropZone
                  programId="dialogs"
                  name={t("voices.dialogs")}
                  icon={<Users className="h-4 w-4 text-muted-foreground" />}
                >
                  {voices.filter(v => v.assignedProgramTypeIds?.includes("dialogs")).map(v => (
                    <AssignedVoiceChip key={v.id} voiceId={v.id} programId="dialogs" name={v.name} />
                  ))}
                  {voices.filter(v => v.assignedProgramTypeIds?.includes("dialogs")).length === 0 && (
                    <span className="text-xs text-muted-foreground italic">{t("voices.dropVoiceHere", { defaultValue: "Drop a voice here" })}</span>
                  )}
                </ShowDropZone>
                {programTypes?.map(pt => (
                  <ShowDropZone
                    key={pt.id}
                    programId={pt.id}
                    name={pt.name}
                    icon={<Mic className="h-4 w-4 text-muted-foreground" />}
                  >
                    {voices.filter(v => v.assignedProgramTypeIds?.includes(pt.id)).map(v => (
                      <AssignedVoiceChip key={v.id} voiceId={v.id} programId={pt.id} name={v.name} />
                    ))}
                    {voices.filter(v => v.assignedProgramTypeIds?.includes(pt.id)).length === 0 && (
                      <span className="text-xs text-muted-foreground italic">{t("voices.dropVoiceHere", { defaultValue: "Drop a voice here" })}</span>
                    )}
                  </ShowDropZone>
                ))}
              </div>
            </div>
          <SortableContext items={voices.map((v) => v.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-4 md:grid-cols-2">
              {voices.map((voice, index) => (
                <SortableVoiceCard key={voice.id} id={voice.id}>
                  {({ attributes, listeners, isDragging }) => (
            <Card data-testid={`voice-card-${voice.id}`} className={isDragging ? "ring-2 ring-primary" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="flex h-8 w-6 items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
                      aria-label={t("voices.dragToReorder", { defaultValue: "Drag to reorder" })}
                      data-testid={`button-drag-voice-${voice.id}`}
                      {...attributes}
                      {...listeners}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
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
                      <HintTooltip hint={t("hints.voices.previewVoice")}>
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
                      </HintTooltip>
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
                  )}
                </SortableVoiceCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
      )}

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
                  <HintTooltip hint={t("hints.voices.changeVoice")}>
                    <Button variant="outline" size="sm" onClick={() => setEditVoiceChanged(true)} data-testid="button-change-voice">
                      {t("voices.changeVoice")}
                    </Button>
                  </HintTooltip>
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
            <HintTooltip hint={t("hints.voices.saveChanges")}>
              <Button
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending || (editVoiceChanged && !editSelectedElevenLabsVoice)}
                data-testid="button-save-edit"
              >
                {updateMutation.isPending ? t("common.loading") : t("common.save")}
              </Button>
            </HintTooltip>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
