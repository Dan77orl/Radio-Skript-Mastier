import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wand2, Loader2, Calendar, Clock, User, Users, CheckCircle, Edit3, Send, RefreshCw, ChevronDown, ChevronUp, Play, FileText, Save, Search, Globe, X, Trash2, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceInput } from "@/components/voice-input";
import type { Settings, Dialog, NewsItem, Voice } from "@shared/schema";

interface SlotInfo {
  slotNumber: number;
  time: string;
  hour: number;
  voiceIds: string[] | null;
  shiftLabel?: string | null;
}

interface ResolvedTemplate {
  id: string;
  name: string;
  weekdays: number[];
  startHour: number;
  endHour: number;
  slotsPerHour: number;
  voiceIds: string[] | null;
  isActive: boolean;
}

interface ResolvedSlots {
  template: ResolvedTemplate | null;
  slots: SlotInfo[];
  holidays: Array<{ nameRu: string; isPublic: boolean; country: string }>;
}

function getTimeOfDayKey(hour: number): string {
  if (hour < 10) return "morning";
  if (hour < 14) return "afternoon";
  if (hour < 18) return "evening";
  return "lateEvening";
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  return date.toLocaleDateString(undefined, options);
}

export default function Generator({ embedded }: { embedded?: boolean }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [expandedSlots, setExpandedSlots] = useState<Set<number>>(new Set());
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState<string>("");
  const [dailyPromptValue, setDailyPromptValue] = useState<string>("");
  const [isDailyPromptDirty, setIsDailyPromptDirty] = useState(false);
  const [firecrawlTopics, setFirecrawlTopicsState] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [firecrawlContent, setFirecrawlContent] = useState<string>("");
  const [isFirecrawlOpen, setIsFirecrawlOpen] = useState(false);
  const [topicResults, setTopicResults] = useState<Record<string, { status: "pending" | "done" | "error"; preview: string }>>({});
  const [autoTopicsReasoning, setAutoTopicsReasoning] = useState<string>("");
  const [topicsInitialized, setTopicsInitialized] = useState(false);

  const saveTopicsMutation = useMutation({
    mutationFn: async (topics: string[]) => {
      await apiRequest("POST", "/api/settings", { globalFirecrawlTopics: topics });
    },
  });

  const setFirecrawlTopics = (topicsOrFn: string[] | ((prev: string[]) => string[])) => {
    setFirecrawlTopicsState(prev => {
      const newTopics = typeof topicsOrFn === "function" ? topicsOrFn(prev) : topicsOrFn;
      saveTopicsMutation.mutate(newTopics);
      return newTopics;
    });
  };

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings?.dailyPrompt && !isDailyPromptDirty) {
      setDailyPromptValue(settings.dailyPrompt);
    }
  }, [settings?.dailyPrompt, isDailyPromptDirty]);

  useEffect(() => {
    if (settings && !topicsInitialized) {
      const saved = (settings as any).globalFirecrawlTopics;
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setFirecrawlTopicsState(saved);
      } else {
        setFirecrawlTopicsState(["weather Alanya today", "news Turkey"]);
      }
      setTopicsInitialized(true);
    }
  }, [settings, topicsInitialized]);

  const { data: dialogs, isLoading: dialogsLoading } = useQuery<Dialog[]>({
    queryKey: ["/api/dialogs"],
  });

  const { data: newsItems } = useQuery<NewsItem[]>({
    queryKey: ["/api/news-items"],
  });

  const { data: voices } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const { data: resolvedSlots } = useQuery<ResolvedSlots>({
    queryKey: ["/api/resolve-slots", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/resolve-slots?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to resolve slots");
      return res.json();
    },
    enabled: !!selectedDate,
  });

  const totalSlots = resolvedSlots?.slots?.length || settings?.dailyDialogsCount || 12;
  const holidayNames = resolvedSlots?.holidays?.map(h => h.nameRu).join(", ") || null;
  
  const dialogsForDate = dialogs?.filter(d => d.scheduledDate === selectedDate) || [];
  const dialogsBySlot = new Map<number, Dialog>();
  dialogsForDate.forEach(d => {
    if (d.slotNumber) {
      dialogsBySlot.set(d.slotNumber, d);
    }
  });

  const unusedNews = newsItems?.filter(n => !n.isUsed).slice(0, 5) || [];
  const activeVoices = voices?.filter(v => v.isActive) || [];

  const autoTopicsMutation = useMutation({
    mutationFn: async ({ prompt, existingTopics }: { prompt: string; existingTopics?: string[] }) => {
      const response = await apiRequest("POST", "/api/generate-search-topics", { prompt, existingTopics });
      const data = await response.json() as { topics: string[]; reasoning: string };
      return data;
    },
    onSuccess: (data) => {
      setFirecrawlTopics(prev => [...new Set([...prev, ...data.topics])]);
      setAutoTopicsReasoning(data.reasoning || "");
      toast({ title: t("generator.topicsGenerated"), description: `${data.topics.length} ${t("generator.topics")}` });
    },
    onError: () => {
      toast({ title: t("common.error"), variant: "destructive" });
    },
  });

  const firecrawlSearchMutation = useMutation({
    mutationFn: async (topics: string[]) => {
      const results: string[] = [];
      const newTopicResults: Record<string, { status: "pending" | "done" | "error"; preview: string }> = {};
      topics.forEach(t => { newTopicResults[t] = { status: "pending", preview: "" }; });
      setTopicResults({ ...newTopicResults });

      for (const topic of topics) {
        try {
          const response = await apiRequest("POST", "/api/firecrawl/search", { query: topic, limit: 3 });
          const data = await response.json() as { results: string[] };
          if (data.results?.length) {
            const content = data.results.join("\n\n");
            results.push(`--- ${topic} ---\n${content}`);
            const preview = content.substring(0, 150).replace(/\n/g, " ").trim();
            newTopicResults[topic] = { status: "done", preview };
          } else {
            newTopicResults[topic] = { status: "done", preview: "" };
          }
        } catch {
          newTopicResults[topic] = { status: "error", preview: "" };
        }
        setTopicResults({ ...newTopicResults });
      }
      return results.join("\n\n");
    },
    onSuccess: (content) => {
      setFirecrawlContent(content);
      toast({
        title: t("generator.contentFound"),
        description: t("generator.webContentLoaded"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("generator.searchError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [generatingDates, setGeneratingDates] = useState<Set<string>>(new Set());

  const generateAllSlotsMutation = useMutation({
    mutationFn: async (data: { date: string; totalSlots: number; firecrawlContent?: string }) => {
      setGeneratingDates(prev => new Set([...prev, data.date]));
      const response = await apiRequest("POST", "/api/generate-day-dialogs", data);
      return { result: await response.json() as { dialogs: Dialog[]; generatedCount: number }, date: data.date };
    },
    onSuccess: ({ result, date }) => {
      setGeneratingDates(prev => { const next = new Set(prev); next.delete(date); return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      toast({
        title: t("generator.dialogsGenerated"),
        description: t("generator.createdCount", { count: result.generatedCount, date: formatDate(date) }),
      });
    },
    onError: (error: Error, variables) => {
      setGeneratingDates(prev => { const next = new Set(prev); next.delete(variables.date); return next; });
      toast({
        title: t("common.error"),
        description: error.message || t("generator.generateError"),
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
        title: t("generator.dialogUpdated"),
        description: t("generator.textRegenerated"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
        description: error.message || t("generator.regenerateError"),
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
        title: t("generator.sentToAutomation"),
        description: t("generator.addedToQueue", { count: data.queued }),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
        description: error.message || t("generator.automationError"),
        variant: "destructive",
      });
    },
  });

  const saveDailyPromptMutation = useMutation({
    mutationFn: async (dailyPrompt: string) => {
      const response = await apiRequest("POST", "/api/settings", { dailyPrompt });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setIsDailyPromptDirty(false);
      toast({
        title: t("generator.dailyPromptSaved"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
        description: error.message || t("generator.savePromptError"),
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

  const [editMaleText, setEditMaleText] = useState("");
  const [editFemaleText, setEditFemaleText] = useState("");

  const startEditing = (slotNumber: number, dialog: Dialog) => {
    setEditingSlot(slotNumber);
    setEditPrompt(dialog.prompt || "");
    setEditMaleText(dialog.maleText || "");
    setEditFemaleText(dialog.femaleText || "");
  };

  const cancelEditing = () => {
    setEditingSlot(null);
    setEditPrompt("");
    setEditMaleText("");
    setEditFemaleText("");
  };

  const saveEdit = (dialog: Dialog) => {
    if (!editPrompt.trim()) return;
    regenerateSlotMutation.mutate({ dialogId: dialog.id, prompt: editPrompt });
  };

  const saveTextMutation = useMutation({
    mutationFn: async ({ dialogId, maleText, femaleText }: { dialogId: string; maleText: string; femaleText: string }) => {
      const response = await apiRequest("PATCH", `/api/dialogs/${dialogId}`, { maleText, femaleText });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      cancelEditing();
      toast({ title: t("common.saved") });
    },
  });

  const autoTagsMutation = useMutation({
    mutationFn: async (dialogId: string) => {
      const response = await apiRequest("POST", `/api/dialogs/${dialogId}/auto-tags`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dialogs"] });
      toast({ title: t("generator.tagsAdded") });
    },
    onError: () => {
      toast({ title: t("common.error"), variant: "destructive" });
    },
  });

  const onGenerateAllSlots = () => {
    generateAllSlotsMutation.mutate({ 
      date: selectedDate, 
      totalSlots,
      firecrawlContent: firecrawlContent || undefined 
    });
  };

  const onSendToAutomation = () => {
    sendToAutomationMutation.mutate({ date: selectedDate });
  };

  const addTopic = () => {
    if (newTopic.trim() && !firecrawlTopics.includes(newTopic.trim())) {
      setFirecrawlTopics([...firecrawlTopics, newTopic.trim()]);
      setNewTopic("");
    }
  };

  const removeTopic = (topic: string) => {
    setFirecrawlTopics(firecrawlTopics.filter(t => t !== topic));
  };

  const readyDialogsCount = dialogsForDate.filter(d => d.maleText && d.femaleText).length;
  const hasAnyDialogs = dialogsForDate.length > 0;

  return (
    <div className={`flex-1 space-y-6 ${embedded ? "" : "p-6"}`}>
      {!embedded && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("generator.title")}</h1>
            <p className="text-muted-foreground">{t("generator.subtitle")}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    {t("generator.selectDay")}
                  </CardTitle>
                  <CardDescription>
                    {formatDate(selectedDate)}
                    {holidayNames && (
                      <Badge variant="secondary" className="ml-2">
                        {holidayNames}
                      </Badge>
                    )}
                    {resolvedSlots?.template && (
                      <Badge variant="outline" className="ml-2">
                        {resolvedSlots.template.name}
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
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={onGenerateAllSlots}
                  disabled={generatingDates.has(selectedDate)}
                  data-testid="button-generate-all"
                >
                  {generatingDates.has(selectedDate) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  {t("generator.generateAllSlots", { count: totalSlots })}
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
                    {t("generator.sendToAutomation", { count: readyDialogsCount })}
                  </Button>
                )}
              </div>

              {firecrawlContent && (
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Globe className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">{t("generator.webContentConnected")}</span>
                    <Badge variant="secondary" className="text-xs">{firecrawlContent.split('\n').filter(l => l.startsWith('---')).length} {t("generator.topics")}</Badge>
                  </div>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {t("generator.usedForAccuracy")}
                  </p>
                </div>
              )}

              {generatingDates.has(selectedDate) && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <div>
                    <p className="font-medium">{t("generator.generating")}</p>
                    <p className="text-sm text-muted-foreground">{t("generator.generatingTime")}</p>
                  </div>
                </div>
              )}
              {generatingDates.size > 0 && !generatingDates.has(selectedDate) && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    {t("generator.generatingOtherDays", { count: generatingDates.size })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {t("generator.dailyPrompt")}
                </CardTitle>
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
                    {t("common.save")}
                  </Button>
                )}
              </div>
              <CardDescription>
                {t("generator.dailyPromptDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Textarea
                  value={dailyPromptValue}
                  onChange={(e) => {
                    setDailyPromptValue(e.target.value);
                    setIsDailyPromptDirty(true);
                  }}
                  placeholder={t("generator.dailyPromptPlaceholder")}
                  className="min-h-[120px] text-sm pr-12"
                  data-testid="textarea-daily-prompt"
                />
                <div className="absolute right-2 top-2">
                  <VoiceInput 
                    onTranscript={(text) => {
                      setDailyPromptValue(prev => prev + " " + text);
                      setIsDailyPromptDirty(true);
                    }} 
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                {t("generator.slotsOfDay", { current: dialogsForDate.length, total: totalSlots })}
              </CardTitle>
              <CardDescription>{t("generator.clickToExpand")}</CardDescription>
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
                      const slotInfo = resolvedSlots?.slots?.[i];
                      const timeLabel = slotInfo?.time || `${Math.floor(7 + (i * 15 / totalSlots))}:00`;
                      const _hour = slotInfo?.hour || Math.floor(7 + (i * 15 / totalSlots));

                      const slotVoiceNames = slotInfo?.voiceIds
                        ?.map(id => activeVoices.find(v => v.id === id))
                        .filter(Boolean)
                        .map(v => v!.personaName || v!.name) || [];

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
                                  {t("generator.slot")} #{slotNumber}
                                </span>
                                <Badge variant="secondary">
                                  {t(`generator.timeOfDay.${getTimeOfDayKey(slotInfo?.hour || Math.floor(7 + (i * 15 / totalSlots)))}`)}
                                </Badge>
                                {slotInfo?.shiftLabel && (
                                  <Badge variant="outline" className="text-xs">
                                    {slotInfo.shiftLabel}
                                  </Badge>
                                )}
                                {slotVoiceNames.length > 0 && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {slotVoiceNames.join(", ")}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {dialog ? (
                                  <>
                                    {dialog.maleText && dialog.femaleText ? (
                                      <Badge variant="default" className="bg-green-600">
                                        <CheckCircle className="mr-1 h-3 w-3" />
                                        {t("statuses.ready")}
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary">
                                        <Clock className="mr-1 h-3 w-3" />
                                        {t("statuses.generating")}
                                      </Badge>
                                    )}
                                  </>
                                ) : (
                                  <Badge variant="outline">{t("generator.empty")}</Badge>
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
                                        {t("common.edit")}
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {isEditing ? (
                                  <div className="space-y-3">
                                    {(() => {
                                      const maleVoice = slotInfo?.voiceIds?.[0] ? activeVoices.find(v => v.id === slotInfo.voiceIds[0]) : null;
                                      const femaleVoice = slotInfo?.voiceIds?.[1] ? activeVoices.find(v => v.id === slotInfo.voiceIds[1]) : null;
                                      const maleName = maleVoice?.personaName || maleVoice?.name || t("generator.maleVoice");
                                      const femaleName = femaleVoice?.personaName || femaleVoice?.name || t("generator.femaleVoice");
                                      return (
                                        <>
                                          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                            <div className="flex items-center gap-2 mb-2">
                                              <User className="h-4 w-4 text-blue-500" />
                                              <span className="text-sm font-medium text-blue-700 dark:text-blue-400">{maleName}</span>
                                            </div>
                                            <Textarea
                                              value={editMaleText}
                                              onChange={(e) => setEditMaleText(e.target.value)}
                                              className="min-h-[80px] bg-background"
                                              data-testid={`textarea-male-${slotNumber}`}
                                            />
                                          </div>
                                          <div className="p-3 rounded-lg bg-pink-500/10 border border-pink-500/20">
                                            <div className="flex items-center gap-2 mb-2">
                                              <User className="h-4 w-4 text-pink-500" />
                                              <span className="text-sm font-medium text-pink-700 dark:text-pink-400">{femaleName}</span>
                                            </div>
                                            <Textarea
                                              value={editFemaleText}
                                              onChange={(e) => setEditFemaleText(e.target.value)}
                                              className="min-h-[80px] bg-background"
                                              data-testid={`textarea-female-${slotNumber}`}
                                            />
                                          </div>
                                        </>
                                      );
                                    })()}
                                    <div className="flex gap-2 flex-wrap">
                                      <Button
                                        size="sm"
                                        onClick={() => saveTextMutation.mutate({ dialogId: dialog.id, maleText: editMaleText, femaleText: editFemaleText })}
                                        disabled={saveTextMutation.isPending}
                                        data-testid={`button-save-text-${slotNumber}`}
                                      >
                                        {saveTextMutation.isPending ? (
                                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                        ) : (
                                          <Save className="mr-1 h-3 w-3" />
                                        )}
                                        {t("common.save")}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => autoTagsMutation.mutate(dialog.id)}
                                        disabled={autoTagsMutation.isPending}
                                        data-testid={`button-auto-tags-${slotNumber}`}
                                      >
                                        {autoTagsMutation.isPending ? (
                                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                        ) : (
                                          <Wand2 className="mr-1 h-3 w-3" />
                                        )}
                                        {t("generator.autoTags")}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={cancelEditing}
                                        data-testid={`button-cancel-${slotNumber}`}
                                      >
                                        {t("common.cancel")}
                                      </Button>
                                    </div>
                                    <Collapsible>
                                      <CollapsibleTrigger asChild>
                                        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                          <RefreshCw className="h-3 w-3" />
                                          {t("generator.regenerate")}
                                          <ChevronDown className="h-3 w-3" />
                                        </button>
                                      </CollapsibleTrigger>
                                      <CollapsibleContent>
                                        <div className="mt-2 space-y-2">
                                          <Textarea
                                            value={editPrompt}
                                            onChange={(e) => setEditPrompt(e.target.value)}
                                            placeholder={t("generator.regeneratePromptPlaceholder")}
                                            className="min-h-[60px] text-xs"
                                            data-testid={`textarea-regen-${slotNumber}`}
                                          />
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => saveEdit(dialog)}
                                            disabled={regenerateSlotMutation.isPending}
                                            data-testid={`button-regen-${slotNumber}`}
                                          >
                                            {regenerateSlotMutation.isPending ? (
                                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                            ) : (
                                              <RefreshCw className="mr-1 h-3 w-3" />
                                            )}
                                            {t("generator.regenerate")}
                                          </Button>
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {(() => {
                                      const maleVoice = slotInfo?.voiceIds?.[0] ? activeVoices.find(v => v.id === slotInfo.voiceIds[0]) : null;
                                      const femaleVoice = slotInfo?.voiceIds?.[1] ? activeVoices.find(v => v.id === slotInfo.voiceIds[1]) : null;
                                      const maleName = maleVoice?.personaName || maleVoice?.name || t("generator.maleVoice");
                                      const femaleName = femaleVoice?.personaName || femaleVoice?.name || t("generator.femaleVoice");
                                      return (
                                        <>
                                          {dialog.maleText && (
                                            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                              <div className="flex items-center gap-2 mb-2">
                                                <User className="h-4 w-4 text-blue-500" />
                                                <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                                                  {maleName}
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
                                                  {femaleName}
                                                </span>
                                              </div>
                                              <p className="text-sm">{dialog.femaleText}</p>
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                    {dialog.audioUrl && (
                                      <div className="flex items-center gap-2">
                                        <Button size="sm" variant="outline" asChild>
                                          <a href={dialog.audioUrl} target="_blank" rel="noopener noreferrer">
                                            <Play className="mr-1 h-3 w-3" />
                                            {t("generator.listen")}
                                          </a>
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={(e) => { e.stopPropagation(); autoTagsMutation.mutate(dialog.id); }}
                                          disabled={autoTagsMutation.isPending}
                                          data-testid={`button-auto-tags-view-${slotNumber}`}
                                        >
                                          {autoTagsMutation.isPending ? (
                                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="mr-1 h-3 w-3" />
                                          )}
                                          {t("generator.autoTags")}
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-2 p-4 rounded-lg border bg-muted/30 text-center">
                                <p className="text-sm text-muted-foreground">
                                  {t("generator.notGenerated")}
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
            <CardHeader className="pb-3">
              <CardTitle>{t("generator.dayStats")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{dialogsForDate.length}</p>
                  <p className="text-xs text-muted-foreground">{t("generator.created")}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{readyDialogsCount}</p>
                  <p className="text-xs text-muted-foreground">{t("statuses.ready")}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{dialogsForDate.filter(d => d.audioUrl).length}</p>
                  <p className="text-xs text-muted-foreground">{t("generator.withAudio")}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <p className="text-2xl font-bold">{totalSlots - dialogsForDate.length}</p>
                  <p className="text-xs text-muted-foreground">{t("generator.remaining")}</p>
                </div>
              </div>
              {dialogsForDate.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t("generator.progress")}</span>
                    <span>{Math.round((dialogsForDate.length / totalSlots) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500 rounded-full transition-all" 
                      style={{ width: `${(dialogsForDate.length / totalSlots) * 100}%` }} 
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Firecrawl
              </CardTitle>
              <CardDescription>
                {t("generator.searchWebContent")}
              </CardDescription>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => autoTopicsMutation.mutate({ prompt: dailyPromptValue || settings?.dailyPrompt || "", existingTopics: firecrawlTopics })}
                  disabled={autoTopicsMutation.isPending}
                  data-testid="button-auto-topics"
                >
                  {autoTopicsMutation.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1 h-3.5 w-3.5" />
                  )}
                  {t("generator.suggestTopics")}
                </Button>
                <Button
                  size="sm"
                  variant={firecrawlContent ? "default" : "outline"}
                  className={firecrawlContent ? "bg-green-600 hover:bg-green-700" : ""}
                  onClick={() => firecrawlSearchMutation.mutate(firecrawlTopics)}
                  disabled={firecrawlSearchMutation.isPending || firecrawlTopics.length === 0}
                  data-testid="button-firecrawl-search"
                >
                  {firecrawlSearchMutation.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="mr-1 h-3.5 w-3.5" />
                  )}
                  {firecrawlContent ? t("common.refresh") : t("common.find")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {autoTopicsReasoning && (
                <div className="text-xs text-muted-foreground bg-violet-500/10 border border-violet-500/20 rounded-lg p-2.5 flex items-start gap-2">
                  <Wand2 className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                  <span>{autoTopicsReasoning}</span>
                  <button onClick={() => setAutoTopicsReasoning("")} className="ml-auto shrink-0 hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <div className="space-y-1.5">
                {firecrawlTopics.map(topic => {
                  const result = topicResults[topic];
                  return (
                    <div key={topic} className="flex items-start gap-2 group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {result?.status === "pending" && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />}
                          {result?.status === "done" && result.preview && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                          {result?.status === "done" && !result.preview && <X className="h-3 w-3 text-orange-400 shrink-0" />}
                          {result?.status === "error" && <X className="h-3 w-3 text-red-500 shrink-0" />}
                          {!result && <Search className="h-3 w-3 text-muted-foreground shrink-0" />}
                          <Badge variant="secondary" className="gap-1 pr-1 text-xs">
                            {topic}
                            <button
                              onClick={() => removeTopic(topic)}
                              className="ml-0.5 hover:text-destructive rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                              data-testid={`remove-topic-${topic}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        </div>
                        {result?.status === "done" && result.preview && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 ml-5 line-clamp-2">{result.preview}</p>
                        )}
                        {result?.status === "done" && !result.preview && (
                          <p className="text-[11px] text-orange-500 mt-0.5 ml-5">{t("generator.noResults")}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-1.5">
                <Input
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder={t("generator.addTopic")}
                  className="h-8 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addTopic()}
                  data-testid="input-new-topic"
                />
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={addTopic}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {firecrawlContent && (
                <Collapsible open={isFirecrawlOpen} onOpenChange={setIsFirecrawlOpen}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 hover:underline w-full">
                      <CheckCircle className="h-3 w-3" />
                      {t("generator.contentLoaded")} ({Math.round(firecrawlContent.length / 1024)}KB)
                      {isFirecrawlOpen ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 rounded-lg border bg-muted/50 p-2 max-h-[200px] overflow-y-auto">
                      <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{firecrawlContent.substring(0, 1500)}{firecrawlContent.length > 1500 ? "..." : ""}</pre>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-6 text-xs text-destructive"
                      onClick={() => { setFirecrawlContent(""); setTopicResults({}); }}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      {t("common.clear")}
                    </Button>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {firecrawlSearchMutation.isPending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("generator.searchingInfo")} ({Object.values(topicResults).filter(r => r.status === "done").length}/{firecrawlTopics.length})
                </div>
              )}
            </CardContent>
          </Card>

          {unusedNews.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>{t("generator.freshNews")}</CardTitle>
                <CardDescription>{t("generator.usedInGeneration")}</CardDescription>
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
            <CardHeader className="pb-3">
              <CardTitle>{t("generator.promptSettings")}</CardTitle>
              <CardDescription>{t("generator.promptSettingsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" asChild>
                <a href="/settings">{t("generator.goToSettings")}</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
