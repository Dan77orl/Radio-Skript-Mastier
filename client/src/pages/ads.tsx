import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
import { getCleanVoiceName } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  Sparkles, Loader2, Trash2, Play, Building2, ChevronRight, 
  Check, RefreshCw, Volume2, Music, FileText, Link, Instagram,
  Clock, PauseCircle, PlayCircle, ArrowLeft, Upload, X, File,
  Plus, Pencil, Users, User, Mic, Settings2, FileStack, Download
} from "lucide-react";
import type { Ad, Voice, AdPreset } from "@shared/schema";
import { HintTooltip } from "@/components/hint-tooltip";

interface ExtractedFile {
  filename: string;
  text: string;
}

const adFormSchema = z.object({
  prompt: z.string().min(10),
  clientName: z.string().optional(),
  websiteUrl: z.string().optional(),
  instagramUrl: z.string().optional(),
  targetDurationSeconds: z.number().min(10).max(120).default(30),
  category: z.string().default("general"),
});

type AdFormValues = z.infer<typeof adFormSchema>;

const categoryKeys = ["general", "restaurant", "real_estate", "services", "shop", "events"];

const stageConfigs = [
  { key: "prompt", labelKey: "ads.prompt", icon: FileText },
  { key: "variants", labelKey: "ads.variants", icon: Sparkles },
  { key: "voices", labelKey: "ads.voicesStage", icon: Volume2 },
  { key: "audio", labelKey: "ads.audio", icon: Play },
  { key: "music", labelKey: "ads.withMusic", icon: Music },
];

