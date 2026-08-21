import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInput } from "@/components/voice-input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { usePlaybackRate } from "@/hooks/use-playback-rate";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCleanVoiceName } from "@/lib/utils";
import { 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  CloudSun,
  Sun,
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
  User,
  Users,
  Download,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  AudioLines,
  Pencil,
  ScrollText,
  FileUp,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { ProgramType, Program, Settings as AppSettings, Voice } from "@shared/schema";
import { hasLengthConstraintInPrompt } from "@shared/prompt-length";
import { HintTooltip } from "@/components/hint-tooltip";

function ScheduleScriptPopover({
  type,
  disabled,
  onGenerate,
}: {
  type: ProgramType;
  disabled: boolean;
  onGenerate: (scheduledDate: string, forecastDays?: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const todayStr = new Date().toISOString().split("T")[0];
  const maxDate = new Date(Date.now() + 6 * 86400000).toISOString().split("T")[0];
  const [date, setDate] = useState(todayStr);
  const [days, setDays] = useState<number>(type.defaultForecastDays || 3);
  const isWeather = !!type.isWeatherForecast;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="px-2"
          data-testid={`button-schedule-script-${type.id}`}
          title={t("shows.scheduleScript")}
        >
          <Calendar className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <div className="space-y-1">
          <Label className="text-xs">{t("shows.releaseDate")}</Label>
          <Input
            type="date"
            value={date}
            min={todayStr}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            data-testid="input-schedule-date"
          />
        </div>
        {isWeather && (
          <div className="space-y-1">
            <Label className="text-xs">{t("shows.forecastDays")}</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger data-testid="select-forecast-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("shows.daysCount", { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            onGenerate(date, isWeather ? days : undefined);
            setOpen(false);
          }}
          data-testid="button-generate-with-options"
        >
          <Zap className="mr-1.5 h-4 w-4" />
          {t("common.create")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

const getDefaultProgramTypes = (stationName: string, t: (key: string) => string) => [
  {
    name: t("defaults.newsName"),
    slug: "news",
    description: t("defaults.newsDesc"),
    icon: "newspaper",
    dailyCount: 4,
    slotDescriptions: [
      t("defaults.newsSlot1"),
      t("defaults.newsSlot2"),
      t("defaults.newsSlot3"),
      t("defaults.newsSlot4"),
    ],
    defaultPrompt: t("defaults.newsPrompt").replace("{stationName}", stationName),
  },
  {
    name: t("defaults.digestName"),
    slug: "digest",
    description: t("defaults.digestDesc"),
    icon: "file-text",
    dailyCount: 2,
    slotDescriptions: [
      t("defaults.digestSlot1"),
      t("defaults.digestSlot2"),
    ],
    defaultPrompt: t("defaults.digestPrompt").replace("{stationName}", stationName),
  },
  {
    name: t("defaults.techName"),
    slug: "tech-news",
    description: t("defaults.techDesc"),
    icon: "brain",
    dailyCount: 2,
    slotDescriptions: [
      t("defaults.techSlot1"),
      t("defaults.techSlot2"),
    ],
    defaultPrompt: t("defaults.techPrompt").replace("{stationName}", stationName),
  },
  {
    name: t("defaults.celebName"),
    slug: "celebrity",
    description: t("defaults.celebDesc"),
    icon: "sparkles",
    dailyCount: 4,
    slotDescriptions: [
      t("defaults.celebSlot1"),
      t("defaults.celebSlot2"),
      t("defaults.celebSlot3"),
      t("defaults.celebSlot4"),
    ],
    defaultPrompt: t("defaults.celebPrompt").replace("{stationName}", stationName),
  },
  {
    name: t("defaults.weatherName"),
    slug: "weather",
    description: t("defaults.weatherDesc"),
    icon: "cloud-sun",
    dailyCount: 2,
    slotDescriptions: [
      t("defaults.weatherSlot1"),
      t("defaults.weatherSlot2"),
    ],
    defaultPrompt: t("defaults.weatherPrompt").replace("{stationName}", stationName),
  },
  {
    name: t("defaults.guideName"),
    slug: "local-guide",
    description: t("defaults.guideDesc"),
    icon: "map-pin",
    dailyCount: 1,
    slotDescriptions: [
      t("defaults.guideSlot1"),
    ],
    defaultPrompt: t("defaults.guidePrompt").replace("{stationName}", stationName),
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

function SortableProgramTypeTab({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: isDragging ? "grabbing" : "grab",
    touchAction: "none",
    display: "inline-flex",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} data-testid={`sortable-tab-${id}`}>
      {children}
    </div>
  );
}

export default function ShowsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isAddTypeDialogOpen, setIsAddTypeDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isEditPromptDialogOpen, setIsEditPromptDialogOpen] = useState(false);
  const [promptAnalysis, setPromptAnalysis] = useState<{
    urls: { url: string; status: string; contentLength: number; preview: string }[];
    speaker: string | null;
    hasEpisodeContent: boolean;
    totalContentLength: number;
    expandedPrompt: string;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [editingType, setEditingType] = useState<ProgramType | null>(null);
  const [settingsType, setSettingsType] = useState<ProgramType | null>(null);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeSlug, setNewTypeSlug] = useState("");
  const [newTypeDescription, setNewTypeDescription] = useState("");
  const [newTypePrompt, setNewTypePrompt] = useState("");
  const [newTypeDailyCount, setNewTypeDailyCount] = useState(1);
  const [playingProgramId, setPlayingProgramId] = useState<string | null>(null);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioPlaybackRate, setAudioPlaybackRate] = usePlaybackRate(1);
  const [slotInputs, setSlotInputs] = useState<string[]>([]);
  const [firecrawlTopicInput, setFirecrawlTopicInput] = useState("");
  const [firecrawlTestResult, setFirecrawlTestResult] = useState<string | null>(null);
  const [firecrawlTesting, setFirecrawlTesting] = useState(false);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [batchUrl, setBatchUrl] = useState("");
  const [batchText, setBatchText] = useState("");
  const [batchMode, setBatchMode] = useState<"url" | "text">("text");
  const [batchCount, setBatchCount] = useState(10);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchResult, setBatchResult] = useState<{ created: number; total: number; errors: string[] } | null>(null);
  const [batchProgress, setBatchProgress] = useState(0);
  // Import of ready-made (client-approved) scripts — no AI generation.
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importText, setImportText] = useState("");
  const [importParsing, setImportParsing] = useState(false);
  const [importEpisodes, setImportEpisodes] = useState<{ number: number; title: string; scriptText: string; words: number }[] | null>(null);
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());
  const [importCreating, setImportCreating] = useState(false);
  const [viewScriptProgram, setViewScriptProgram] = useState<Program | null>(null);
  const [editingBlocks, setEditingBlocks] = useState<{ text: string; speaker: string }[] | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [savingScript, setSavingScript] = useState(false);
  const [generatingTypeIds, setGeneratingTypeIds] = useState<Set<string>>(new Set());
  const [pipelineTypeIds, setPipelineTypeIds] = useState<Set<string>>(new Set());
  const [audioQueue, setAudioQueue] = useState<string[]>([]);
  const [generatingAudioId, setGeneratingAudioId] = useState<string | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<Set<string>>(new Set());
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [programFilter, setProgramFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isolatingId, setIsolatingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    setPlayingProgramId(null);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, []);

  const { data: appSettings } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: voices } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const stationName = appSettings?.stationName || t("shows.stationDefault");
  const defaultProgramTypes = getDefaultProgramTypes(stationName, t);

  const { data: programTypes, isLoading: isLoadingTypes } = useQuery<ProgramType[]>({
    queryKey: ["/api/program-types"],
  });

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderProgramTypesMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      return apiRequest("POST", "/api/program-types/reorder", { orderedIds });
    },
    onError: () => {
      toast({
        description: t("shows.reorderError", { defaultValue: "Couldn't save tab order" }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
    },
  });

  const handleProgramTypeDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = programTypes ?? [];
    const oldIndex = current.findIndex((t) => t.id === active.id);
    const newIndex = current.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(current, oldIndex, newIndex).map((t, i) => ({ ...t, sortOrder: i }));
    queryClient.setQueryData<ProgramType[]>(["/api/program-types"], reordered);
    reorderProgramTypesMutation.mutate(reordered.map((t) => t.id));
  };

  const { data: programs, isLoading: isLoadingPrograms } = useQuery<Program[]>({
    queryKey: ["/api/programs", activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/programs?typeId=${activeTab}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!activeTab,
  });

  const allTypePrograms = programs?.filter(p => p.programTypeId === activeTab) || [];
  const filteredPrograms = allTypePrograms.filter(p => {
    if (statusFilter !== "all") {
      if (statusFilter === "script_ready" && p.status !== "script_ready") return false;
      if (statusFilter === "ready" && p.status !== "ready") return false;
      if (statusFilter === "pending" && p.status !== "pending") return false;
      if (statusFilter === "no_audio" && p.audioUrl) return false;
      if (statusFilter === "has_audio" && !p.audioUrl) return false;
    }
    if (programFilter.trim()) {
      const q = programFilter.toLowerCase();
      const titleMatch = p.title?.toLowerCase().includes(q);
      const scriptMatch = p.scriptText?.toLowerCase().includes(q);
      const dateMatch = p.scheduledDate?.includes(q);
      if (!titleMatch && !scriptMatch && !dateMatch) return false;
    }
    return true;
  });
  const today = new Date().toISOString().split("T")[0];
  const todayPrograms = allTypePrograms.filter(p => p.scheduledDate === today);

  const createTypeMutation = useMutation({
    mutationFn: async (data: { name: string; slug: string; description: string; defaultPrompt: string; dailyCount?: number; slotDescriptions?: string[] }) => {
      const response = await apiRequest("POST", "/api/program-types", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
      setIsAddTypeDialogOpen(false);
      resetNewTypeForm();
      toast({ title: t("shows.typeCreated") });
    },
    onError: (error: Error) => {
      toast({ title: t("shows.error"), description: error.message, variant: "destructive" });
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
      toast({ title: t("shows.settingsUpdated") });
    },
    onError: (error: Error) => {
      toast({ title: t("shows.error"), description: error.message, variant: "destructive" });
    },
  });

  const autoCreateMutation = useMutation({
    mutationFn: async ({ typeId, scheduledDate, forecastDays }: { typeId: string; scheduledDate?: string; forecastDays?: number }) => {
      setGeneratingTypeIds(prev => new Set(prev).add(typeId));
      const body: Record<string, any> = {};
      if (scheduledDate) body.scheduledDate = scheduledDate;
      if (forecastDays) body.forecastDays = forecastDays;
      const response = await apiRequest("POST", `/api/programs/auto-create/${typeId}`, body);
      return { data: await response.json(), typeId };
    },
    onSuccess: ({ data, typeId }) => {
      setGeneratingTypeIds(prev => { const next = new Set(prev); next.delete(typeId); return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/programs", typeId] });
      toast({ title: t("shows.programCreated"), description: data.title });
    },
    onError: (error: Error, { typeId }) => {
      setGeneratingTypeIds(prev => { const next = new Set(prev); next.delete(typeId); return next; });
      toast({ title: t("shows.error"), description: error.message, variant: "destructive" });
    },
  });

  const pipelineMutation = useMutation({
    mutationFn: async ({ typeId, count }: { typeId: string; count: number }) => {
      setPipelineTypeIds(prev => new Set(prev).add(typeId));
      const response = await apiRequest("POST", `/api/programs/${typeId}/auto-pipeline`, { count });
      return { data: await response.json(), typeId };
    },
    onSuccess: ({ data, typeId }) => {
      setPipelineTypeIds(prev => { const next = new Set(prev); next.delete(typeId); return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/programs", typeId] });
      toast({ title: t("shows.pipelineCompleted"), description: t("shows.pipelineResult", { succeeded: data.succeeded, total: data.total }) });
    },
    onError: (error: Error, { typeId }) => {
      setPipelineTypeIds(prev => { const next = new Set(prev); next.delete(typeId); return next; });
      toast({ title: t("shows.pipelineErrorMsg"), description: error.message, variant: "destructive" });
    },
  });

  const isProcessingRef = useRef(false);

  const enqueueAudio = useCallback((id: string) => {
    if (audioQueueRef.current.includes(id) || generatingAudioId === id) return;
    audioQueueRef.current = [...audioQueueRef.current, id];
    setAudioQueue(prev => [...prev, id]);

    if (!isProcessingRef.current) {
      isProcessingRef.current = true;
      const run = async () => {
        while (audioQueueRef.current.length > 0) {
          const nextId = audioQueueRef.current[0];
          setGeneratingAudioId(nextId);
          try {
            const response = await apiRequest("POST", `/api/programs/${nextId}/generate-audio`);
            const data = await response.json();
            queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
            setViewScriptProgram(prev => {
              if (prev && data?.id === prev.id) {
                return { ...prev, status: "ready", audioUrl: data.audioUrl };
              }
              return prev;
            });
            toast({ title: t("shows.audioGenerated"), description: data?.title || "" });
          } catch (error: any) {
            toast({ title: t("shows.audioError"), description: error.message, variant: "destructive" });
          }
          audioQueueRef.current = audioQueueRef.current.filter(qId => qId !== nextId);
          setAudioQueue(prev => prev.filter(qId => qId !== nextId));
        }
        setGeneratingAudioId(null);
        isProcessingRef.current = false;
      };
      run();
    }
  }, [activeTab]);

  const generateScriptMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/programs/${id}/generate`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: t("shows.scriptGenerated") });
    },
    onError: (error: Error) => {
      toast({ title: t("shows.error"), description: error.message, variant: "destructive" });
    },
  });

  const deleteProgramMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/programs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: t("shows.programDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: t("shows.error"), description: error.message, variant: "destructive" });
    },
  });

  const voiceIsolateMutation = useMutation({
    mutationFn: async (id: string) => {
      setIsolatingId(id);
      const response = await apiRequest("POST", `/api/programs/${id}/voice-isolate`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: t("shows.voiceIsolated"), description: t("shows.noiseRemoved") });
      setIsolatingId(null);
    },
    onError: (error: Error) => {
      toast({ title: t("shows.voiceIsolateError"), description: error.message, variant: "destructive" });
      setIsolatingId(null);
    },
  });

  const deleteTypeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/program-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/program-types"] });
      setActiveTab(null);
      toast({ title: t("shows.typeDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: t("shows.error"), description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!activeTab && programTypes && programTypes.length > 0) {
      setActiveTab(programTypes[0].id);
    }
  }, [activeTab, programTypes]);

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
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    if (playingProgramId === programId) {
      stopAudio();
      return;
    }
    const filename = audioUrl.startsWith("/audio/") ? audioUrl.slice(7) : audioUrl.replace(/^audio\//, "");
    const streamUrl = `/api/stream-audio/${encodeURIComponent(filename)}`;
    const audio = new Audio(streamUrl);
    audioRef.current = audio;
    audio.playbackRate = audioPlaybackRate;
    audio.ontimeupdate = () => {
      setAudioCurrentTime(audio.currentTime);
    };
    audio.onloadedmetadata = () => {
      setAudioDuration(audio.duration);
    };
    audio.onended = () => stopAudio();
    audio.onerror = (e) => {
      console.error("Audio playback error:", streamUrl, audio.error?.message || audio.error?.code || e);
      toast({
        title: t("shows.error"),
        description: t("shows.audioPlaybackError", "Audio file could not be played"),
        variant: "destructive",
      });
      stopAudio();
    };
    audio.play().catch((err) => {
      console.error("Audio play() failed:", streamUrl, err);
      toast({
        title: t("shows.error"),
        description: err.message || t("shows.audioPlaybackError", "Audio file could not be played"),
        variant: "destructive",
      });
      stopAudio();
    });
    setPlayingProgramId(programId);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  };

  const seekAudio = (value: number[]) => {
    if (audioRef.current && isFinite(value[0])) {
      audioRef.current.currentTime = value[0];
      setAudioCurrentTime(value[0]);
    }
  };

  const setPlaybackRate = (rate: number) => {
    setAudioPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    return () => { stopAudio(); };
  }, [stopAudio]);

  useEffect(() => {
    stopAudio();
  }, [activeTab, statusFilter, stopAudio]);

  const showsStatusHints: Record<string, string> = {
    pending: t("hints.shows.statusPending"),
    script_ready: t("hints.shows.statusScriptReady"),
    ready: t("hints.shows.statusReady"),
    error: t("hints.shows.statusError"),
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { labelKey: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
      pending: { labelKey: "shows.statusPending", variant: "outline" },
      script_ready: { labelKey: "shows.statusScriptReady", variant: "secondary" },
      ready: { labelKey: "shows.statusReady", variant: "default" },
      error: { labelKey: "shows.statusError", variant: "destructive" },
    };
    const config = variants[status] || variants.pending;
    const hint = showsStatusHints[status] || showsStatusHints.pending;
    return <HintTooltip hint={hint}><span><Badge variant={config.variant}>{t(config.labelKey)}</Badge></span></HintTooltip>;
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

  const hasFormattedSpeakers = (text: string) => {
    const matches = text.match(/^\[([^\]]+)\]:/gm);
    return !!matches && matches.length >= 1;
  };

  const isMultiSpeaker = (text: string) => {
    const matches = text.match(/^\[([^\]]+)\]:/gm);
    if (!matches || matches.length < 1) return false;
    const uniqueSpeakers = new Set(matches.map(m => m.replace(/[\[\]:]/g, "")));
    return uniqueSpeakers.size >= 2;
  };

  const EMOTION_TAGS = ["energetic", "fast", "slow", "surprised", "thoughtful", "happy", "sad", "exclaims", "announcer", "serious", "calm", "excited", "warm", "dramatic", "whisper", "loud", "gentle", "playful", "confident"];
  const tagPattern = new RegExp(`^\\s*\\[(${EMOTION_TAGS.join("|")})\\]`, "i");

  const parseScriptToBlocks = (scriptText: string): { text: string; speaker: string }[] => {
    if (hasFormattedSpeakers(scriptText)) {
      const blocks: { text: string; speaker: string }[] = [];
      let currentSpeaker = "";
      let currentText = "";
      for (const line of scriptText.split("\n")) {
        const match = line.match(/^\s*\[([^\]]+)\]:\s*(.*)/);
        if (match) {
          if (currentText.trim()) {
            blocks.push({ text: currentText.trim(), speaker: currentSpeaker });
          }
          currentSpeaker = match[1];
          currentText = match[2] + "\n";
        } else {
          currentText += line + "\n";
        }
      }
      if (currentText.trim()) {
        blocks.push({ text: currentText.trim(), speaker: currentSpeaker });
      }
      return blocks;
    }

    const blocks: { text: string; speaker: string }[] = [];
    let currentText = "";
    const lines = scriptText.split("\n");

    for (const line of lines) {
      if (tagPattern.test(line)) {
        if (currentText.trim()) {
          blocks.push({ text: currentText.trim(), speaker: "" });
        }
        currentText = line + "\n";
      } else if (line.trim() === "") {
        currentText += "\n";
      } else {
        currentText += line + "\n";
      }
    }
    if (currentText.trim()) {
      blocks.push({ text: currentText.trim(), speaker: "" });
    }

    if (blocks.length === 0) {
      return [{ text: scriptText.trim(), speaker: "" }];
    }
    return blocks;
  };

  const blocksToScript = (blocks: { text: string; speaker: string }[]): string => {
    return blocks
      .map(b => b.speaker ? `[${b.speaker}]: ${b.text}` : b.text)
      .join("\n\n");
  };

  const startEditingScript = () => {
    if (!viewScriptProgram?.scriptText) return;
    const blocks = parseScriptToBlocks(viewScriptProgram.scriptText);
    setEditingBlocks(blocks);
  };

  const saveEditedScript = async () => {
    if (!viewScriptProgram || !editingBlocks) return;
    setSavingScript(true);
    try {
      const newScript = blocksToScript(editingBlocks);
      await apiRequest("PATCH", `/api/programs/${viewScriptProgram.id}`, {
        scriptText: newScript,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      setViewScriptProgram({ ...viewScriptProgram, scriptText: newScript });
      setEditingBlocks(null);
      toast({ title: t("shows.scriptSaved"), description: t("shows.speakersUpdated") });
    } catch (err) {
      toast({ title: t("shows.error"), description: t("shows.saveFailed"), variant: "destructive" });
    } finally {
      setSavingScript(false);
    }
  };

  const saveEditedText = async () => {
    if (!viewScriptProgram || editingText === null) return;
    setSavingScript(true);
    try {
      await apiRequest("PATCH", `/api/programs/${viewScriptProgram.id}`, {
        scriptText: editingText,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      setViewScriptProgram({ ...viewScriptProgram, scriptText: editingText });
      setEditingText(null);
      toast({ title: t("shows.scriptSaved") });
    } catch (err) {
      toast({ title: t("shows.error"), description: t("shows.saveFailed"), variant: "destructive" });
    } finally {
      setSavingScript(false);
    }
  };

  const getAssignedVoicesForType = (typeId: string) => {
    const assigned = voices?.filter(v => v.isActive && v.assignedProgramTypeIds?.includes(typeId)) || [];
    if (assigned.length > 0) return assigned;
    return voices?.filter(v => v.isActive) || [];
  };

  const openSettingsDialog = (type: ProgramType) => {
    setSettingsType({ ...type });
    setSlotInputs(type.slotDescriptions || []);
    setFirecrawlTopicInput("");
    setFirecrawlTestResult(null);
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
        name: settingsType.name,
        description: settingsType.description || "",
        dailyCount: settingsType.dailyCount,
        slotDescriptions: slotInputs.filter(s => s.trim()),
        sponsorName: settingsType.sponsorName,
        sponsorText: settingsType.sponsorText,
        assignedVoiceIds: voiceIdsFromAssignment,
        defaultDurationSeconds: settingsType.defaultDurationSeconds,
        autoGenerate: settingsType.autoGenerate || false,
        weeklyCount: settingsType.weeklyCount || 7,
        autoVoice: settingsType.autoVoice !== false,
        autoIsolate: settingsType.autoIsolate || false,
        autoUpload: settingsType.autoUpload !== false,
        uploadFolder: settingsType.uploadFolder || null,
        scheduleDays: settingsType.scheduleDays || [],
        scheduleTime: settingsType.scheduleTime || "09:00",
        fileNameTemplate: settingsType.fileNameTemplate || "",
        scriptTemplate: settingsType.scriptTemplate || "",
        useFirecrawl: settingsType.useFirecrawl || false,
        firecrawlTopics: settingsType.firecrawlTopics || [],
        isWeatherForecast: settingsType.isWeatherForecast || false,
        defaultForecastDays: settingsType.defaultForecastDays || 1,
        promptIsExactScript: settingsType.promptIsExactScript || false,
        useSeasonalContext: settingsType.useSeasonalContext || false,
        researchProfile: settingsType.researchProfile || "local",
      },
    });
  };

  const startBatchGeneration = async () => {
    if (!activeTab) return;
    setBatchGenerating(true);
    setBatchResult(null);
    setBatchProgress(0);
    try {
      const results: { created: number; total: number; errors: string[] } = { created: 0, total: batchCount, errors: [] };

      const activeType = programTypes?.find(p => p.id === activeTab);
      const batchBody: Record<string, any> = {};
      if (activeType?.isWeatherForecast) {
        batchBody.forecastDays = Math.min(7, Math.max(1, activeType.defaultForecastDays || 1));
      }

      for (let i = 0; i < batchCount; i++) {
        setBatchProgress(i + 1);
        try {
          const response = await apiRequest("POST", `/api/programs/auto-create/${activeTab}`, batchBody);
          await response.json();
          results.created++;
        } catch (err: any) {
          results.errors.push(`#${i + 1}: ${err.message || t("shows.error")}`);
        }
      }

      setBatchResult(results);
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ 
        title: t("shows.batchDone"), 
        description: t("shows.batchCreated", { created: results.created, total: results.total }),
      });
    } catch (error) {
      toast({ title: t("shows.error"), description: error instanceof Error ? error.message : t("shows.errorGeneric"), variant: "destructive" });
    } finally {
      setBatchGenerating(false);
      setBatchProgress(0);
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

  const resetImportDialog = () => {
    setImportFile(null);
    setImportText("");
    setImportEpisodes(null);
    setImportSelected(new Set());
    setImportParsing(false);
    setImportCreating(false);
  };

  const parseImport = async () => {
    if (!activeTab) return;
    setImportParsing(true);
    try {
      let res: Response;
      if (importFile) {
        const fd = new FormData();
        fd.append("file", importFile);
        res = await fetch(`/api/program-types/${activeTab}/parse-scripts`, {
          method: "POST",
          body: fd,
          credentials: "include",
        });
      } else {
        res = await fetch(`/api/program-types/${activeTab}/parse-scripts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: importText }),
          credentials: "include",
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      const data = await res.json();
      setImportEpisodes(data.episodes);
      setImportSelected(new Set(data.episodes.map((_: unknown, i: number) => i)));
    } catch (e: any) {
      toast({ title: t("shows.importParseFailed"), description: e.message, variant: "destructive" });
    } finally {
      setImportParsing(false);
    }
  };

  const createImported = async () => {
    if (!activeTab || !importEpisodes) return;
    const episodes = importEpisodes
      .filter((_, i) => importSelected.has(i))
      .map(e => ({ title: e.title, scriptText: e.scriptText }));
    if (episodes.length === 0) return;
    setImportCreating(true);
    try {
      const res = await apiRequest("POST", `/api/program-types/${activeTab}/import-scripts`, { episodes });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/programs", activeTab] });
      toast({ title: t("shows.importDone"), description: t("shows.importCreated", { count: data.created }) });
      setIsImportDialogOpen(false);
      resetImportDialog();
    } catch (e: any) {
      toast({ title: t("shows.importFailed"), description: e.message, variant: "destructive" });
    } finally {
      setImportCreating(false);
    }
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
            <CardTitle>{t("shows.noTypes")}</CardTitle>
            <CardDescription>
              {t("shows.noTypeDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <HintTooltip hint={t("hints.shows.seedTypes")}>
              <Button onClick={seedDefaultTypes} disabled={createTypeMutation.isPending} data-testid="button-seed-types">
                {createTypeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("shows.creating")}
                  </>
                ) : (
                  t("shows.createDefaultTypes")
                )}
              </Button>
            </HintTooltip>
            <span className="text-sm text-muted-foreground">{t("shows.or")}</span>
            <HintTooltip hint={t("hints.shows.createCustomType")}>
              <Button variant="outline" onClick={() => setIsAddTypeDialogOpen(true)} data-testid="button-create-custom-type">
                <Plus className="mr-2 h-4 w-4" />
                {t("shows.createCustomType")}
              </Button>
            </HintTooltip>
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
            <DialogTitle>{t("shows.newTypeTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("shows.typeName")}</Label>
              <div className="flex gap-1">
                <Input
                  placeholder={t("shows.namePlaceholder")}
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
              <Label>{t("shows.slugForUrl")}</Label>
              <Input
                placeholder="weather"
                value={newTypeSlug}
                onChange={(e) => setNewTypeSlug(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("shows.typeDescription")}</Label>
              <div className="flex gap-1">
                <Input
                  placeholder={t("shows.briefDescription")}
                  value={newTypeDescription}
                  onChange={(e) => setNewTypeDescription(e.target.value)}
                  className="flex-1"
                />
                <VoiceInput onTranscript={(text) => setNewTypeDescription(prev => prev + text)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("shows.episodesPerDay")}</Label>
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
              <Label>{t("shows.promptDefault")}</Label>
              <div className="flex gap-1 items-start">
                <Textarea
                  placeholder={t("shows.promptPlaceholder")}
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
              {t("shows.cancel")}
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
              {t("shows.create")}
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
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("shows.title")}</h1>
          <p className="text-muted-foreground">{t("shows.subtitle")}</p>
        </div>
      </div>

      <Tabs value={activeTab || ""} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleProgramTypeDragEnd}
          >
            <SortableContext
              items={(programTypes ?? []).map((t) => t.id)}
              strategy={horizontalListSortingStrategy}
            >
              <TabsList className="flex-wrap">
                {programTypes?.map((type) => {
                  const Icon = type.icon ? iconMap[type.icon] || Radio : Radio;
                  return (
                    <SortableProgramTypeTab key={type.id} id={type.id}>
                      <TabsTrigger value={type.id} className="gap-2" data-testid={`tab-${type.slug}`}>
                        <Icon className="h-4 w-4" />
                        {type.name}
                      </TabsTrigger>
                    </SortableProgramTypeTab>
                  );
                })}
              </TabsList>
            </SortableContext>
          </DndContext>
          <HintTooltip hint={t("hints.shows.addType")}>
            <Button variant="outline" size="sm" onClick={() => setIsAddTypeDialogOpen(true)} data-testid="button-add-type">
              <Plus className="mr-2 h-4 w-4" />
              {t("shows.newType")}
            </Button>
          </HintTooltip>
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
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <CardTitle className="flex items-center gap-2">
                        <Icon className="h-5 w-5" />
                        {type.name}
                      </CardTitle>
                      <CardDescription>{type.description}</CardDescription>
                      <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground pt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {t("shows.todayOf", { count: typeTodayCount, total: typeDaily })}
                        </span>
                        {type.sponsorName && (
                          <span className="flex items-center gap-1">
                            <Megaphone className="h-3.5 w-3.5" />
                            {t("shows.sponsor", { name: type.sponsorName })}
                          </span>
                        )}
                        {currentSlotDesc && typeCanCreate && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {t("shows.next", { desc: currentSlotDesc.length > 50 ? currentSlotDesc.substring(0, 50) + "..." : currentSlotDesc })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <HintTooltip hint={t("hints.shows.editPrompt")}>
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
                          {t("shows.prompt")}
                        </Button>
                      </HintTooltip>
                      <HintTooltip hint={t("hints.shows.typeSettings")}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openSettingsDialog(type)}
                          data-testid="button-type-settings"
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          {t("shows.settings")}
                        </Button>
                      </HintTooltip>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t mt-3">
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/30">
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{t("shows.manual")}</span>
                      <div className="flex items-center gap-1.5">
                        <HintTooltip hint={t("hints.shows.autoCreate")}>
                          <Button
                            size="sm"
                            onClick={() => autoCreateMutation.mutate({ typeId: type.id })}
                            disabled={generatingTypeIds.has(type.id)}
                            data-testid="button-auto-create"
                          >
                            {generatingTypeIds.has(type.id) ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                              <Zap className="mr-1.5 h-4 w-4" />
                            )}
                            {t("shows.script")}
                          </Button>
                        </HintTooltip>
                        <ScheduleScriptPopover
                          type={type}
                          disabled={generatingTypeIds.has(type.id)}
                          onGenerate={(scheduledDate, forecastDays) =>
                            autoCreateMutation.mutate({ typeId: type.id, scheduledDate, forecastDays })
                          }
                        />
                        <HintTooltip hint={t("hints.shows.batchCreate")}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              resetBatchDialog();
                              setIsBatchDialogOpen(true);
                            }}
                            data-testid="button-batch-create"
                          >
                            <PackagePlus className="mr-1.5 h-4 w-4" />
                            {t("shows.batch")}
                          </Button>
                        </HintTooltip>
                        <HintTooltip hint={t("hints.shows.importScripts")}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              resetImportDialog();
                              setIsImportDialogOpen(true);
                            }}
                            data-testid="button-import-scripts"
                          >
                            <FileUp className="mr-1.5 h-4 w-4" />
                            {t("shows.import")}
                          </Button>
                        </HintTooltip>
                        {selectedPrograms.size > 0 && (
                          <HintTooltip hint={t("hints.shows.bulkVoice")}>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const toVoice = filteredPrograms
                                  .filter(p => selectedPrograms.has(p.id) && p.scriptText && (p.status === "script_ready" || p.audioUrl))
                                  .map(p => p.id);
                                toVoice.forEach(id => enqueueAudio(id));
                                setSelectedPrograms(new Set());
                              }}
                              data-testid="button-bulk-voice"
                            >
                              <Volume2 className="mr-1.5 h-4 w-4" />
                              {t("shows.voiceSelected", { count: selectedPrograms.size })}
                            </Button>
                          </HintTooltip>
                        )}
                      </div>
                    </div>

                    {type.autoGenerate && (
                      <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2 bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-xs font-medium text-green-700 dark:text-green-400">{t("shows.auto")}</span>
                        </div>
                        <span className="text-xs text-green-600 dark:text-green-400 leading-relaxed">
                          {type.scheduleDays && type.scheduleDays.length > 0
                            ? `${type.scheduleDays.map((d: number) => [t("shows.daySun"),t("shows.dayMon"),t("shows.dayTue"),t("shows.dayWed"),t("shows.dayThu"),t("shows.dayFri"),t("shows.daySat")][d]).join(", ")} ${type.scheduleTime || "09:00"}`
                            : t("shows.dailyAt", { time: type.scheduleTime || "09:00" })
                          }
                          {" · "}{type.weeklyCount || 7}{t("shows.perWeek")}
                          {type.autoVoice !== false && ` · ${t("shows.voice")}`}
                          {type.autoIsolate && ` · ${t("shows.denoise")}`}
                          {type.autoUpload !== false && ` · ${t("shows.upload")}`}
                        </span>
                        <HintTooltip hint={t("hints.shows.runPipeline")}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900"
                            onClick={() => pipelineMutation.mutate({ typeId: type.id, count: Math.ceil((type.weeklyCount || 7) / 7) })}
                            disabled={pipelineTypeIds.has(type.id)}
                            data-testid="button-run-pipeline"
                          >
                            {pipelineTypeIds.has(type.id) ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Zap className="mr-1 h-3.5 w-3.5" />
                            )}
                            {t("shows.run")}
                          </Button>
                        </HintTooltip>
                      </div>
                    )}
                  </div>
                </CardHeader>
              </Card>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("shows.searchPlaceholder")}
                    value={programFilter}
                    onChange={(e) => setProgramFilter(e.target.value)}
                    className="pl-9 h-9"
                    data-testid="input-program-filter"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <HintTooltip hint={t("hints.shows.statusFilter")}>
                    <SelectTrigger className="w-[180px] h-9" data-testid="select-status-filter">
                      <Filter className="h-3.5 w-3.5 mr-1.5" />
                      <SelectValue />
                    </SelectTrigger>
                  </HintTooltip>
                  <SelectContent>
                    <SelectItem value="all">{t("shows.allStatuses")}</SelectItem>
                    <SelectItem value="pending">{t("shows.noScript")}</SelectItem>
                    <SelectItem value="script_ready">{t("shows.statusScriptReady")}</SelectItem>
                    <SelectItem value="no_audio">{t("shows.noAudio")}</SelectItem>
                    <SelectItem value="has_audio">{t("shows.hasAudio")}</SelectItem>
                    <SelectItem value="ready">{t("shows.statusReady")}</SelectItem>
                  </SelectContent>
                </Select>
                {(programFilter || statusFilter !== "all") && (
                  <HintTooltip hint={t("hints.shows.clearFilter")}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setProgramFilter(""); setStatusFilter("all"); }}
                      data-testid="button-clear-filter"
                    >
                      <XCircle className="h-4 w-4 mr-1" /> {t("shows.reset")}
                    </Button>
                  </HintTooltip>
                )}
                <span className="text-xs text-muted-foreground">{t("shows.ofTotal", { count: filteredPrograms.length, total: allTypePrograms.length })}</span>
              </div>

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
                    <p className="text-muted-foreground">{t("shows.noShows")}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t("shows.noShowsHint")}
                    </p>
                  </CardContent>
                </Card>
              ) : (() => {
                const grouped = filteredPrograms.reduce<Record<string, Program[]>>((acc, p) => {
                  const date = p.scheduledDate || t("shows.noDate");
                  if (!acc[date]) acc[date] = [];
                  acc[date].push(p);
                  return acc;
                }, {});
                const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

                return (
                <div className="space-y-2">
                  {sortedDates.map(date => {
                    const datePrograms = grouped[date];
                    const isCollapsed = collapsedDates.has(date);
                    const allSelected = datePrograms.every(p => selectedPrograms.has(p.id));
                    const someSelected = datePrograms.some(p => selectedPrograms.has(p.id));

                    return (
                      <div key={date}>
                        <div
                          className="flex items-center gap-2 py-2 px-1 cursor-pointer hover:bg-muted/50 rounded-md"
                          onClick={() => setCollapsedDates(prev => {
                            const next = new Set(prev);
                            if (next.has(date)) next.delete(date); else next.add(date);
                            return next;
                          })}
                          data-testid={`date-group-${date}`}
                        >
                          <Checkbox
                            checked={allSelected ? true : someSelected ? "indeterminate" : false}
                            onCheckedChange={(checked) => {
                              setSelectedPrograms(prev => {
                                const next = new Set(prev);
                                datePrograms.forEach(p => {
                                  if (checked) next.add(p.id); else next.delete(p.id);
                                });
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`checkbox-date-${date}`}
                          />
                          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          <span className="text-sm font-medium">{date}</span>
                          <Badge variant="outline" className="text-xs">{datePrograms.length}</Badge>
                        </div>
                        {!isCollapsed && (
                          <div className="space-y-2 ml-2">
                            {datePrograms.map((program) => (
                    <Card key={program.id}>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <Checkbox
                              checked={selectedPrograms.has(program.id)}
                              onCheckedChange={(checked) => {
                                setSelectedPrograms(prev => {
                                  const next = new Set(prev);
                                  if (checked) next.add(program.id); else next.delete(program.id);
                                  return next;
                                });
                              }}
                              data-testid={`checkbox-program-${program.id}`}
                            />
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
                                {hasFormattedSpeakers(program.scriptText) ? (
                                  <div className="flex items-center gap-1.5">
                                    {isMultiSpeaker(program.scriptText) ? (
                                      <Users className="h-3.5 w-3.5 text-violet-500" />
                                    ) : (
                                      <User className="h-3.5 w-3.5 text-violet-500" />
                                    )}
                                    <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">
                                      {isMultiSpeaker(program.scriptText) ? t("shows.multiSpeaker") : t("shows.singleSpeaker")}
                                    </span>
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
                            {(program.audioDurationSeconds || program.scriptGeneratedAt || program.audioGeneratedAt) && (
                              <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-muted-foreground">
                                {program.audioDurationSeconds != null && (
                                  <span className="inline-flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded font-medium" data-testid={`text-duration-${program.id}`}>
                                    🔊 {Math.floor(program.audioDurationSeconds / 60)}:{String(Math.round(program.audioDurationSeconds % 60)).padStart(2, "0")}
                                  </span>
                                )}
                                {program.scriptGeneratedAt && (
                                  <span data-testid={`text-script-time-${program.id}`}>
                                    📝 {new Date(program.scriptGeneratedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                                {program.audioGeneratedAt && (
                                  <span data-testid={`text-audio-time-${program.id}`}>
                                    🎙 {new Date(program.audioGeneratedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {program.status === "pending" && (
                              <HintTooltip hint={t("hints.shows.generateScript")}>
                                <Button
                                  size="sm"
                                  onClick={() => generateScriptMutation.mutate(program.id)}
                                  disabled={generateScriptMutation.isPending}
                                  data-testid={`button-generate-script-${program.id}`}
                                >
                                  {generateScriptMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    t("shows.generateScriptBtn")
                                  )}
                                </Button>
                              </HintTooltip>
                            )}
                            {program.scriptText && (
                              <HintTooltip hint={t("hints.shows.viewScript")}>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setViewScriptProgram(program)}
                                  data-testid={`button-view-script-${program.id}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </HintTooltip>
                            )}
                            {(program.status === "script_ready" || program.audioUrl) && (
                              <HintTooltip hint={t("hints.shows.generateAudio")}>
                                <Button
                                  size="sm"
                                  variant={program.audioUrl ? "outline" : "default"}
                                  onClick={() => enqueueAudio(program.id)}
                                  disabled={generatingAudioId === program.id || audioQueue.includes(program.id)}
                                  data-testid={`button-generate-audio-${program.id}`}
                                >
                                  {generatingAudioId === program.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : audioQueue.includes(program.id) ? (
                                    <>{t("shows.inQueue", { pos: audioQueue.indexOf(program.id) + 1 })}</>
                                  ) : program.audioUrl ? (
                                    t("shows.revoice")
                                  ) : (
                                    t("shows.voiceBtn")
                                  )}
                                </Button>
                              </HintTooltip>
                            )}
                            {program.audioUrl && (
                              <>
                                <HintTooltip hint={t("hints.shows.playAudio")}>
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
                                </HintTooltip>
                                <HintTooltip hint={t("hints.shows.downloadAudio")}>
                                  <a href={`/api/programs/${program.id}/download-audio`} download>
                                    <Button size="icon" variant="outline" data-testid={`button-download-${program.id}`}>
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  </a>
                                </HintTooltip>
                                <HintTooltip hint={t("hints.shows.isolateVoice")}>
                                  <Button
                                    size="icon"
                                    variant={program.audioUrl?.includes("_isolated") ? "default" : "outline"}
                                    className={program.audioUrl?.includes("_isolated") ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                                    onClick={() => voiceIsolateMutation.mutate(program.id)}
                                    disabled={isolatingId === program.id}
                                    data-testid={`button-isolate-${program.id}`}
                                  >
                                    {isolatingId === program.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <AudioLines className="h-4 w-4" />
                                    )}
                                  </Button>
                                </HintTooltip>
                              </>
                            )}
                            <AlertDialog>
                              <HintTooltip hint={t("hints.shows.deleteProgram")}>
                                <AlertDialogTrigger asChild>
                                  <Button size="icon" variant="ghost" data-testid={`button-delete-${program.id}`}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                              </HintTooltip>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t("shows.deleteProgram")}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("shows.deleteIrreversible")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("shows.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteProgramMutation.mutate(program.id)}
                                  >
                                    {t("shows.delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                        {playingProgramId === program.id && (
                          <div className="mt-3 flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2" data-testid={`audio-player-${program.id}`}>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0"
                              onClick={() => stopAudio()}
                              data-testid={`button-stop-${program.id}`}
                            >
                              <Pause className="h-4 w-4" />
                            </Button>
                            <span className="text-xs text-muted-foreground w-10 shrink-0 text-right tabular-nums" data-testid={`text-current-time-${program.id}`}>
                              {formatTime(audioCurrentTime)}
                            </span>
                            <Slider
                              value={[audioCurrentTime]}
                              max={audioDuration || 1}
                              step={0.5}
                              onValueChange={seekAudio}
                              className="flex-1"
                              data-testid={`slider-seek-${program.id}`}
                            />
                            <span className="text-xs text-muted-foreground w-10 shrink-0 tabular-nums" data-testid={`text-duration-${program.id}`}>
                              {formatTime(audioDuration)}
                            </span>
                            <div className="flex border rounded-md overflow-hidden shrink-0 h-7">
                              {[1, 1.5, 2].map((speed) => (
                                <button
                                  key={speed}
                                  type="button"
                                  className={`px-2 text-xs font-medium transition-colors ${
                                    audioPlaybackRate === speed
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-background hover:bg-muted text-muted-foreground"
                                  }`}
                                  onClick={() => setPlaybackRate(speed)}
                                  data-testid={`button-speed-${speed}x-${program.id}`}
                                >
                                  {speed}x
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </TabsContent>
          );
        })}
      </Tabs>

      {renderAddTypeDialog()}

      <Dialog open={isEditPromptDialogOpen} onOpenChange={(open) => {
        setIsEditPromptDialogOpen(open);
        if (!open) setPromptAnalysis(null);
      }}>
        <DialogContent className="!w-[min(52rem,calc(100vw-2rem))] !max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("shows.editPromptTitle", { name: editingType?.name })}</DialogTitle>
            <DialogDescription>
              {t("shows.editPromptDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="flex gap-1 items-start">
              <Textarea
                value={editingType?.defaultPrompt || ""}
                onChange={(e) => {
                  setEditingType(prev => prev ? { ...prev, defaultPrompt: e.target.value } : null);
                  setPromptAnalysis(null);
                }}
                rows={12}
                className="font-mono text-sm flex-1"
                data-testid="textarea-prompt"
              />
              <VoiceInput onTranscript={(text) => setEditingType(prev => prev ? { ...prev, defaultPrompt: prev.defaultPrompt + " " + text } : null)} />
            </div>
            {hasLengthConstraintInPrompt(editingType?.defaultPrompt || "") && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-length-constraint-hint-edit-prompt"
              >
                <span className="font-medium">{t("shows.lengthConstraintDetected")}.</span>{" "}
                {t("shows.lengthConstraintHint")}
              </p>
            )}
            <div className="flex gap-2">
              <HintTooltip hint={t("hints.shows.analyzePrompt")}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isAnalyzing || !editingType?.defaultPrompt?.trim()}
                  onClick={async () => {
                    if (!editingType?.defaultPrompt?.trim()) return;
                    setIsAnalyzing(true);
                    setPromptAnalysis(null);
                    try {
                      const res = await apiRequest("POST", "/api/analyze-prompt", {
                        promptText: editingType.defaultPrompt,
                      });
                      const data = await res.json();
                      setPromptAnalysis(data);
                    } catch (err: any) {
                      toast({ title: t("shows.analysisError"), description: err.message, variant: "destructive" });
                    } finally {
                      setIsAnalyzing(false);
                    }
                  }}
                  data-testid="button-analyze-prompt"
                >
                  {isAnalyzing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("shows.analyzing")}</>
                  ) : (
                    <><Eye className="mr-2 h-4 w-4" />{t("shows.analyzePrompt")}</>
                  )}
                </Button>
              </HintTooltip>
            </div>

            {promptAnalysis && (
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30 text-sm">
                <div className="font-semibold text-base">{t("shows.analysisResult")}</div>

                {promptAnalysis.speaker && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{t("shows.hostSpeaker")}</span>
                    <span className="font-medium text-green-600 dark:text-green-400">{promptAnalysis.speaker}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t("shows.referenceContent")}</span>
                  {promptAnalysis.hasEpisodeContent ? (
                    <span className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" /> {t("shows.detected")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1">
                      <XCircle className="h-4 w-4" /> {t("shows.notDetected")}
                    </span>
                  )}
                </div>

                {promptAnalysis.urls.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-muted-foreground">{t("shows.links", { count: promptAnalysis.urls.length })}</div>
                    {promptAnalysis.urls.map((u, i) => (
                      <div key={i} className="border rounded p-3 space-y-1 bg-background">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs font-mono break-all">{u.url}</span>
                          {u.status === "ok" ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                              {t("shows.chars", { count: u.contentLength.toLocaleString() })}
                            </span>
                          ) : u.status.startsWith("empty") ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                              {t("shows.cannotRead")}
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                              {t("shows.errorStatus", { status: u.status })}
                            </span>
                          )}
                        </div>
                        {u.preview && (
                          <div className="text-xs text-muted-foreground mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap border-t pt-1">
                            {u.preview}
                          </div>
                        )}
                      </div>
                    ))}
                    {promptAnalysis.totalContentLength > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {t("shows.totalLoaded", { count: promptAnalysis.totalContentLength.toLocaleString() })}
                      </div>
                    )}
                  </div>
                )}

                {promptAnalysis.urls.length === 0 && !promptAnalysis.hasEpisodeContent && !promptAnalysis.speaker && (
                  <div className="text-muted-foreground">
                    {t("shows.noPromptData")}
                  </div>
                )}

                {promptAnalysis.urls.some(u => u.status !== "ok") && (
                  <div className="text-xs text-muted-foreground bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded p-2">
                    {t("shows.linkNotReadable")}
                  </div>
                )}

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    {t("shows.expandedPrompt")}
                  </summary>
                  <pre className="mt-2 text-xs bg-background border rounded p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {promptAnalysis.expandedPrompt}
                  </pre>
                </details>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsEditPromptDialogOpen(false); setPromptAnalysis(null); }}>
              {t("shows.cancel")}
            </Button>
            <Button
              onClick={() => editingType && updateTypeMutation.mutate({
                id: editingType.id,
                data: { defaultPrompt: editingType.defaultPrompt },
              })}
              disabled={updateTypeMutation.isPending}
            >
              {updateTypeMutation.isPending ? t("shows.saving") : t("shows.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen}>
        <DialogContent className="!w-[min(42rem,calc(100vw-2rem))] !max-w-none max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{t("shows.settingsTitle", { name: settingsType?.name })}</DialogTitle>
            <DialogDescription>
              {t("shows.settingsDesc")}
            </DialogDescription>
          </DialogHeader>
          {settingsType && (
            <div className="space-y-6 py-4 min-w-0 w-full overflow-hidden">
              <div className="grid gap-4 min-w-0">
                <div className="space-y-2 min-w-0">
                  <Label>{t("shows.programName")}</Label>
                  <Input
                    value={settingsType.name}
                    onChange={(e) => setSettingsType(prev => prev ? { ...prev, name: e.target.value } : null)}
                    data-testid="input-program-name"
                  />
                </div>
                <div className="space-y-2 min-w-0">
                  <Label>{t("shows.programDescription")}</Label>
                  <Input
                    value={settingsType.description || ""}
                    onChange={(e) => setSettingsType(prev => prev ? { ...prev, description: e.target.value } : null)}
                    placeholder={t("shows.programDescriptionPlaceholder")}
                    data-testid="input-program-description"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 min-w-0">
                <div className="space-y-2 min-w-0">
                  <Label>{t("shows.episodesPerDay")}</Label>
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
                <div className="space-y-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label>{t("shows.durationSec")}</Label>
                    {hasLengthConstraintInPrompt(settingsType.defaultPrompt || "") && (
                      <Badge
                        variant="outline"
                        className="text-xs font-normal"
                        title={t("shows.lengthConstraintHint")}
                        data-testid="badge-length-constraint-detected"
                      >
                        {t("shows.lengthConstraintDetected")}
                      </Badge>
                    )}
                  </div>
                  <Input
                    type="number"
                    value={settingsType.defaultDurationSeconds || 60}
                    onChange={(e) => setSettingsType(prev => prev ? { ...prev, defaultDurationSeconds: Number(e.target.value) } : null)}
                    data-testid="input-duration"
                  />
                  {hasLengthConstraintInPrompt(settingsType.defaultPrompt || "") && (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="text-length-constraint-hint"
                    >
                      {t("shows.lengthConstraintHint")}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <Label>{t("shows.slotDescription")}</Label>
                {Array.from({ length: settingsType.dailyCount || 1 }, (_, i) => (
                  <div key={i} className="flex items-start gap-2 min-w-0">
                    <Badge variant="outline" className="mt-2 shrink-0">#{i + 1}</Badge>
                    <div className="flex gap-1 flex-1 min-w-0">
                      <Input
                        placeholder={t("shows.slotPlaceholder", { num: i + 1 })}
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
                <Label>{t("shows.sponsorLabel")}</Label>
                <div className="grid grid-cols-2 gap-4 min-w-0">
                  <div className="space-y-1 min-w-0">
                    <span className="text-xs text-muted-foreground">{t("shows.sponsorNameLabel")}</span>
                    <Input
                      placeholder={t("shows.sponsorNamePlaceholder")}
                      value={settingsType.sponsorName || ""}
                      onChange={(e) => setSettingsType(prev => prev ? { ...prev, sponsorName: e.target.value } : null)}
                      data-testid="input-sponsor-name"
                    />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <span className="text-xs text-muted-foreground">{t("shows.sponsorTextLabel")}</span>
                    <Input
                      placeholder={t("shows.sponsorTextPlaceholder", { name: settingsType.name })}
                      value={settingsType.sponsorText || ""}
                      onChange={(e) => setSettingsType(prev => prev ? { ...prev, sponsorText: e.target.value } : null)}
                      data-testid="input-sponsor-text"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("shows.fileNameTemplate")}</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("shows.fileNamePlaceholder")}
                    value={settingsType.fileNameTemplate || ""}
                    onChange={(e) => setSettingsType(prev => prev ? { ...prev, fileNameTemplate: e.target.value } : null)}
                    data-testid="input-file-name-template"
                    className="flex-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5 min-w-0">
                  {[
                    { label: "{название}_{дата}_{номер}", value: "{название}_{дата}_{номер}" },
                    { label: "{название}_{дата}", value: "{название}_{дата}" },
                    { label: "{name}_{date}_{number}", value: "{name}_{date}_{number}" },
                    { label: "{name}_{date}", value: "{name}_{date}" },
                    { label: "{название} выпуск {номер}", value: "{название} выпуск {номер}" },
                  ].map(preset => (
                    <Badge
                      key={preset.value}
                      variant={settingsType.fileNameTemplate === preset.value ? "default" : "outline"}
                      className="cursor-pointer text-xs hover:bg-primary/10 transition-colors justify-center truncate"
                      onClick={() => setSettingsType(prev => prev ? { ...prev, fileNameTemplate: preset.value } : null)}
                      data-testid={`preset-filename-${preset.value}`}
                    >
                      {preset.label}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("shows.fileNameVars")}
                </p>
                {settingsType.fileNameTemplate && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                    {t("shows.fileNameExample")}: <span className="font-mono font-medium">{settingsType.fileNameTemplate.replace(/\{название\}/g, settingsType.name).replace(/\{name\}/g, settingsType.name).replace(/\{дата\}/g, new Date().toISOString().split("T")[0]).replace(/\{date\}/g, new Date().toISOString().split("T")[0]).replace(/\{номер\}/g, "1").replace(/\{number\}/g, "1")}</span>
                  </p>
                )}
              </div>

              {voices && voices.length > 0 && (
                <div className="space-y-2">
                  <Label>{t("shows.assignedVoices")}</Label>
                  <div className="space-y-1.5">
                    {voices.filter(v => v.isActive).map(voice => {
                      const isAssigned = voice.assignedProgramTypeIds?.includes(settingsType.id) || false;
                      return (
                        <label key={voice.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1" data-testid={`voice-assign-${voice.id}`}>
                          <Checkbox
                            checked={isAssigned}
                            onCheckedChange={(checked) => {
                              const currentIds = voice.assignedProgramTypeIds || [];
                              const newIds = checked
                                ? [...currentIds, settingsType.id]
                                : currentIds.filter((id: string) => id !== settingsType.id);
                              apiRequest("PATCH", `/api/voices/${voice.id}`, { assignedProgramTypeIds: newIds })
                                .then(() => queryClient.invalidateQueries({ queryKey: ["/api/voices"] }));
                            }}
                            data-testid={`checkbox-voice-${voice.id}`}
                          />
                          <span className="text-sm">{getCleanVoiceName(voice)}</span>
                          {voice.gender && (
                            <span className="text-xs text-muted-foreground">({voice.gender === "male" ? "М" : "Ж"})</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("shows.scriptTemplateLabel")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("shows.scriptTemplateDesc")}
                </p>
                <textarea
                  className="w-full min-h-[120px] p-3 rounded-md border bg-background text-sm font-mono resize-y"
                  placeholder={t("shows.scriptTemplatePlaceholder")}
                  value={settingsType.scriptTemplate || ""}
                  onChange={(e) => setSettingsType(prev => prev ? { ...prev, scriptTemplate: e.target.value } : null)}
                  data-testid="textarea-script-template"
                />
                {!settingsType.scriptTemplate && voices && voices.filter(v => v.isActive && v.assignedProgramTypeIds?.includes(settingsType.id)).length >= 2 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const assignedVoices = voices.filter(v => v.isActive && v.assignedProgramTypeIds?.includes(settingsType.id));
                      const names = assignedVoices.map(v => getCleanVoiceName(v));
                      const template = `${t("shows.scriptTemplateOpening", { name: names[0] })}\n${t("shows.scriptTemplateMain", { name: names.length > 1 ? names[1] : names[0] })}\n${t("shows.scriptTemplateClosing", { name: names[0] })}`;
                      setSettingsType(prev => prev ? { ...prev, scriptTemplate: template } : null);
                    }}
                    data-testid="button-generate-script-template"
                  >
                    {t("shows.scriptTemplateGenerate")}
                  </Button>
                )}
              </div>

              <div className="space-y-3 border rounded-lg p-3 sm:p-4 bg-muted/20 min-w-0">
                <Label className="text-base font-semibold">{t("shows.firecrawlTitle")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("shows.firecrawlDesc")}
                </p>
                <div className="flex items-center gap-3">
                  <HintTooltip hint={t("hints.shows.toggleFirecrawl")}>
                    <Button
                      size="sm"
                      variant={settingsType.useFirecrawl ? "default" : "outline"}
                      onClick={() => setSettingsType(prev => prev ? { ...prev, useFirecrawl: !prev.useFirecrawl } : null)}
                      data-testid="button-toggle-firecrawl"
                    >
                      {settingsType.useFirecrawl ? t("shows.enabled") : t("shows.disabled")}
                    </Button>
                  </HintTooltip>
                </div>
                {settingsType.useFirecrawl && (
                  <div className="space-y-3 mt-2">
                    <div className="space-y-2">
                      <span className="text-xs text-muted-foreground">{t("shows.topicsHint")}</span>
                      <div className="space-y-1.5 mb-2">
                        {(settingsType.firecrawlTopics || []).map((topic: string, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 bg-secondary rounded-md px-3 py-1.5 cursor-pointer group" data-testid={`badge-topic-${idx}`}
                            onClick={() => {
                              setSettingsType(prev => {
                                if (!prev) return null;
                                const topics = [...(prev.firecrawlTopics || [])];
                                topics.splice(idx, 1);
                                return { ...prev, firecrawlTopics: topics };
                              });
                            }}
                          >
                            <span className="text-sm truncate flex-1 min-w-0">{topic}</span>
                            <span className="text-muted-foreground group-hover:text-destructive shrink-0">✕</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 min-w-0">
                        <Input
                          placeholder={t("shows.newTopicPlaceholder")}
                          value={firecrawlTopicInput}
                          onChange={(e) => setFirecrawlTopicInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && firecrawlTopicInput.trim()) {
                              setSettingsType(prev => prev ? {
                                ...prev,
                                firecrawlTopics: [...(prev.firecrawlTopics || []), firecrawlTopicInput.trim()],
                              } : null);
                              setFirecrawlTopicInput("");
                            }
                          }}
                          data-testid="input-firecrawl-topic"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (firecrawlTopicInput.trim()) {
                              setSettingsType(prev => prev ? {
                                ...prev,
                                firecrawlTopics: [...(prev.firecrawlTopics || []), firecrawlTopicInput.trim()],
                              } : null);
                              setFirecrawlTopicInput("");
                            }
                          }}
                          data-testid="button-add-topic"
                        >
                          +
                        </Button>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={firecrawlTesting || !(settingsType.firecrawlTopics?.length)}
                      onClick={async () => {
                        setFirecrawlTesting(true);
                        setFirecrawlTestResult(null);
                        try {
                          const topic = settingsType.firecrawlTopics?.[0] || "";
                          const res = await apiRequest("POST", "/api/firecrawl/search", { query: topic, limit: 2 });
                          const data = await res.json();
                          setFirecrawlTestResult(`${t("shows.firecrawlFound", { count: data.count, topic })}:\n${data.results?.map((r: string) => r.substring(0, 200)).join("\n---\n") || t("shows.firecrawlEmpty")}`);
                        } catch (err: any) {
                          setFirecrawlTestResult(t("shows.firecrawlError", { message: err.message }));
                        }
                        setFirecrawlTesting(false);
                      }}
                      data-testid="button-test-firecrawl"
                    >
                      {firecrawlTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {t("shows.testSearch")}
                    </Button>
                    {firecrawlTestResult && (
                      <pre className="text-xs bg-muted p-3 rounded max-h-40 overflow-y-auto whitespace-pre-wrap break-words min-w-0" data-testid="text-firecrawl-result">
                        {firecrawlTestResult}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-3 border rounded-lg p-3 sm:p-4 bg-muted/20 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <ScrollText className="h-4 w-4" />
                      {t("shows.exactScriptTitle")}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">{t("shows.exactScriptDesc")}</p>
                  </div>
                  <Switch
                    checked={!!settingsType.promptIsExactScript}
                    onCheckedChange={(checked) =>
                      setSettingsType((prev) => prev ? { ...prev, promptIsExactScript: checked } : null)
                    }
                    data-testid="switch-exact-script"
                  />
                </div>
              </div>

              <div className="space-y-3 border rounded-lg p-3 sm:p-4 bg-muted/20 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Sun className="h-4 w-4" />
                      {t("shows.seasonalTitle")}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">{t("shows.seasonalDesc")}</p>
                  </div>
                  <Switch
                    checked={!!settingsType.useSeasonalContext}
                    onCheckedChange={(checked) =>
                      setSettingsType((prev) => prev ? { ...prev, useSeasonalContext: checked } : null)
                    }
                    data-testid="switch-seasonal-context"
                  />
                </div>
              </div>

              <div className="space-y-3 border rounded-lg p-3 sm:p-4 bg-muted/20 min-w-0">
                <div className="min-w-0">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    {t("shows.researchProfileTitle")}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">{t("shows.researchProfileDesc")}</p>
                </div>
                <Select
                  value={settingsType.researchProfile || "local"}
                  onValueChange={(value) =>
                    setSettingsType((prev) => prev ? { ...prev, researchProfile: value } : null)
                  }
                >
                  <SelectTrigger data-testid="select-research-profile">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">{t("shows.researchProfileLocal")}</SelectItem>
                    <SelectItem value="academic">{t("shows.researchProfileAcademic")}</SelectItem>
                    <SelectItem value="none">{t("shows.researchProfileNone")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3 border rounded-lg p-3 sm:p-4 bg-muted/20 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <CloudSun className="h-4 w-4" />
                      {t("shows.weatherTitle")}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">{t("shows.weatherDesc")}</p>
                  </div>
                  <Switch
                    checked={!!settingsType.isWeatherForecast}
                    onCheckedChange={(checked) =>
                      setSettingsType((prev) => prev ? { ...prev, isWeatherForecast: checked } : null)
                    }
                    data-testid="switch-weather-forecast"
                  />
                </div>
                {settingsType.isWeatherForecast && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("shows.defaultForecastDays")}</Label>
                    <Select
                      value={String(settingsType.defaultForecastDays || 1)}
                      onValueChange={(v) =>
                        setSettingsType((prev) => prev ? { ...prev, defaultForecastDays: Number(v) } : null)
                      }
                    >
                      <SelectTrigger data-testid="select-default-forecast-days">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {t("shows.daysCount", { count: n })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-3 border rounded-lg p-3 sm:p-4 bg-muted/20 min-w-0">
                <Label className="text-base font-semibold">{t("shows.autoGenTitle")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("shows.autoGenDesc")}
                </p>
                <div className="flex items-center gap-3">
                  <HintTooltip hint={t("hints.shows.toggleAutoGenerate")}>
                    <Button
                      size="sm"
                      variant={settingsType.autoGenerate ? "default" : "outline"}
                      onClick={() => setSettingsType(prev => prev ? { ...prev, autoGenerate: !prev.autoGenerate } : null)}
                      data-testid="button-toggle-auto-generate"
                    >
                      {settingsType.autoGenerate ? t("shows.autoGenEnabled") : t("shows.autoGenDisabled")}
                    </Button>
                  </HintTooltip>
                </div>
                {settingsType.autoGenerate && (
                  <div className="space-y-3 mt-2">
                    <div className="space-y-2">
                      <div className="flex items-end gap-3">
                        <div className="space-y-1 w-24 shrink-0">
                          <span className="text-xs text-muted-foreground">{t("shows.episodesPerWeek")}</span>
                          <Input
                            type="number"
                            min={1}
                            max={50}
                            value={settingsType.weeklyCount || 7}
                            onChange={(e) => setSettingsType(prev => prev ? { ...prev, weeklyCount: Number(e.target.value) } : null)}
                            data-testid="input-weekly-count"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={settingsType.autoVoice !== false ? "default" : "outline"}
                          onClick={() => setSettingsType(prev => prev ? { ...prev, autoVoice: !(prev.autoVoice !== false) } : null)}
                          data-testid="button-toggle-auto-voice"
                        >
                          {settingsType.autoVoice !== false ? t("shows.autoVoiceOn") : t("shows.autoVoiceOff")}
                        </Button>
                        <Button
                          size="sm"
                          variant={settingsType.autoIsolate ? "default" : "outline"}
                          onClick={() => setSettingsType(prev => prev ? { ...prev, autoIsolate: !prev.autoIsolate } : null)}
                          data-testid="button-toggle-auto-isolate"
                        >
                          {settingsType.autoIsolate ? t("shows.denoiserOn") : t("shows.denoiserOff")}
                        </Button>
                        <Button
                          size="sm"
                          variant={settingsType.autoUpload !== false ? "default" : "outline"}
                          onClick={() => setSettingsType(prev => prev ? { ...prev, autoUpload: !(prev.autoUpload !== false) } : null)}
                          data-testid="button-toggle-auto-upload"
                        >
                          {settingsType.autoUpload !== false ? t("shows.autoUploadOn") : t("shows.autoUploadOff")}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium">{t("shows.schedule")}</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { day: 1, label: t("shows.dayMon") },
                          { day: 2, label: t("shows.dayTue") },
                          { day: 3, label: t("shows.dayWed") },
                          { day: 4, label: t("shows.dayThu") },
                          { day: 5, label: t("shows.dayFri") },
                          { day: 6, label: t("shows.daySat") },
                          { day: 0, label: t("shows.daySun") },
                        ].map(({ day, label }) => {
                          const days = settingsType.scheduleDays || [];
                          const isSelected = days.includes(day);
                          return (
                            <Button
                              key={day}
                              size="sm"
                              variant={isSelected ? "default" : "outline"}
                              className="h-8 w-10 p-0 text-xs"
                              onClick={() => {
                                const newDays = isSelected
                                  ? days.filter((d: number) => d !== day)
                                  : [...days, day].sort((a: number, b: number) => a - b);
                                setSettingsType(prev => prev ? { ...prev, scheduleDays: newDays } : null);
                              }}
                              data-testid={`button-schedule-day-${day}`}
                            >
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs whitespace-nowrap">{t("shows.launchTime")}</Label>
                        <Input
                          type="time"
                          className="w-28 h-8 text-sm"
                          value={settingsType.scheduleTime || "09:00"}
                          onChange={(e) => setSettingsType(prev => prev ? { ...prev, scheduleTime: e.target.value } : null)}
                          data-testid="input-schedule-time"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(!settingsType.scheduleDays || settingsType.scheduleDays.length === 0)
                          ? t("shows.noDaysSelected")
                          : t("shows.generationSchedule", { days: (settingsType.scheduleDays || []).map((d: number) => [t("shows.daySun"),t("shows.dayMon"),t("shows.dayTue"),t("shows.dayWed"),t("shows.dayThu"),t("shows.dayFri"),t("shows.daySat")][d]).join(", "), time: settingsType.scheduleTime || "09:00" })
                        }
                      </p>
                    </div>

                    {settingsType.autoUpload !== false && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t("shows.cloudFolder")}</Label>
                        <Input
                          placeholder={`/radio/${settingsType.slug || 'program'}`}
                          value={settingsType.uploadFolder || ""}
                          onChange={(e) => setSettingsType(prev => prev ? { ...prev, uploadFolder: e.target.value || null } : null)}
                          data-testid="input-upload-folder"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("shows.cloudFolderHint", { slug: settingsType.slug || 'program' })}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="w-full" data-testid="button-delete-type">
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("shows.deleteTypeBtn")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("shows.deleteTypeTitle", { name: settingsType.name })}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("shows.deleteTypeMsg")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("shows.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                      deleteTypeMutation.mutate(settingsType.id);
                      setIsSettingsDialogOpen(false);
                    }}>
                      {t("shows.delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSettingsDialogOpen(false)}>
              {t("shows.cancel")}
            </Button>
            <Button onClick={saveSettings} disabled={updateTypeMutation.isPending}>
              {updateTypeMutation.isPending ? t("shows.saving") : t("shows.save")}
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
        <DialogContent className="!w-[min(42rem,calc(100vw-2rem))] !max-w-none max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" />
              {t("shows.batchTitle", { name: currentType?.name })}
            </DialogTitle>
            <DialogDescription>
              {t("shows.batchDesc")}
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
                    {t("shows.batchCreated", { created: batchResult.created, total: batchResult.total })}
                  </p>
                </div>
              </div>
              {batchResult.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">{t("shows.batchErrors")}</p>
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
                  {t("shows.close")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <Label>{t("shows.batchHowMany")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={batchCount}
                  onChange={(e) => setBatchCount(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                  disabled={batchGenerating}
                  data-testid="input-batch-count"
                />
                <p className="text-xs text-muted-foreground">
                  {t("shows.batchPromptHint")}{currentType?.useFirecrawl ? t("shows.batchFirecrawlHint") : ""}
                </p>
              </div>

              {batchGenerating && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{t("shows.batchCreating", { progress: batchProgress, count: batchCount })}</span>
                  </div>
                  <Progress value={(batchProgress / batchCount) * 100} className="h-2" />
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsBatchDialogOpen(false)} disabled={batchGenerating}>
                  {t("shows.cancel")}
                </Button>
                <Button
                  onClick={startBatchGeneration}
                  disabled={batchGenerating}
                  data-testid="button-start-batch"
                >
                  {batchGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {batchProgress} / {batchCount}
                    </>
                  ) : (
                    <>
                      <PackagePlus className="mr-2 h-4 w-4" />
                      {t("shows.batchCreateBtn", { count: batchCount })}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isImportDialogOpen} onOpenChange={(open) => {
        if (!importParsing && !importCreating) {
          setIsImportDialogOpen(open);
          if (!open) resetImportDialog();
        }
      }}>
        <DialogContent className="!w-[min(42rem,calc(100vw-2rem))] !max-w-none max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="h-5 w-5" />
              {t("shows.importTitle", { name: currentType?.name })}
            </DialogTitle>
            <DialogDescription>
              {t("shows.importDesc")}
            </DialogDescription>
          </DialogHeader>

          {importEpisodes ? (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{t("shows.importFound", { count: importEpisodes.length })}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImportSelected(prev =>
                      prev.size === importEpisodes.length
                        ? new Set()
                        : new Set(importEpisodes.map((_, i) => i))
                    );
                  }}
                >
                  {importSelected.size === importEpisodes.length ? t("shows.importDeselectAll") : t("shows.importSelectAll")}
                </Button>
              </div>
              <div className="max-h-[45vh] overflow-y-auto space-y-1 border rounded-md p-2">
                {importEpisodes.map((ep, i) => (
                  <label key={i} className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={importSelected.has(i)}
                      onCheckedChange={(checked) => {
                        setImportSelected(prev => {
                          const next = new Set(prev);
                          if (checked) next.add(i); else next.delete(i);
                          return next;
                        });
                      }}
                      className="mt-0.5"
                    />
                    <span className="text-sm leading-snug">
                      <span className="text-muted-foreground mr-1.5">#{ep.number}</span>
                      {ep.title}
                      <span className="text-xs text-muted-foreground ml-1.5">{t("shows.importWords", { count: ep.words })}</span>
                    </span>
                  </label>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setImportEpisodes(null); setImportSelected(new Set()); }} disabled={importCreating}>
                  {t("shows.importBack")}
                </Button>
                <Button onClick={createImported} disabled={importCreating || importSelected.size === 0} data-testid="button-import-create">
                  {importCreating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {t("shows.importCreateBtn", { count: importSelected.size })}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>{t("shows.importFileLabel")}</Label>
                <Input
                  type="file"
                  accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  disabled={importParsing}
                  data-testid="input-import-file"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("shows.importTextLabel")}</Label>
                <Textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={t("shows.importTextPlaceholder")}
                  rows={8}
                  disabled={importParsing || !!importFile}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsImportDialogOpen(false)} disabled={importParsing}>
                  {t("shows.cancel")}
                </Button>
                <Button
                  onClick={parseImport}
                  disabled={importParsing || (!importFile && !importText.trim())}
                  data-testid="button-import-parse"
                >
                  {importParsing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  {t("shows.importParse")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewScriptProgram} onOpenChange={(open) => { if (!open) { setViewScriptProgram(null); setEditingBlocks(null); setEditingText(null); } }}>
        <DialogContent className="!w-[min(42rem,calc(100vw-2rem))] !max-w-none max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewScriptProgram?.scriptText && hasFormattedSpeakers(viewScriptProgram.scriptText) && (
                isMultiSpeaker(viewScriptProgram.scriptText) 
                  ? <Users className="h-5 w-5 text-violet-500" />
                  : <User className="h-5 w-5 text-violet-500" />
              )}
              {viewScriptProgram?.title}
            </DialogTitle>
            <DialogDescription>
              {viewScriptProgram?.scheduledDate && t("shows.scriptDate", { date: viewScriptProgram.scheduledDate })}
              {viewScriptProgram?.slotNumber && ` • ${t("shows.scriptSlot", { num: viewScriptProgram.slotNumber })}`}
            </DialogDescription>
          </DialogHeader>

          {editingBlocks ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-muted-foreground">{t("shows.assignSpeakerHint")}</p>
              {editingBlocks.map((block, idx) => {
                const typeVoices = viewScriptProgram?.programTypeId
                  ? getAssignedVoicesForType(viewScriptProgram.programTypeId)
                  : [];
                return (
                  <div key={idx} className="border rounded-lg p-3 space-y-2">
                    <Select
                      value={block.speaker || "__none__"}
                      onValueChange={(val) => {
                        setEditingBlocks(prev => {
                          if (!prev) return prev;
                          const updated = [...prev];
                          updated[idx] = { ...updated[idx], speaker: val === "__none__" ? "" : val };
                          return updated;
                        });
                      }}
                    >
                      <SelectTrigger className="w-full" data-testid={`select-speaker-${idx}`}>
                        <SelectValue placeholder={t("shows.selectSpeaker")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("shows.noSpeaker")}</SelectItem>
                        {typeVoices.map(v => (
                          <SelectItem key={v.id} value={getCleanVoiceName(v)}>
                            {getCleanVoiceName(v)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed bg-muted/30 p-2 rounded">
                      {renderTextWithEmotionTags(block.text)}
                    </pre>
                  </div>
                );
              })}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingBlocks(null)} data-testid="button-cancel-edit-script">
                  {t("shows.cancel")}
                </Button>
                <Button onClick={saveEditedScript} disabled={savingScript} data-testid="button-save-script">
                  {savingScript ? t("shows.saving") : t("shows.save")}
                </Button>
              </div>
            </div>
          ) : editingText !== null ? (
            <div className="mt-2 space-y-3">
              <textarea
                className="w-full min-h-[300px] p-3 border rounded-lg text-sm font-sans leading-relaxed bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                data-testid="textarea-edit-script"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingText(null)} data-testid="button-cancel-edit-text">
                  {t("shows.cancel")}
                </Button>
                <Button onClick={saveEditedText} disabled={savingScript} data-testid="button-save-text">
                  {savingScript ? t("shows.saving") : t("shows.save")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              {viewScriptProgram?.scriptText && hasFormattedSpeakers(viewScriptProgram.scriptText) ? (
                <div className="space-y-0">{renderMultiSpeakerScript(viewScriptProgram.scriptText)}</div>
              ) : (
                <div className="space-y-4">
                  {viewScriptProgram?.scriptText?.split(/\n\s*\n/).map((paragraph, idx) => (
                    <p key={idx} className="text-sm leading-relaxed whitespace-pre-wrap">
                      {paragraph.trim()}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                {viewScriptProgram?.scriptText && (
                  <Button variant="outline" onClick={() => setEditingText(viewScriptProgram.scriptText)} data-testid="button-edit-script-text">
                    <Pencil className="mr-2 h-4 w-4" />
                    {t("shows.editScript")}
                  </Button>
                )}
                {viewScriptProgram?.programTypeId && getAssignedVoicesForType(viewScriptProgram.programTypeId).length >= 1 && (
                  <Button variant="outline" onClick={startEditingScript} data-testid="button-assign-speakers">
                    <Users className="mr-2 h-4 w-4" />
                    {viewScriptProgram?.scriptText && isMultiSpeaker(viewScriptProgram.scriptText) ? t("shows.reassignSpeakers") : t("shows.assignSpeakers")}
                  </Button>
                )}
                {viewScriptProgram && (viewScriptProgram.status === "script_ready" || viewScriptProgram.audioUrl) && (
                  <Button
                    variant={viewScriptProgram.audioUrl ? "outline" : "default"}
                    onClick={() => {
                      enqueueAudio(viewScriptProgram.id);
                    }}
                    disabled={generatingAudioId === viewScriptProgram.id || audioQueue.includes(viewScriptProgram.id)}
                    data-testid="button-generate-audio-viewer"
                  >
                    {generatingAudioId === viewScriptProgram.id ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("shows.voicing")}</>
                    ) : audioQueue.includes(viewScriptProgram.id) ? (
                      <>{t("shows.inQueue", { pos: audioQueue.indexOf(viewScriptProgram.id) + 1 })}</>
                    ) : viewScriptProgram.audioUrl ? (
                      <><Volume2 className="mr-2 h-4 w-4" /> {t("shows.revoice")}</>
                    ) : (
                      <><Volume2 className="mr-2 h-4 w-4" /> {t("shows.voiceBtn")}</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