export default function AdsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [currentAd, setCurrentAd] = useState<Ad | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedVariantForEdit, setSelectedVariantForEdit] = useState<number | null>(null);
  const [editInstructions, setEditInstructions] = useState("");
  const [smartPrompt, setSmartPrompt] = useState("");
  const [isParsingPrompt, setIsParsingPrompt] = useState(false);
  const smartImageInputRef = useRef<HTMLInputElement | null>(null);
  const [smartImage, setSmartImage] = useState<File | null>(null);
  const [smartImagePreview, setSmartImagePreview] = useState<string | null>(null);
  const [showVoiceLibrary, setShowVoiceLibrary] = useState(false);
  const [voiceSearchQuery, setVoiceSearchQuery] = useState("");
  const [voiceSearchGender, setVoiceSearchGender] = useState("all");
  const [voiceSearchLanguage, setVoiceSearchLanguage] = useState("all");
  const [previewingVoiceUrl, setPreviewingVoiceUrl] = useState<string | null>(null);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playingVersionUrl, setPlayingVersionUrl] = useState<string | null>(null);
  const versionAudioRef = useRef<HTMLAudioElement | null>(null);
  const [musicSearchQuery, setMusicSearchQuery] = useState("");
  const [isSearchingMusic, setIsSearchingMusic] = useState(false);
  const [musicSearchResults, setMusicSearchResults] = useState<Array<{
    id: string;
    title: string;
    mainArtists: string[];
    bpm: number;
    length: number;
    moods?: Array<{ name: string }>;
    images?: { default?: string };
    audioUrl?: string;
  }>>([]);
  const [selectedMusicTrack, setSelectedMusicTrack] = useState<string | null>(null);
  const [playingMusicTrackId, setPlayingMusicTrackId] = useState<string | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isAutoSelectingMusic, setIsAutoSelectingMusic] = useState(false);
  const [autoSelectReasoning, setAutoSelectReasoning] = useState<string | null>(null);
  const [adSpeakerVoiceMap, setAdSpeakerVoiceMap] = useState<Record<string, string>>({});
  const [editingScriptText, setEditingScriptText] = useState<string | null>(null);

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
    const matches = text.match(/^\s*\[([^\]]+)\]:/gm);
    return !!matches && matches.length >= 2;
  };

  const extractSpeakers = (text: string): string[] => {
    const speakers: string[] = [];
    const regex = /^\s*\[([^\]]+)\]:/gm;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (!speakers.includes(m[1])) speakers.push(m[1]);
    }
    return speakers;
  };

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

  const { data: adPresets } = useQuery<AdPreset[]>({
    queryKey: ["/api/ad-presets"],
  });

  const voiceSearchUrl = `/api/elevenlabs/voices/search?q=${encodeURIComponent(voiceSearchQuery)}&gender=${voiceSearchGender}&language=${encodeURIComponent(voiceSearchLanguage)}`;
  const { data: sharedVoicesData, isLoading: isSearchingVoices } = useQuery<{
    voices: Array<{
      voice_id: string;
      public_owner_id: string;
      name: string;
      category: string;
      labels?: { gender?: string; accent?: string; age?: string; language?: string; use_case?: string };
      preview_url?: string;
      description?: string;
    }>;
    has_more: boolean;
  }>({
    queryKey: [voiceSearchUrl],
    enabled: showVoiceLibrary,
  });

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  const handlePresetSelect = (presetId: string) => {
    if (presetId === "none") {
      setSelectedPresetId(null);
      return;
    }
    const preset = adPresets?.find(p => p.id === presetId);
    if (preset) {
      setSelectedPresetId(presetId);
      const currentCategory = form.getValues("category");
      if (preset.defaultCategory && (!currentCategory || currentCategory === "general")) {
        form.setValue("category", preset.defaultCategory);
      }
      const currentDuration = form.getValues("targetDurationSeconds");
      if (preset.defaultTargetDurationSeconds && currentDuration === 30) {
        form.setValue("targetDurationSeconds", preset.defaultTargetDurationSeconds);
      }
      if (preset.miniPrompt) {
        const currentPrompt = form.getValues("prompt");
        if (!currentPrompt || currentPrompt.trim() === "") {
          form.setValue("prompt", preset.miniPrompt);
        }
      }
      if (preset.defaultVoiceId && !selectedVoiceId) {
        setSelectedVoiceId(preset.defaultVoiceId);
      }
    }
  };

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

  const handleSmartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSmartImage(file);
    const reader = new FileReader();
    reader.onloadend = () => setSmartImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const applyParsedData = (data: Record<string, unknown>) => {
    if (data.clientName) form.setValue("clientName", data.clientName as string);
    if (data.websiteUrl) form.setValue("websiteUrl", data.websiteUrl as string);
    if (data.instagramUrl) form.setValue("instagramUrl", data.instagramUrl as string);
    if (data.category && data.category !== "general") form.setValue("category", data.category as string);
    if (data.targetDurationSeconds && data.targetDurationSeconds !== 30) {
      form.setValue("targetDurationSeconds", data.targetDurationSeconds as number);
    }
    if (data.description) form.setValue("prompt", data.description as string);
    toast({ title: t("ads.smartParsed") });
  };

  const handleSmartParse = async () => {
    const hasText = smartPrompt.trim().length >= 5;
    const hasImage = !!smartImage;
    if (!hasText && !hasImage) return;

    setIsParsingPrompt(true);
    try {
      if (hasImage) {
        const formData = new FormData();
        formData.append("image", smartImage!);
        if (smartPrompt.trim()) formData.append("text", smartPrompt.trim());
        const res = await fetch("/api/ads/parse-prompt-image", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed");
        applyParsedData(await res.json());
      } else {
        const res = await apiRequest("POST", "/api/ads/parse-prompt", { text: smartPrompt });
        applyParsedData(await res.json());
      }
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    } finally {
      setIsParsingPrompt(false);
    }
  };

  const previewVoice = (url: string) => {
    if (voicePreviewRef.current) {
      voicePreviewRef.current.pause();
      voicePreviewRef.current = null;
    }
    if (previewingVoiceUrl === url) {
      setPreviewingVoiceUrl(null);
      return;
    }
    const audio = new Audio(url);
    voicePreviewRef.current = audio;
    audio.onended = () => setPreviewingVoiceUrl(null);
    audio.play().catch(() => setPreviewingVoiceUrl(null));
    setPreviewingVoiceUrl(url);
  };

  const createAdMutation = useMutation({
    mutationFn: async (data: AdFormValues) => {
      const response = await apiRequest("POST", "/api/ads", {
        title: data.clientName || t("ads.newAd2"),
        ...data,
        presetId: selectedPresetId || undefined,
        voiceIds: selectedVoiceId ? [selectedVoiceId] : undefined,
        status: "draft",
        stage: "prompt",
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      setCurrentAd(data);
      toast({ title: t("ads.adCreated"), description: t("ads.generateVariantsDesc") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
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
      toast({ title: t("ads.variantsCreated"), description: t("ads.variantsDesc") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
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
      toast({ title: t("ads.variantSelected"), description: t("ads.selectVoiceNow") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
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
      toast({ title: t("ads.newVariantCreated") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const synthesizeAudioMutation = useMutation({
    mutationFn: async ({ adId, voiceIds, voiceName, speakerVoiceMap }: { adId: string; voiceIds: string[]; voiceName?: string; speakerVoiceMap?: Record<string, string> }) => {
      const response = await apiRequest("POST", `/api/ads/${adId}/synthesize-audio`, { voiceIds, voiceName, speakerVoiceMap });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: t("ads.synthesisStarted"), description: t("ads.audioGenerating") });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      }, 3000);
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      if (currentAd) setCurrentAd(null);
      toast({ title: t("common.deleted") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
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

  useEffect(() => {
    if (currentAd?.speakerVoiceMap) {
      try {
        const parsed = JSON.parse(currentAd.speakerVoiceMap);
        if (typeof parsed === "object" && parsed !== null) {
          setAdSpeakerVoiceMap(parsed);
        }
      } catch {}
    } else {
      setAdSpeakerVoiceMap({});
    }
  }, [currentAd?.id, currentAd?.speakerVoiceMap]);

  const onSubmit = (data: AdFormValues) => {
    createAdMutation.mutate(data);
  };

  const resolveAudioUrl = (url: string) => {
    if (url.startsWith("/audio/")) {
      return `/api/stream-audio/${encodeURIComponent(url.slice(7))}`;
    }
    if (url.startsWith("audio/")) {
      return `/api/stream-audio/${encodeURIComponent(url.slice(6))}`;
    }
    return url;
  };

  const playAudio = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (playingAudio) {
      setPlayingAudio(false);
      return;
    }
    const audio = new Audio(resolveAudioUrl(url));
    audioRef.current = audio;
    audio.play().catch(console.error);
    setPlayingAudio(true);
    audio.onended = () => setPlayingAudio(false);
  };

  const [versionProgress, setVersionProgress] = useState(0);
  const [versionDurationSec, setVersionDurationSec] = useState(0);
  const [versionCurrentTime, setVersionCurrentTime] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playVersionAudio = (url: string) => {
    if (versionAudioRef.current) {
      versionAudioRef.current.pause();
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }
    if (playingVersionUrl === url) {
      setPlayingVersionUrl(null);
      setVersionProgress(0);
      setVersionCurrentTime(0);
      return;
    }
    const audio = new Audio(resolveAudioUrl(url));
    audio.playbackRate = playbackSpeed;
    versionAudioRef.current = audio;
    audio.play().catch(console.error);
    setPlayingVersionUrl(url);

    audio.onloadedmetadata = () => {
      setVersionDurationSec(audio.duration);
    };

    progressIntervalRef.current = setInterval(() => {
      if (audio.duration) {
        setVersionProgress((audio.currentTime / audio.duration) * 100);
        setVersionCurrentTime(audio.currentTime);
      }
    }, 100);

    audio.onended = () => {
      setPlayingVersionUrl(null);
      setVersionProgress(0);
      setVersionCurrentTime(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  };

  const seekVersionAudio = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!versionAudioRef.current || !playingVersionUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    versionAudioRef.current.currentTime = pct * versionAudioRef.current.duration;
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (versionAudioRef.current) {
      versionAudioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    return () => {
      if (versionAudioRef.current) {
        versionAudioRef.current.pause();
        versionAudioRef.current = null;
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, []);

  const deleteVersionMutation = useMutation({
    mutationFn: async ({ adId, versionIndex }: { adId: string; versionIndex: number }) => {
      const res = await apiRequest("DELETE", `/api/ads/${adId}/audio-version/${versionIndex}`);
      return res.json();
    },
    onMutate: () => {
      if (versionAudioRef.current) {
        versionAudioRef.current.pause();
        versionAudioRef.current = null;
      }
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setPlayingVersionUrl(null);
      setVersionProgress(0);
      setVersionCurrentTime(0);
    },
    onSuccess: (updated) => {
      setCurrentAd(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
    },
  });

  const searchMusic = async () => {
    if (!musicSearchQuery.trim()) return;
    setIsSearchingMusic(true);
    try {
      const response = await fetch(`/api/music/search?query=${encodeURIComponent(musicSearchQuery)}&limit=10`);
      const data = await response.json();
      if (!response.ok) {
        if (data.needsApiKey) {
          toast({
            title: t("ads.needsApiKey"),
            description: t("ads.addFreesoundKey"),
            variant: "destructive",
          });
          return;
        }
        throw new Error(data.error || "Search failed");
      }
      setMusicSearchResults(data.tracks || []);
    } catch (error) {
      console.error("Music search error:", error);
      toast({
        title: t("ads.searchError"),
        description: t("ads.musicSearchFailed"),
        variant: "destructive",
      });
    } finally {
      setIsSearchingMusic(false);
    }
  };

  const playMusicPreview = async (trackId: string) => {
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
    }
    if (playingMusicTrackId === trackId) {
      setPlayingMusicTrackId(null);
      return;
    }
    try {
      const track = musicSearchResults.find(t => t.id === trackId);
      const audioUrl = track?.audioUrl;
      
      if (!audioUrl) {
        const response = await fetch(`/api/music/track/${trackId}/stream`);
        if (!response.ok) throw new Error("Stream failed");
        const data = await response.json();
        if (data.url) {
          const audio = new Audio(data.url);
          musicAudioRef.current = audio;
          audio.play().catch(console.error);
          setPlayingMusicTrackId(trackId);
          audio.onended = () => setPlayingMusicTrackId(null);
        }
      } else {
        const audio = new Audio(audioUrl);
        musicAudioRef.current = audio;
        audio.play().catch(console.error);
        setPlayingMusicTrackId(trackId);
        audio.onended = () => setPlayingMusicTrackId(null);
      }
    } catch (error) {
      console.error("Music preview error:", error);
    }
  };

  const formatMusicDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const autoSelectMusic = async () => {
    if (!currentAd?.selectedVariantText) return;
    setIsAutoSelectingMusic(true);
    setAutoSelectReasoning(null);
    try {
      const response = await fetch("/api/music/auto-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adText: currentAd.selectedVariantText,
          category: currentAd.category,
          title: currentAd.title,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.needsApiKey) {
          toast({
            title: t("ads.needsApiKey"),
            description: t("ads.addFreesoundKey"),
            variant: "destructive",
          });
          return;
        }
        throw new Error(data.error || "Auto-select failed");
      }
      setMusicSearchResults(data.tracks || []);
      if (data.recommendedTrack) {
        setSelectedMusicTrack(data.recommendedTrack.id);
      }
      if (data.analysis?.reasoning) {
        setAutoSelectReasoning(data.analysis.reasoning);
      }
      toast({
        title: t("ads.musicSelected"),
        description: data.analysis?.reasoning || t("ads.musicAutoSelected"),
      });
    } catch (error) {
      console.error("Auto-select error:", error);
      toast({
        title: t("common.error"),
        description: t("ads.musicAutoFailed"),
        variant: "destructive",
      });
    } finally {
      setIsAutoSelectingMusic(false);
    }
  };

  const getCategoryLabel = (value: string) => {
    return t(`ads.categories.${value}`, value);
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
        throw new Error(error.error || t("ads.fileError"));
      }

      const data = await response.json();
      setExtractedFiles(prev => [...prev, { filename: data.filename, text: data.text }]);
      
      const currentPrompt = form.getValues("prompt");
      const separator = currentPrompt ? `\n\n--- ${t("ads.fromFile")}: ` + data.filename + " ---\n" : "";
      form.setValue("prompt", currentPrompt + separator + data.text);
      
      toast({ 
        title: t("ads.fileProcessed"), 
        description: t("ads.textFromFile", { filename: data.filename })
      });
    } catch (error) {
      toast({ 
        title: t("common.error"), 
        description: error instanceof Error ? error.message : t("ads.fileError"),
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
    const fileMarkerPattern = /\n\n--- (?:Из файла|From file|Dosyadan|[^-]+): /;
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
    return stageConfigs.findIndex(s => s.key === currentAd.stage) || 0;
  };

  const navigateToStage = async (stageKey: string) => {
    if (!currentAd) return;
    const currentIndex = getCurrentStageIndex();
    const targetIndex = stageConfigs.findIndex(s => s.key === stageKey);
    if (targetIndex < currentIndex) {
      try {
        const res = await apiRequest("PATCH", `/api/ads/${currentAd.id}`, { stage: stageKey });
        const updated = await res.json();
        setCurrentAd(updated);
        queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      } catch (error) {
        console.error("Error navigating to stage:", error);
      }
    }
  };

  const stageHintKeys: Record<string, string> = {
    prompt: "hints.ads.stagePrompt",
    variants: "hints.ads.stageVariants",
    voices: "hints.ads.stageVoices",
    audio: "hints.ads.stageAudio",
    music: "hints.ads.stageMusic",
  };

  const renderStageProgress = () => {
    const currentIndex = getCurrentStageIndex();
    return (
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {stageConfigs.map((stage, index) => {
          const Icon = stage.icon;
          const isActive = index === currentIndex;
          const isCompleted = index < currentIndex;
          const canNavigate = isCompleted;
          return (
            <div key={stage.key} className="flex items-center gap-2">
              <HintTooltip hint={t(stageHintKeys[stage.key])}>
                <button
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-colors ${
                    isActive ? "bg-primary text-primary-foreground" :
                    isCompleted ? "bg-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-500/30 cursor-pointer" :
                    "bg-muted text-muted-foreground"
                  } ${canNavigate ? "" : "cursor-default"}`}
                  onClick={() => canNavigate && navigateToStage(stage.key)}
                  data-testid={`stage-nav-${stage.key}`}
                >
                  {isCompleted ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                  <span className="hidden sm:inline">{t(stage.labelKey)}</span>
                </button>
              </HintTooltip>
              {index < stageConfigs.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
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
              <CardTitle>{t("ads.step1Title")}</CardTitle>
              <CardDescription>
                {t("ads.step1Desc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm font-medium mb-2">{t("ads.yourDescription")}:</p>
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
              <HintTooltip hint={t("hints.ads.generateVariants")}>
                <Button
                  onClick={() => generateVariantsMutation.mutate(currentAd.id)}
                  disabled={generateVariantsMutation.isPending}
                  className="w-full"
                  data-testid="button-generate-variants"
                >
                  {generateVariantsMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("ads.generatingVariants")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {t("ads.generate5Variants")}
                    </>
                  )}
                </Button>
              </HintTooltip>
            </CardContent>
          </Card>
        );

      case "variants":
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t("ads.step2Title")}</CardTitle>
              <CardDescription>
                {t("ads.step2Desc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedVariantForEdit !== null && (
                <div className="rounded-lg border border-primary bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge>{t("ads.selectedVariantN", { n: selectedVariantForEdit + 1 })}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedVariantForEdit(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {currentAd.variants?.[selectedVariantForEdit]}
                  </p>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("ads.whatToChange")}</label>
                    <div className="flex gap-2">
                      <div className="flex-1 flex gap-1 items-center">
                        <Textarea
                          value={editInstructions}
                          onChange={(e) => setEditInstructions(e.target.value)}
                          placeholder={t("ads.editPlaceholder")}
                          rows={2}
                          className="flex-1"
                          data-testid="textarea-edit-instructions"
                        />
                        <VoiceInput onTranscript={(text) => setEditInstructions(prev => prev + " " + text)} />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <HintTooltip hint={t("hints.ads.regenerate")}>
                      <Button
                        onClick={() => {
                          regenerateVariantMutation.mutate({
                            adId: currentAd.id,
                            baseText: currentAd.variants?.[selectedVariantForEdit] || "",
                            instructions: editInstructions,
                          });
                          setEditInstructions("");
                          setSelectedVariantForEdit(null);
                        }}
                        disabled={regenerateVariantMutation.isPending}
                        data-testid="button-regenerate"
                      >
                        {regenerateVariantMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        {t("ads.refine5New")}
                      </Button>
                    </HintTooltip>
                    <HintTooltip hint={t("hints.ads.useVariant")}>
                      <Button
                        variant="default"
                        onClick={() => {
                          selectVariantMutation.mutate({ 
                            adId: currentAd.id, 
                            variantIndex: selectedVariantForEdit 
                          });
                        }}
                        disabled={selectVariantMutation.isPending}
                        data-testid="button-use-variant"
                      >
                        <Check className="mr-2 h-4 w-4" />
                        {t("ads.useThis")}
                      </Button>
                    </HintTooltip>
                  </div>
                </div>
              )}

              <ScrollArea className="h-[400px]">
                <div className="space-y-4 pr-4">
                  {currentAd.variants?.map((variant, index) => (
                    <div
                      key={index}
                      className={`rounded-lg border p-4 cursor-pointer transition-colors hover-elevate ${
                        selectedVariantForEdit === index ? "border-primary bg-primary/5" : ""
                      }`}
                      onClick={() => setSelectedVariantForEdit(index)}
                      data-testid={`variant-${index}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Badge variant="outline">{t("ads.variantN", { n: index + 1 })}</Badge>
                        {selectedVariantForEdit === index && (
                          <Badge variant="secondary">{t("ads.selected")}</Badge>
                        )}
                      </div>
                      <div className="text-sm whitespace-pre-wrap">
                        {hasFormattedSpeakers(variant) ? renderMultiSpeakerScript(variant) : variant}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        );

      case "voices":
        const scriptForVoices = currentAd.selectedVariantText || "";
        const isMultiSpeakerAd = hasFormattedSpeakers(scriptForVoices);
        const adSpeakers = isMultiSpeakerAd ? extractSpeakers(scriptForVoices) : [];
        const allVoiceOptions = [
          ...(voices?.filter(v => v.isActive).map(v => ({ id: v.elevenLabsVoiceId, name: getCleanVoiceName(v), gender: v.gender })) || []),
          ...(!voices?.length && elevenLabsVoices?.voices ? elevenLabsVoices.voices.slice(0, 8).map(v => ({ id: v.voice_id, name: v.name, gender: v.labels?.gender })) : []),
        ];
        const canSynthesize = isMultiSpeakerAd
          ? adSpeakers.every(s => adSpeakerVoiceMap[s])
          : !!selectedVoiceId;

        return (
          <Card>
            <CardHeader>
              <CardTitle>{t("ads.step3Title")}</CardTitle>
              <CardDescription>
                {isMultiSpeakerAd ? t("ads.step3DescMulti") : t("ads.step3Desc", { count: currentAd.speakersCount })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4 mb-4">
                <p className="text-sm font-medium mb-2">{t("ads.selectedText")}:</p>
                <div className="text-sm">
                  {isMultiSpeakerAd ? renderMultiSpeakerScript(scriptForVoices) : scriptForVoices}
                </div>
              </div>

              {isMultiSpeakerAd && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4" />
                    <p className="text-sm font-medium">{t("ads.assignVoices")}</p>
                  </div>
                  {adSpeakers.map((speaker, sIdx) => {
                    const colorIdx = sIdx % speakerColors.length;
                    return (
                      <div key={speaker} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`speaker-mapping-${sIdx}`}>
                        <span className={`font-semibold text-sm ${speakerColors[colorIdx]}`}>[{speaker}]</span>
                        <Select
                          value={adSpeakerVoiceMap[speaker] || ""}
                          onValueChange={(val) => setAdSpeakerVoiceMap(prev => ({ ...prev, [speaker]: val }))}
                        >
                          <HintTooltip hint={t("hints.ads.assignVoice")}>
                            <SelectTrigger className="flex-1" data-testid={`select-speaker-voice-${sIdx}`}>
                              <SelectValue placeholder={t("ads.selectVoice")} />
                            </SelectTrigger>
                          </HintTooltip>
                          <SelectContent>
                            {allVoiceOptions.map(v => (
                              <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              )}

              {!isMultiSpeakerAd && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{t("ads.myVoices")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowVoiceLibrary(!showVoiceLibrary)}
                      data-testid="button-add-persona"
                    >
                      {showVoiceLibrary ? <X className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
                      {showVoiceLibrary ? t("common.close") : t("ads.addPersona")}
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {voices?.filter(v => v.isActive).map((voice) => (
                      <div
                        key={voice.id}
                        className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover-elevate ${
                          selectedVoiceId === voice.elevenLabsVoiceId ? "border-primary bg-primary/5" : ""
                        }`}
                        onClick={() => { setSelectedVoiceId(voice.elevenLabsVoiceId); setSelectedVoiceName(getCleanVoiceName(voice)); }}
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
                          <p className="font-medium truncate">{getCleanVoiceName(voice)}</p>
                          <p className="text-xs text-muted-foreground">
                            {voice.gender === "male" ? t("ads.male") : t("ads.female")}
                          </p>
                        </div>
                        {selectedVoiceId === voice.elevenLabsVoiceId && (
                          <Check className="h-5 w-5 text-primary" />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {showVoiceLibrary && (
                <div className="border rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium">{t("ads.voiceLibrary")}</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t("ads.searchVoicePlaceholder")}
                      value={voiceSearchQuery}
                      onChange={(e) => setVoiceSearchQuery(e.target.value)}
                      className="flex-1"
                      data-testid="input-voice-search"
                    />
                    <Select value={voiceSearchLanguage} onValueChange={setVoiceSearchLanguage}>
                      <SelectTrigger className="w-36" data-testid="select-voice-language">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("ads.allLanguages")}</SelectItem>
                        <SelectItem value="arabic">العربية</SelectItem>
                        <SelectItem value="bulgarian">Български</SelectItem>
                        <SelectItem value="chinese">中文</SelectItem>
                        <SelectItem value="croatian">Hrvatski</SelectItem>
                        <SelectItem value="czech">Čeština</SelectItem>
                        <SelectItem value="danish">Dansk</SelectItem>
                        <SelectItem value="dutch">Nederlands</SelectItem>
                        <SelectItem value="english">English</SelectItem>
                        <SelectItem value="filipino">Filipino</SelectItem>
                        <SelectItem value="finnish">Suomi</SelectItem>
                        <SelectItem value="french">Français</SelectItem>
                        <SelectItem value="german">Deutsch</SelectItem>
                        <SelectItem value="greek">Ελληνικά</SelectItem>
                        <SelectItem value="hebrew">עברית</SelectItem>
                        <SelectItem value="hindi">हिन्दी</SelectItem>
                        <SelectItem value="hungarian">Magyar</SelectItem>
                        <SelectItem value="indonesian">Bahasa Indonesia</SelectItem>
                        <SelectItem value="italian">Italiano</SelectItem>
                        <SelectItem value="japanese">日本語</SelectItem>
                        <SelectItem value="korean">한국어</SelectItem>
                        <SelectItem value="malay">Bahasa Melayu</SelectItem>
                        <SelectItem value="norwegian">Norsk</SelectItem>
                        <SelectItem value="polish">Polski</SelectItem>
                        <SelectItem value="portuguese">Português</SelectItem>
                        <SelectItem value="romanian">Română</SelectItem>
                        <SelectItem value="russian">Русский</SelectItem>
                        <SelectItem value="slovak">Slovenčina</SelectItem>
                        <SelectItem value="spanish">Español</SelectItem>
                        <SelectItem value="swedish">Svenska</SelectItem>
                        <SelectItem value="tamil">தமிழ்</SelectItem>
                        <SelectItem value="turkish">Türkçe</SelectItem>
                        <SelectItem value="ukrainian">Українська</SelectItem>
                        <SelectItem value="vietnamese">Tiếng Việt</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={voiceSearchGender} onValueChange={setVoiceSearchGender}>
                      <SelectTrigger className="w-28" data-testid="select-voice-gender">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("ads.allGenders")}</SelectItem>
                        <SelectItem value="male">{t("ads.male")}</SelectItem>
                        <SelectItem value="female">{t("ads.female")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {isSearchingVoices ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <ScrollArea className="h-[250px]">
                      <div className="grid gap-2">
                        {sharedVoicesData?.voices?.map((voice) => (
                          <div
                            key={voice.voice_id}
                            className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover-elevate ${
                              selectedVoiceId === voice.voice_id ? "border-primary bg-primary/5" : ""
                            }`}
                            onClick={() => { setSelectedVoiceId(voice.voice_id); setSelectedVoiceName(voice.name); }}
                            data-testid={`shared-voice-${voice.voice_id}`}
                          >
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                              voice.labels?.gender === "male" ? "bg-blue-500/20" : "bg-pink-500/20"
                            }`}>
                              <User className={`h-5 w-5 ${
                                voice.labels?.gender === "male" ? "text-blue-500" : "text-pink-500"
                              }`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate text-sm">{voice.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {[voice.labels?.language, voice.labels?.gender, voice.labels?.accent, voice.labels?.age].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              {voice.preview_url && (
                                <HintTooltip hint={t("hints.ads.previewVoiceLibrary")}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      previewVoice(voice.preview_url!);
                                    }}
                                    data-testid={`preview-voice-${voice.voice_id}`}
                                  >
                                    {previewingVoiceUrl === voice.preview_url ? (
                                      <PauseCircle className="h-4 w-4" />
                                    ) : (
                                      <PlayCircle className="h-4 w-4" />
                                    )}
                                  </Button>
                                </HintTooltip>
                              )}
                              {selectedVoiceId === voice.voice_id && (
                                <Check className="h-4 w-4 text-primary" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}

              <HintTooltip hint={t("hints.ads.synthesize")}>
                <Button
                  onClick={() => {
                    if (isMultiSpeakerAd) {
                      const firstVoiceId = Object.values(adSpeakerVoiceMap)[0] || "";
                      synthesizeAudioMutation.mutate({
                        adId: currentAd.id,
                        voiceIds: Object.values(adSpeakerVoiceMap),
                        speakerVoiceMap: adSpeakerVoiceMap,
                      });
                    } else if (selectedVoiceId) {
                      synthesizeAudioMutation.mutate({
                        adId: currentAd.id,
                        voiceIds: [selectedVoiceId],
                        voiceName: selectedVoiceName || undefined,
                      });
                    }
                  }}
                  disabled={!canSynthesize || synthesizeAudioMutation.isPending}
                  className="w-full"
                  data-testid="button-synthesize"
                >
                  {synthesizeAudioMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("ads.synthesizing")}
                    </>
                  ) : (
                    <>
                      <Volume2 className="mr-2 h-4 w-4" />
                      {t("ads.synthesizeAudio")}
                    </>
                  )}
                </Button>
              </HintTooltip>
            </CardContent>
          </Card>
        );

      case "audio":
        const audioVersions: Array<{ url: string; voiceId: string; voiceName: string; createdAt: string; duration: number }> = (() => {
          try {
            if (currentAd.audioVersions) {
              const parsed = JSON.parse(currentAd.audioVersions);
              return Array.isArray(parsed) ? parsed : [];
            }
            return [];
          } catch { return []; }
        })();
        const latestVersion = audioVersions.length > 0 ? audioVersions[audioVersions.length - 1] : null;
        const latestVoiceName = latestVersion?.voiceName || t("ads.audioReady");
        return (
          <Card>
            <CardHeader>
              <CardTitle>{t("ads.step4Title")}</CardTitle>
              <CardDescription>
                {t("ads.step4Desc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4">
                <div className="text-sm">
                  {currentAd.selectedVariantText && hasFormattedSpeakers(currentAd.selectedVariantText)
                    ? renderMultiSpeakerScript(currentAd.selectedVariantText)
                    : currentAd.selectedVariantText}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-4 w-4" />
                    <span className="font-medium">{t("ads.audioVersionsTitle")}</span>
                  </div>
                  <div className="flex border rounded-md overflow-hidden">
                    {[1, 1.5, 2].map((speed) => (
                      <button
                        key={speed}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                          playbackSpeed === speed
                            ? "bg-primary text-primary-foreground"
                            : "bg-background hover:bg-muted text-muted-foreground"
                        }`}
                        onClick={() => setPlaybackSpeed(speed)}
                        data-testid={`speed-${speed}x`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  {audioVersions.map((version, idx) => {
                    const isCurrentlyPlaying = playingVersionUrl === version.url;
                    const isCurrent = version.url === currentAd.audioUrl;
                    return (
                      <div key={idx} data-testid={`audio-version-${idx}`}>
                        <div
                          className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors ${
                            isCurrent ? "border-green-500 bg-green-500/5" : ""
                          } ${isCurrentlyPlaying ? "bg-primary/5" : ""}`}
                        >
                          <HintTooltip hint={t("hints.ads.playAudio")}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => playVersionAudio(version.url)}
                              data-testid={`play-version-${idx}`}
                            >
                              {isCurrentlyPlaying ? (
                                <PauseCircle className="h-5 w-5 text-primary" />
                              ) : (
                                <PlayCircle className="h-5 w-5" />
                              )}
                            </Button>
                          </HintTooltip>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                              <span className="text-sm font-medium truncate">{version.voiceName}</span>
                              {isCurrent && (
                                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                              )}
                            </div>
                            {version.duration > 0 && (
                              <span className="text-xs text-muted-foreground">{version.duration} {t("ads.sec")}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                              <a href={version.url} download={`${currentAd.title || "ad"}_v${idx + 1}.mp3`} data-testid={`download-version-${idx}`}>
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteVersionMutation.mutate({ adId: currentAd.id, versionIndex: idx })}
                              disabled={deleteVersionMutation.isPending}
                              data-testid={`delete-version-${idx}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {isCurrentlyPlaying && (
                          <div className="px-2 pb-2 pt-1">
                            <div
                              className="h-1.5 bg-muted rounded-full cursor-pointer relative group"
                              onClick={seekVersionAudio}
                              data-testid={`seek-bar-${idx}`}
                            >
                              <div
                                className="h-full bg-primary rounded-full transition-all relative"
                                style={{ width: `${versionProgress}%` }}
                              >
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                              <span>{formatTime(versionCurrentTime)}</span>
                              <span>{formatTime(versionDurationSec)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {audioVersions.length === 0 && currentAd.audioUrl && (
                  <div className="flex items-center gap-2 rounded-lg border p-2.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => playVersionAudio(currentAd.audioUrl!)}
                      data-testid="button-play-audio"
                    >
                      {playingVersionUrl === currentAd.audioUrl ? (
                        <PauseCircle className="h-5 w-5 text-primary" />
                      ) : (
                        <PlayCircle className="h-5 w-5" />
                      )}
                    </Button>
                    <div className="flex-1">
                      <p className="text-sm font-medium">#1</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                      <a href={currentAd.audioUrl} download={`${currentAd.title || "ad"}.mp3`} data-testid="button-download-audio">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                )}
              </div>

              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{t("ads.reRenderVoice")}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowVoiceLibrary(!showVoiceLibrary)}
                    data-testid="toggle-voice-library-audio"
                  >
                    {showVoiceLibrary ? t("ads.myVoices") : t("ads.voiceLibrary")}
                  </Button>
                </div>

                {!showVoiceLibrary ? (
                  <div className="flex gap-2 flex-wrap">
                    {voices?.filter(v => v.isActive).map((voice) => (
                      <Button
                        key={voice.id}
                        variant={selectedVoiceId === voice.elevenLabsVoiceId ? "default" : "outline"}
                        size="sm"
                        onClick={() => { setSelectedVoiceId(voice.elevenLabsVoiceId); setSelectedVoiceName(getCleanVoiceName(voice)); }}
                        data-testid={`rerender-voice-${voice.id}`}
                      >
                        <Volume2 className="mr-1 h-3 w-3" />
                        {getCleanVoiceName(voice)}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder={t("ads.searchVoicePlaceholder")}
                        value={voiceSearchQuery}
                        onChange={(e) => setVoiceSearchQuery(e.target.value)}
                        className="flex-1"
                        data-testid="input-voice-search-audio"
                      />
                      <Select value={voiceSearchLanguage} onValueChange={setVoiceSearchLanguage}>
                        <SelectTrigger className="w-32" data-testid="select-voice-language-audio">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("ads.allLanguages")}</SelectItem>
                          <SelectItem value="arabic">العربية</SelectItem>
                          <SelectItem value="bulgarian">Български</SelectItem>
                          <SelectItem value="chinese">中文</SelectItem>
                          <SelectItem value="croatian">Hrvatski</SelectItem>
                          <SelectItem value="czech">Čeština</SelectItem>
                          <SelectItem value="danish">Dansk</SelectItem>
                          <SelectItem value="dutch">Nederlands</SelectItem>
                          <SelectItem value="english">English</SelectItem>
                          <SelectItem value="filipino">Filipino</SelectItem>
                          <SelectItem value="finnish">Suomi</SelectItem>
                          <SelectItem value="french">Français</SelectItem>
                          <SelectItem value="german">Deutsch</SelectItem>
                          <SelectItem value="greek">Ελληνικά</SelectItem>
                          <SelectItem value="hebrew">עברית</SelectItem>
                          <SelectItem value="hindi">हिन्दी</SelectItem>
                          <SelectItem value="hungarian">Magyar</SelectItem>
                          <SelectItem value="indonesian">Bahasa Indonesia</SelectItem>
                          <SelectItem value="italian">Italiano</SelectItem>
                          <SelectItem value="japanese">日本語</SelectItem>
                          <SelectItem value="korean">한국어</SelectItem>
                          <SelectItem value="malay">Bahasa Melayu</SelectItem>
                          <SelectItem value="norwegian">Norsk</SelectItem>
                          <SelectItem value="polish">Polski</SelectItem>
                          <SelectItem value="portuguese">Português</SelectItem>
                          <SelectItem value="romanian">Română</SelectItem>
                          <SelectItem value="russian">Русский</SelectItem>
                          <SelectItem value="slovak">Slovenčina</SelectItem>
                          <SelectItem value="spanish">Español</SelectItem>
                          <SelectItem value="swedish">Svenska</SelectItem>
                          <SelectItem value="tamil">தமிழ்</SelectItem>
                          <SelectItem value="turkish">Türkçe</SelectItem>
                          <SelectItem value="ukrainian">Українська</SelectItem>
                          <SelectItem value="vietnamese">Tiếng Việt</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={voiceSearchGender} onValueChange={setVoiceSearchGender}>
                        <SelectTrigger className="w-24" data-testid="select-voice-gender-audio">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("ads.allGenders")}</SelectItem>
                          <SelectItem value="male">{t("ads.male")}</SelectItem>
                          <SelectItem value="female">{t("ads.female")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {isSearchingVoices ? (
                      <div className="flex justify-center py-3">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <ScrollArea className="h-[200px]">
                        <div className="grid gap-1.5">
                          {sharedVoicesData?.voices?.map((voice) => (
                            <div
                              key={voice.voice_id}
                              className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition-colors hover:bg-muted/50 ${
                                selectedVoiceId === voice.voice_id ? "border-primary bg-primary/5" : ""
                              }`}
                              onClick={() => { setSelectedVoiceId(voice.voice_id); setSelectedVoiceName(voice.name); }}
                              data-testid={`audio-shared-voice-${voice.voice_id}`}
                            >
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                voice.labels?.gender === "male" ? "bg-blue-500/20" : "bg-pink-500/20"
                              }`}>
                                <User className={`h-4 w-4 ${
                                  voice.labels?.gender === "male" ? "text-blue-500" : "text-pink-500"
                                }`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{voice.name}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {[voice.labels?.language, voice.labels?.gender, voice.labels?.accent].filter(Boolean).join(" · ")}
                                </p>
                              </div>
                              {voice.preview_url && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    previewVoice(voice.preview_url!);
                                  }}
                                  data-testid={`audio-preview-voice-${voice.voice_id}`}
                                >
                                  {previewingVoiceUrl === voice.preview_url ? (
                                    <PauseCircle className="h-4 w-4" />
                                  ) : (
                                    <PlayCircle className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                              {selectedVoiceId === voice.voice_id && (
                                <Check className="h-4 w-4 text-primary shrink-0" />
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}

                <Button
                  onClick={() => {
                    if (selectedVoiceId) {
                      synthesizeAudioMutation.mutate({
                        adId: currentAd.id,
                        voiceIds: [selectedVoiceId],
                        voiceName: selectedVoiceName || undefined,
                      });
                    }
                  }}
                  disabled={!selectedVoiceId || synthesizeAudioMutation.isPending}
                  className="w-full"
                  data-testid="button-resynthesize"
                >
                  {synthesizeAudioMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {t("ads.resynthesizeVoice")}
                </Button>
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Music className="h-4 w-4" />
                    <span className="font-medium">{t("ads.addBackgroundMusic")}</span>
                  </div>
                  <HintTooltip hint={t("hints.ads.autoSelectMusic")}>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={autoSelectMusic}
                      disabled={isAutoSelectingMusic}
                      data-testid="button-auto-select-music"
                    >
                      {isAutoSelectingMusic ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      {t("ads.autoSelect")}
                    </Button>
                  </HintTooltip>
                </div>

                {autoSelectReasoning && (
                  <div className="rounded-lg bg-primary/10 p-3 text-sm">
                    <Sparkles className="inline h-4 w-4 mr-1" />
                    {autoSelectReasoning}
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Input
                    placeholder={t("ads.musicSearchPlaceholder")}
                    value={musicSearchQuery}
                    onChange={(e) => setMusicSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchMusic()}
                    data-testid="input-music-search"
                  />
                  <HintTooltip hint={t("hints.ads.searchMusic")}>
                    <Button
                      variant="outline"
                      onClick={searchMusic}
                      disabled={isSearchingMusic}
                      data-testid="button-search-music"
                    >
                      {isSearchingMusic ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t("ads.find")
                      )}
                    </Button>
                  </HintTooltip>
                </div>

                {musicSearchResults.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {musicSearchResults.map((track) => (
                      <div
                        key={track.id}
                        className={`flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer ${
                          selectedMusicTrack === track.id ? "bg-primary/10 border border-primary" : "bg-muted"
                        }`}
                        onClick={() => setSelectedMusicTrack(track.id === selectedMusicTrack ? null : track.id)}
                        data-testid={`track-item-${track.id}`}
                      >
                        {track.images?.default && (
                          <img
                            src={track.images.default}
                            alt={track.title}
                            className="h-10 w-10 rounded"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{track.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {track.mainArtists?.join(", ")} • {formatMusicDuration(track.length)} • {track.bpm} BPM
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            playMusicPreview(track.id);
                          }}
                          data-testid={`button-play-track-${track.id}`}
                        >
                          {playingMusicTrackId === track.id ? (
                            <PauseCircle className="h-5 w-5" />
                          ) : (
                            <PlayCircle className="h-5 w-5" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedMusicTrack && (
                  <HintTooltip hint={t("hints.ads.mixAudio")}>
                    <Button
                      className="w-full"
                      disabled
                      data-testid="button-mix-audio"
                    >
                      <Music className="mr-2 h-4 w-4" />
                      {t("ads.mixComingSoon")}
                    </Button>
                  </HintTooltip>
                )}
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  const [activeTab, setActiveTab] = useState("create");
  const [editingPreset, setEditingPreset] = useState<AdPreset | null>(null);
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);

  const presetFormSchema = z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    miniPrompt: z.string().min(10),
    contentType: z.string().default("single"),
    speakersCount: z.number().min(1).max(3).default(1),
    voiceIds: z.array(z.string()).optional(),
    announcerVoiceId: z.string().optional(),
    defaultTargetDurationSeconds: z.number().min(10).max(180).default(30),
    defaultCategory: z.string().default("general"),
    elevenLabsTags: z.string().optional(),
    isActive: z.boolean().default(true),
  });

  const presetForm = useForm<z.infer<typeof presetFormSchema>>({
    resolver: zodResolver(presetFormSchema),
    defaultValues: {
      name: "",
      description: "",
      miniPrompt: "",
      contentType: "single",
      speakersCount: 1,
      voiceIds: [],
      announcerVoiceId: "",
      defaultTargetDurationSeconds: 30,
      defaultCategory: "general",
      elevenLabsTags: "",
      isActive: true,
    },
  });

  const contentTypes = [
    { value: "single", label: t("ads.contentTypes.single"), icon: User, description: t("ads.contentTypes.singleDesc") },
    { value: "dialog", label: t("ads.contentTypes.dialog"), icon: Users, description: t("ads.contentTypes.dialogDesc") },
    { value: "dialog_with_announcer", label: t("ads.contentTypes.dialogAnnouncer"), icon: Mic, description: t("ads.contentTypes.dialogAnnouncerDesc") },
  ];

  const createPresetMutation = useMutation({
    mutationFn: async (data: z.infer<typeof presetFormSchema>) => {
      const response = await apiRequest("POST", "/api/ad-presets", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-presets"] });
      setIsPresetDialogOpen(false);
      presetForm.reset();
      toast({ title: t("ads.presetCreated") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const updatePresetMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<z.infer<typeof presetFormSchema>> }) => {
      const response = await apiRequest("PATCH", `/api/ad-presets/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-presets"] });
      setIsPresetDialogOpen(false);
      setEditingPreset(null);
      presetForm.reset();
      toast({ title: t("ads.presetUpdated") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ad-presets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-presets"] });
      toast({ title: t("ads.presetDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const onPresetSubmit = (data: z.infer<typeof presetFormSchema>) => {
    if (editingPreset) {
      updatePresetMutation.mutate({ id: editingPreset.id, data });
    } else {
      createPresetMutation.mutate(data);
    }
  };

  const openEditPresetDialog = (preset: AdPreset) => {
    setEditingPreset(preset);
    presetForm.reset({
      name: preset.name,
      description: preset.description || "",
      miniPrompt: preset.miniPrompt,
      contentType: preset.contentType || "single",
      speakersCount: preset.speakersCount || 1,
      voiceIds: preset.voiceIds || [],
      announcerVoiceId: preset.announcerVoiceId || "",
      defaultTargetDurationSeconds: preset.defaultTargetDurationSeconds || 30,
      defaultCategory: preset.defaultCategory || "general",
      elevenLabsTags: preset.elevenLabsTags || "",
      isActive: preset.isActive !== false,
    });
    setIsPresetDialogOpen(true);
  };

  const openNewPresetDialog = () => {
    setEditingPreset(null);
    presetForm.reset();
    setIsPresetDialogOpen(true);
  };

  const watchContentType = presetForm.watch("contentType");

  const getVoiceName = (voiceId: string) => {
    const voice = voices?.find(v => v.elevenLabsVoiceId === voiceId || v.id === voiceId);
    return voice?.name || voiceId;
  };

  const getContentTypeInfo = (type: string) => {
    return contentTypes.find(t => t.value === type) || contentTypes[0];
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("ads.title")}</h1>
          <p className="text-muted-foreground">{t("ads.subtitle")}</p>
        </div>
        {currentAd && (
          <Button variant="outline" onClick={() => setCurrentAd(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("ads.backToList")}
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <HintTooltip hint={t("hints.ads.createTab")}>
            <TabsTrigger value="create" data-testid="tab-create">
              <Sparkles className="mr-2 h-4 w-4" />
              {t("ads.creation")}
            </TabsTrigger>
          </HintTooltip>
          <HintTooltip hint={t("hints.ads.presetsTab")}>
            <TabsTrigger value="presets" data-testid="tab-presets">
              <FileStack className="mr-2 h-4 w-4" />
              {t("ads.presets")}
            </TabsTrigger>
          </HintTooltip>
        </TabsList>

        <TabsContent value="create" className="mt-6">
          {currentAd ? (
        <>
          {renderStageProgress()}
          {currentAd.status === "generating" ? (
            <Card>
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <p className="font-medium">{t("ads.generatingAudio")}</p>
                  <p className="text-sm text-muted-foreground">{t("ads.mayTakeFewSeconds")}</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/ads"] })}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t("ads.refreshStatus")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            renderCurrentStage()
          )}
        </>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-2 items-start">
                <div className="flex-1 space-y-2">
                  <Textarea
                    placeholder={t("ads.smartPromptPlaceholder")}
                    value={smartPrompt}
                    onChange={(e) => setSmartPrompt(e.target.value)}
                    rows={2}
                    className="resize-none"
                    data-testid="textarea-smart-prompt"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSmartParse();
                      }
                    }}
                  />
                  {smartImagePreview && (
                    <div className="relative inline-block">
                      <img src={smartImagePreview} alt="preview" className="h-16 rounded-md border" />
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs"
                        onClick={() => { setSmartImage(null); setSmartImagePreview(null); }}
                        data-testid="button-remove-smart-image"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <VoiceInput onTranscript={(text) => setSmartPrompt((prev) => (prev ? prev + " " : "") + text)} />
                  <input
                    ref={smartImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleSmartImageSelect}
                    className="hidden"
                    data-testid="input-smart-image"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => smartImageInputRef.current?.click()}
                    data-testid="button-upload-smart-image"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                  <HintTooltip hint={t("hints.ads.smartParse")}>
                    <Button
                      type="button"
                      onClick={handleSmartParse}
                      disabled={isParsingPrompt || (smartPrompt.trim().length < 5 && !smartImage)}
                      size="icon"
                      data-testid="button-smart-parse"
                    >
                      {isParsingPrompt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    </Button>
                  </HintTooltip>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{t("ads.smartPromptHint")}</p>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                {t("ads.createAd")}
              </CardTitle>
              <CardDescription>{t("ads.createAdDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {adPresets && adPresets.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("ads.preset")}</label>
                      <Select 
                        value={selectedPresetId || "none"} 
                        onValueChange={handlePresetSelect}
                      >
                        <SelectTrigger data-testid="select-preset">
                          <SelectValue placeholder={t("ads.selectPreset")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" data-testid="select-preset-none">{t("ads.noPreset")}</SelectItem>
                          {adPresets.filter(p => p.isActive).map((preset) => (
                            <SelectItem key={preset.id} value={preset.id} data-testid={`select-preset-${preset.id}`}>
                              {preset.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedPresetId && (
                        <p className="text-xs text-muted-foreground" data-testid="text-preset-description">
                          {adPresets.find(p => p.id === selectedPresetId)?.description}
                        </p>
                      )}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("ads.clientName")}</FormLabel>
                        <div className="flex gap-1 items-center">
                          <FormControl>
                            <Input
                              placeholder={t("ads.clientNamePlaceholder")}
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
                          <FormLabel>{t("ads.website")}</FormLabel>
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
                          <FormLabel>{t("ads.category")}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-category">
                                <SelectValue placeholder={t("ads.selectCategory")} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categoryKeys.map((key) => (
                                <SelectItem key={key} value={key}>
                                  {t(`ads.categories.${key}`, key)}
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
                          <FormLabel>{t("ads.duration")}</FormLabel>
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
                        <FormLabel>{t("ads.adDescription")}</FormLabel>
                        <div className="flex gap-1 items-start">
                          <FormControl>
                            <Textarea
                              placeholder={t("ads.adDescPlaceholder")}
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
                              title={t("ads.uploadFile")}
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
                          {t("ads.aiWillCreate5")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {extractedFiles.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t("ads.uploadedFiles")}:</p>
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

                  <HintTooltip hint={t("hints.ads.createAd")}>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createAdMutation.isPending}
                      data-testid="button-create-ad"
                    >
                      {createAdMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t("ads.creating")}
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          {t("ads.createAd")}
                        </>
                      )}
                    </Button>
                  </HintTooltip>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("ads.allAds")}</CardTitle>
              <CardDescription>{t("ads.clickToContinue")}</CardDescription>
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
                            {ad.duration && (
                              <Badge variant="outline" className="text-xs">
                                <Clock className="h-3 w-3 mr-1" />
                                {ad.duration} {t("ads.sec")}
                              </Badge>
                            )}
                          </div>
                          {ad.clientName && (
                            <p className="text-sm text-muted-foreground truncate">{ad.clientName}</p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span>{t("ads.stage")}: {t(`ads.stages.${ad.stage}`, ad.stage)}</span>
                            {ad.createdAt && (
                              <span>{new Date(ad.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {ad.status === "ready" ? (
                            <Badge className="bg-green-500">{t("ads.statusReady")}</Badge>
                          ) : ad.status === "generating" ? (
                            <Badge className="bg-yellow-500">{t("ads.statusGenerating")}</Badge>
                          ) : (
                            <Badge variant="outline">{t("ads.statusInProgress")}</Badge>
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
                                <AlertDialogTitle>{t("ads.deleteAd")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("ads.deleteConfirm")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMutation.mutate(ad.id)}>
                                  {t("common.delete")}
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
                  <p>{t("ads.noAdsYet")}</p>
                </div>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      )}
        </TabsContent>

        <TabsContent value="presets" className="mt-6">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
            <div>
              <h2 className="text-xl font-semibold">{t("ads.adPresets")}</h2>
              <p className="text-muted-foreground text-sm">{t("ads.presetsSubtitle")}</p>
            </div>
            <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
              <HintTooltip hint={t("hints.ads.newPreset")}>
                <DialogTrigger asChild>
                  <Button onClick={openNewPresetDialog} data-testid="button-new-preset">
                    <Plus className="mr-2 h-4 w-4" />
                    {t("ads.newPreset")}
                  </Button>
                </DialogTrigger>
              </HintTooltip>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingPreset ? t("ads.editPreset") : t("ads.createPreset")}</DialogTitle>
                  <DialogDescription>
                    {t("ads.presetDialogDesc")}
                  </DialogDescription>
                </DialogHeader>
                <Form {...presetForm}>
                  <form onSubmit={presetForm.handleSubmit(onPresetSubmit)} className="space-y-4">
                    <FormField
                      control={presetForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("ads.presetName")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("ads.presetNamePlaceholder")} {...field} data-testid="input-preset-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={presetForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("ads.description")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("ads.presetDescPlaceholder")} {...field} data-testid="input-preset-description" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={presetForm.control}
                      name="contentType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("ads.contentType")}</FormLabel>
                          <Select onValueChange={(val) => {
                            field.onChange(val);
                            if (val === "single") presetForm.setValue("speakersCount", 1);
                            else if (val === "dialog") presetForm.setValue("speakersCount", 2);
                            else presetForm.setValue("speakersCount", 3);
                          }} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-content-type">
                                <SelectValue placeholder={t("ads.selectType")} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {contentTypes.map((type) => (
                                <SelectItem key={type.value} value={type.value} data-testid={`select-content-type-${type.value}`}>
                                  <div className="flex items-center gap-2">
                                    <type.icon className="h-4 w-4" />
                                    <span>{type.label}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            {getContentTypeInfo(field.value || "single").description}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {voices && voices.length > 0 && (
                      <>
                        {(watchContentType === "single") && (
                          <FormField
                            control={presetForm.control}
                            name="voiceIds"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("ads.voice")}</FormLabel>
                                <Select 
                                  onValueChange={(val) => field.onChange([val])} 
                                  value={field.value?.[0] || ""}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-voice">
                                      <SelectValue placeholder={t("ads.selectVoice")} />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {voices.filter(v => v.isActive).map((voice) => (
                                      <SelectItem key={voice.id} value={voice.elevenLabsVoiceId} data-testid={`select-voice-${voice.id}`}>
                                        {voice.name} {voice.personaName && `(${voice.personaName})`}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        {(watchContentType === "dialog" || watchContentType === "dialog_with_announcer") && (
                          <div className="space-y-4">
                            <FormField
                              control={presetForm.control}
                              name="voiceIds"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t("ads.dialogVoices")}</FormLabel>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <Select 
                                      onValueChange={(val) => {
                                        const current = field.value || [];
                                        field.onChange([val, current[1] || ""]);
                                      }} 
                                      value={field.value?.[0] || ""}
                                    >
                                      <SelectTrigger data-testid="select-voice-1">
                                        <SelectValue placeholder={t("ads.firstVoice")} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {voices.filter(v => v.isActive).map((voice) => (
                                          <SelectItem key={voice.id} value={voice.elevenLabsVoiceId}>
                                            {voice.name} {voice.personaName && `(${voice.personaName})`}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Select 
                                      onValueChange={(val) => {
                                        const current = field.value || [];
                                        field.onChange([current[0] || "", val]);
                                      }} 
                                      value={field.value?.[1] || ""}
                                    >
                                      <SelectTrigger data-testid="select-voice-2">
                                        <SelectValue placeholder={t("ads.secondVoice")} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {voices.filter(v => v.isActive).map((voice) => (
                                          <SelectItem key={voice.id} value={voice.elevenLabsVoiceId}>
                                            {voice.name} {voice.personaName && `(${voice.personaName})`}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {watchContentType === "dialog_with_announcer" && (
                              <FormField
                                control={presetForm.control}
                                name="announcerVoiceId"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>{t("ads.announcerVoice")}</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value || ""}>
                                      <FormControl>
                                        <SelectTrigger data-testid="select-announcer-voice">
                                          <SelectValue placeholder={t("ads.selectAnnouncerVoice")} />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {voices.filter(v => v.isActive).map((voice) => (
                                          <SelectItem key={voice.id} value={voice.elevenLabsVoiceId}>
                                            {voice.name} {voice.personaName && `(${voice.personaName})`}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormDescription>{t("ads.announcerVoiceDesc")}</FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </div>
                        )}
                      </>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={presetForm.control}
                        name="defaultCategory"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("ads.category")}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-category">
                                  <SelectValue placeholder={t("ads.selectCategory")} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {categoryKeys.map((key) => (
                                  <SelectItem key={key} value={key}>
                                    {t(`ads.categories.${key}`, key)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={presetForm.control}
                        name="defaultTargetDurationSeconds"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("ads.duration")}</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={10}
                                max={180}
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 30)}
                                data-testid="input-duration"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={presetForm.control}
                      name="miniPrompt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("ads.generationPrompt")}</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder={t("ads.promptPlaceholder")}
                              rows={4}
                              {...field}
                              data-testid="textarea-prompt"
                            />
                          </FormControl>
                          <FormDescription>
                            {t("ads.promptDescription")}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={presetForm.control}
                      name="elevenLabsTags"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("ads.elevenLabsTags")}</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder={t("ads.tagsPlaceholder")}
                              rows={3}
                              {...field}
                              data-testid="textarea-elevenlabs-tags"
                            />
                          </FormControl>
                          <FormDescription>
                            {t("ads.tagsDescription")}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={presetForm.control}
                      name="isActive"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel>{t("ads.active")}</FormLabel>
                            <FormDescription>
                              {t("ads.activeDesc")}
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-active"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setIsPresetDialogOpen(false)}>
                        {t("common.cancel")}
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={createPresetMutation.isPending || updatePresetMutation.isPending}
                        data-testid="button-save-preset"
                      >
                        {editingPreset ? t("common.save") : t("ads.create")}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {adPresets && adPresets.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {adPresets.map((preset) => {
                const typeInfo = getContentTypeInfo(preset.contentType || "single");
                const TypeIcon = typeInfo.icon;
                return (
                  <Card key={preset.id} className={!preset.isActive ? "opacity-60" : ""} data-testid={`card-preset-${preset.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <TypeIcon className="h-4 w-4" />
                            {preset.name}
                          </CardTitle>
                          {preset.description && (
                            <CardDescription className="text-sm">{preset.description}</CardDescription>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditPresetDialog(preset)}
                            data-testid={`button-edit-${preset.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-delete-${preset.id}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("ads.deletePresetConfirm")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("ads.deleteConfirm")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deletePresetMutation.mutate(preset.id)}>
                                  {t("common.delete")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{typeInfo.label}</Badge>
                        <Badge variant="secondary">{preset.defaultTargetDurationSeconds}{t("ads.sec")}</Badge>
                        {preset.defaultCategory && (
                          <Badge variant="secondary">
                                {getCategoryLabel(preset.defaultCategory)}
                          </Badge>
                        )}
                      </div>
                      
                      {preset.voiceIds && preset.voiceIds.length > 0 && (
                        <div className="text-sm text-muted-foreground">
                          {t("ads.voices")}: {preset.voiceIds.map(id => getVoiceName(id)).join(", ")}
                        </div>
                      )}

                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {preset.miniPrompt}
                      </p>

                      {!preset.isActive && (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("ads.inactive")}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center text-center">
                  <Settings2 className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">{t("ads.noPresets")}</h3>
                  <p className="text-muted-foreground mb-4">
                    {t("ads.noPresetsDesc")}
                  </p>
                  <Button onClick={openNewPresetDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("ads.createPreset")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
