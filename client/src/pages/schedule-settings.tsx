import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog as DialogUI,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Clock, Users, Calendar, Settings2, Loader2, Edit3, ChevronDown, ChevronUp, PartyPopper, Globe } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCleanVoiceName } from "@/lib/utils";
import { HintTooltip } from "@/components/hint-tooltip";
import type { Voice, InsertScheduleTemplate, InsertHostShift, CustomHoliday, InsertCustomHoliday } from "@shared/schema";

interface ScheduleTemplate {
  id: string;
  name: string;
  weekdays: number[];
  startHour: number;
  endHour: number;
  slotsPerHour: number;
  voiceIds: string[] | null;
  isActive: boolean | null;
  sortOrder: number | null;
}

interface HostShift {
  id: string;
  templateId: string;
  startHour: number;
  endHour: number;
  voiceIds: string[];
  label: string | null;
  sortOrder: number | null;
}

interface Holiday {
  date: string;
  name: string;
  nameRu: string;
  country: string;
  isPublic: boolean;
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 7];

const VOICE_COLORS = [
  { bg: "bg-blue-500", bgLight: "bg-blue-500/20", text: "text-blue-700 dark:text-blue-300", border: "border-blue-500" },
  { bg: "bg-pink-500", bgLight: "bg-pink-500/20", text: "text-pink-700 dark:text-pink-300", border: "border-pink-500" },
  { bg: "bg-emerald-500", bgLight: "bg-emerald-500/20", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500" },
  { bg: "bg-orange-500", bgLight: "bg-orange-500/20", text: "text-orange-700 dark:text-orange-300", border: "border-orange-500" },
  { bg: "bg-violet-500", bgLight: "bg-violet-500/20", text: "text-violet-700 dark:text-violet-300", border: "border-violet-500" },
  { bg: "bg-cyan-500", bgLight: "bg-cyan-500/20", text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-500" },
];

function getVoiceColor(voiceId: string, allVoices: Voice[]) {
  const idx = allVoices.findIndex(v => v.id === voiceId);
  if (idx < 0) return VOICE_COLORS[0];
  return VOICE_COLORS[idx % VOICE_COLORS.length];
}

export default function ScheduleSettings({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [holidayDialogOpen, setHolidayDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | null>(null);
  const [editingShiftTemplateId, setEditingShiftTemplateId] = useState<string | null>(null);
  const [editingHoliday, setEditingHoliday] = useState<CustomHoliday | null>(null);
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(new Set());

  const [formName, setFormName] = useState("");
  const [formWeekdays, setFormWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [formStartHour, setFormStartHour] = useState(7);
  const [formEndHour, setFormEndHour] = useState(22);
  const [formSlotsPerHour, setFormSlotsPerHour] = useState(1);
  const [formVoiceIds, setFormVoiceIds] = useState<string[]>([]);

  const [shiftStartHour, setShiftStartHour] = useState(7);
  const [shiftEndHour, setShiftEndHour] = useState(14);
  const [shiftVoiceIds, setShiftVoiceIds] = useState<string[]>([]);
  const [shiftLabel, setShiftLabel] = useState("");
  const [editingShift, setEditingShift] = useState<HostShift | null>(null);

  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [holidayNameRu, setHolidayNameRu] = useState("");
  const [holidayCountry, setHolidayCountry] = useState("BOTH");
  const [holidayIsPublic, setHolidayIsPublic] = useState(false);

  const { data: templates, isLoading } = useQuery<ScheduleTemplate[]>({
    queryKey: ["/api/schedule-templates"],
  });

  const { data: voices } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const year = new Date().getFullYear();
  const { data: holidays } = useQuery<Holiday[]>({
    queryKey: ["/api/holidays", year],
    queryFn: async () => {
      const res = await fetch(`/api/holidays?year=${year}`);
      return res.json();
    },
  });

  const { data: customHolidays } = useQuery<CustomHoliday[]>({
    queryKey: ["/api/custom-holidays"],
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (data: InsertScheduleTemplate) => {
      const res = await apiRequest("POST", "/api/schedule-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      setDialogOpen(false);
      toast({ title: t("scheduleSettings.templateCreated") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertScheduleTemplate> }) => {
      const res = await apiRequest("PATCH", `/api/schedule-templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      setDialogOpen(false);
      toast({ title: t("scheduleSettings.templateUpdated") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/schedule-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      toast({ title: t("scheduleSettings.templateDeleted") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const createShiftMutation = useMutation({
    mutationFn: async (data: InsertHostShift) => {
      const res = await apiRequest("POST", "/api/host-shifts", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates", variables.templateId, "shifts"] });
      setShiftDialogOpen(false);
      toast({ title: t("scheduleSettings.shiftCreated") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async ({ id, templateId }: { id: string; templateId: string }) => {
      await apiRequest("DELETE", `/api/host-shifts/${id}`);
      return templateId;
    },
    onSuccess: (templateId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates", templateId, "shifts"] });
      toast({ title: t("scheduleSettings.shiftDeleted") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const createHolidayMutation = useMutation({
    mutationFn: async (data: InsertCustomHoliday) => {
      const res = await apiRequest("POST", "/api/custom-holidays", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-holidays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      setHolidayDialogOpen(false);
      toast({ title: t("scheduleSettings.holidayCreated") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const updateHolidayMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertCustomHoliday> }) => {
      const res = await apiRequest("PATCH", `/api/custom-holidays/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-holidays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      setHolidayDialogOpen(false);
      toast({ title: t("scheduleSettings.holidayUpdated") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/custom-holidays/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-holidays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holidays"] });
      toast({ title: t("scheduleSettings.holidayDeleted") });
    },
    onError: () => toast({ title: t("common.error"), variant: "destructive" }),
  });

  const openCreateDialog = () => {
    setEditingTemplate(null);
    setFormName("");
    setFormWeekdays([1, 2, 3, 4, 5]);
    setFormStartHour(7);
    setFormEndHour(22);
    setFormSlotsPerHour(1);
    setFormVoiceIds([]);
    setDialogOpen(true);
  };

  const openEditDialog = (template: ScheduleTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormWeekdays(template.weekdays);
    setFormStartHour(template.startHour);
    setFormEndHour(template.endHour);
    setFormSlotsPerHour(template.slotsPerHour);
    setFormVoiceIds(template.voiceIds || []);
    setDialogOpen(true);
  };

  const openShiftDialog = (templateId: string, shift?: HostShift) => {
    setEditingShiftTemplateId(templateId);
    setEditingShift(shift || null);
    if (shift) {
      setShiftStartHour(shift.startHour);
      setShiftEndHour(shift.endHour);
      setShiftVoiceIds(shift.voiceIds);
      setShiftLabel(shift.label || "");
    } else {
      const tpl = templates?.find(t => t.id === templateId);
      setShiftStartHour(tpl?.startHour || 7);
      setShiftEndHour(tpl ? Math.min(tpl.startHour + 7, tpl.endHour) : 14);
      setShiftVoiceIds([]);
      setShiftLabel("");
    }
    setShiftDialogOpen(true);
  };

  const openHolidayDialog = (holiday?: CustomHoliday) => {
    setEditingHoliday(holiday || null);
    if (holiday) {
      setHolidayDate(holiday.date);
      setHolidayName(holiday.name);
      setHolidayNameRu(holiday.nameRu);
      setHolidayCountry(holiday.country);
      setHolidayIsPublic(holiday.isPublic ?? false);
    } else {
      setHolidayDate("");
      setHolidayName("");
      setHolidayNameRu("");
      setHolidayCountry("BOTH");
      setHolidayIsPublic(false);
    }
    setHolidayDialogOpen(true);
  };

  const submitTemplate = () => {
    const data = {
      name: formName,
      weekdays: formWeekdays,
      startHour: formStartHour,
      endHour: formEndHour,
      slotsPerHour: formSlotsPerHour,
      voiceIds: formVoiceIds.length > 0 ? formVoiceIds : null,
      isActive: true,
    };
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data });
    } else {
      createTemplateMutation.mutate(data);
    }
  };

  const submitShift = () => {
    if (!editingShiftTemplateId || shiftVoiceIds.length === 0) return;
    if (editingShift) {
      deleteShiftMutation.mutate({ id: editingShift.id, templateId: editingShiftTemplateId });
    }
    createShiftMutation.mutate({
      templateId: editingShiftTemplateId,
      startHour: shiftStartHour,
      endHour: shiftEndHour,
      voiceIds: shiftVoiceIds,
      label: shiftLabel || null,
    });
  };

  const submitHoliday = () => {
    if (!holidayDate || !holidayName || !holidayNameRu) return;
    const data = {
      date: holidayDate,
      name: holidayName,
      nameRu: holidayNameRu,
      country: holidayCountry,
      isPublic: holidayIsPublic,
    };
    if (editingHoliday) {
      updateHolidayMutation.mutate({ id: editingHoliday.id, data });
    } else {
      createHolidayMutation.mutate(data);
    }
  };

  const toggleWeekday = (day: number) => {
    setFormWeekdays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const toggleVoice = (voiceId: string, setter: (fn: (prev: string[]) => string[]) => void) => {
    setter(prev =>
      prev.includes(voiceId) ? prev.filter(id => id !== voiceId) : [...prev, voiceId]
    );
  };

  const toggleExpanded = (id: string) => {
    setExpandedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalSlots = (tpl: ScheduleTemplate) => {
    const isOvernight = tpl.endHour <= tpl.startHour;
    const hours = isOvernight ? (24 - tpl.startHour + tpl.endHour) : (tpl.endHour - tpl.startHour);
    return hours * tpl.slotsPerHour;
  };

  const upcomingHolidays = holidays
    ?.filter(h => {
      const d = new Date(h.date);
      return d >= new Date();
    })
    .slice(0, 8) || [];

  const activeVoices = voices?.filter(v => v.isActive) || [];

  return (
    <div className={`flex-1 space-y-6 ${embedded ? "" : "p-6"}`}>
      {!embedded && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("scheduleSettings.title")}</h1>
            <p className="text-muted-foreground">{t("scheduleSettings.subtitle")}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5" />
                  {t("scheduleSettings.title")}
                </CardTitle>
                <CardDescription>
                  {t("scheduleSettings.subtitle")}
                </CardDescription>
              </div>
              <HintTooltip hint={t("hints.scheduleSettings.createTemplate")}>
                <Button onClick={openCreateDialog} data-testid="button-create-template">
                  <Plus className="mr-2 h-4 w-4" />
                  {t("common.add")}
                </Button>
              </HintTooltip>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !templates?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t("scheduleSettings.noTemplates")}</p>
                  <p className="text-sm mt-1">{t("scheduleSettings.createTemplate")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {templates.map(tpl => (
                    <TemplateCard
                      key={tpl.id}
                      template={tpl}
                      voices={activeVoices}
                      expanded={expandedTemplates.has(tpl.id)}
                      onToggle={() => toggleExpanded(tpl.id)}
                      onEdit={() => openEditDialog(tpl)}
                      onDelete={() => deleteTemplateMutation.mutate(tpl.id)}
                      onAddShift={() => openShiftDialog(tpl.id)}
                      onEditShift={(shift) => openShiftDialog(tpl.id, shift)}
                      onDeleteShift={(shiftId) => deleteShiftMutation.mutate({ id: shiftId, templateId: tpl.id })}
                      totalSlots={totalSlots(tpl)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PartyPopper className="h-4 w-4" />
                {t("scheduleSettings.holidays")}
              </CardTitle>
              <HintTooltip hint={t("hints.scheduleSettings.addHoliday")}>
                <Button variant="outline" size="sm" onClick={() => openHolidayDialog()} data-testid="button-add-holiday">
                  <Plus className="mr-1 h-3 w-3" />
                  {t("common.add")}
                </Button>
              </HintTooltip>
            </CardHeader>
            <CardContent>
              {customHolidays && customHolidays.length > 0 && (
                <div className="space-y-1.5 mb-3 pb-3 border-b">
                  {customHolidays.map(h => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between gap-2 text-sm group"
                      data-testid={`custom-holiday-${h.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant={h.isPublic ? "default" : "outline"} className="shrink-0 font-mono text-xs">
                          {h.date}
                        </Badge>
                        <span className="truncate">{h.nameRu}</span>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {h.country === "TR" ? "🇹🇷" : h.country === "RU" ? "🇷🇺" : "🌍"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => openHolidayDialog(h)}
                          data-testid={`button-edit-holiday-${h.id}`}
                        >
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteHolidayMutation.mutate(h.id)}
                          data-testid={`button-delete-holiday-${h.id}`}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
                    <Globe className="h-3.5 w-3.5" />
                    <span>{t("scheduleSettings.builtInHolidays")} ({holidays?.length || 0})</span>
                    <ChevronDown className="h-3.5 w-3.5 ml-auto" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1.5 mt-2 max-h-[400px] overflow-y-auto pr-1">
                    {holidays?.map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Badge variant={h.isPublic ? "default" : "outline"} className="shrink-0 text-xs font-mono">
                          {h.date.slice(5)}
                        </Badge>
                        <span className="truncate">{h.nameRu}</span>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {h.country === "TR" ? "🇹🇷" : h.country === "RU" ? "🇷🇺" : "🌍"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                {t("scheduleSettings.voices")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {activeVoices.map(v => {
                  const color = getVoiceColor(v.id, activeVoices);
                  return (
                    <div key={v.id} className="flex items-center gap-2 text-sm">
                      <div className={`w-3 h-3 rounded-full ${color.bg}`} />
                      <span className="font-medium">{getCleanVoiceName(v)}</span>
                      <span className="text-muted-foreground text-xs">
                        {v.gender === "male" ? t("common.maleShort") : t("common.femaleShort")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <DialogUI open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? t("common.edit") : t("scheduleSettings.addTemplate")}
            </DialogTitle>
            <DialogDescription>
              {t("scheduleSettings.broadcastHours")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("common.name")}</Label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder={t("scheduleSettings.templateNamePlaceholder")}
                data-testid="input-template-name"
              />
            </div>

            <div className="space-y-2">
              <Label>{t("scheduleSettings.weekdays")}</Label>
              <div className="flex gap-2 flex-wrap">
                {WEEKDAY_VALUES.map((day, i) => (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    variant={formWeekdays.includes(day) ? "default" : "outline"}
                    onClick={() => toggleWeekday(day)}
                    data-testid={`button-weekday-${day}`}
                  >
                    {t(`schedule.weekdays.${WEEKDAY_KEYS[i]}`)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t("scheduleSettings.from")}</Label>
                <Select value={String(formStartHour)} onValueChange={v => setFormStartHour(Number(v))}>
                  <SelectTrigger data-testid="select-start-hour">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{`${i}:00`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("scheduleSettings.to")}</Label>
                <Select value={String(formEndHour)} onValueChange={v => setFormEndHour(Number(v))}>
                  <SelectTrigger data-testid="select-end-hour">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                      <SelectItem key={h} value={String(h)}>{`${h}:00`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("scheduleSettings.slotsPerHour")}</Label>
                <Select value={String(formSlotsPerHour)} onValueChange={v => setFormSlotsPerHour(Number(v))}>
                  <SelectTrigger data-testid="select-slots-per-hour">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              {(() => {
                const isOvn = formEndHour <= formStartHour;
                const hrs = isOvn ? (24 - formStartHour + formEndHour) : (formEndHour - formStartHour);
                return `${hrs * formSlotsPerHour} slots/day (${formStartHour}:00 — ${formEndHour}:00${isOvn ? " +1" : ""})`;
              })()}
            </div>

            <div className="space-y-2">
              <Label>{t("scheduleSettings.voices")}</Label>
              <div className="flex gap-2 flex-wrap">
                {activeVoices.map(v => {
                  const color = getVoiceColor(v.id, activeVoices);
                  const selected = formVoiceIds.includes(v.id);
                  return (
                    <Button
                      key={v.id}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      className={selected ? `${color.bgLight} ${color.text} border ${color.border} hover:opacity-80` : ""}
                      onClick={() => toggleVoice(v.id, setFormVoiceIds)}
                      data-testid={`button-voice-${v.id}`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full mr-1.5 ${color.bg}`} />
                      {getCleanVoiceName(v)}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={submitTemplate}
              disabled={!formName.trim() || formWeekdays.length === 0 || createTemplateMutation.isPending || updateTemplateMutation.isPending}
              data-testid="button-submit-template"
            >
              {(createTemplateMutation.isPending || updateTemplateMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingTemplate ? t("common.save") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogUI>

      <DialogUI open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>{editingShift ? t("scheduleSettings.editShift") : t("scheduleSettings.addShift")}</DialogTitle>
            <DialogDescription>
              {t("scheduleSettings.hostShifts")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("scheduleSettings.shiftLabel")}</Label>
              <Input
                value={shiftLabel}
                onChange={e => setShiftLabel(e.target.value)}
                placeholder={t("scheduleSettings.shiftLabel")}
                data-testid="input-shift-label"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("scheduleSettings.from")}</Label>
                <Select value={String(shiftStartHour)} onValueChange={v => setShiftStartHour(Number(v))}>
                  <SelectTrigger data-testid="select-shift-start">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{`${i}:00`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("scheduleSettings.to")}</Label>
                <Select value={String(shiftEndHour)} onValueChange={v => setShiftEndHour(Number(v))}>
                  <SelectTrigger data-testid="select-shift-end">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                      <SelectItem key={h} value={String(h)}>{`${h}:00`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("scheduleSettings.voices")}</Label>
              <div className="flex gap-2 flex-wrap">
                {activeVoices.map(v => {
                  const color = getVoiceColor(v.id, activeVoices);
                  const selected = shiftVoiceIds.includes(v.id);
                  return (
                    <Button
                      key={v.id}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      className={selected ? `${color.bgLight} ${color.text} border ${color.border} hover:opacity-80` : ""}
                      onClick={() => toggleVoice(v.id, setShiftVoiceIds)}
                      data-testid={`button-shift-voice-${v.id}`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full mr-1.5 ${color.bg}`} />
                      {getCleanVoiceName(v)}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={submitShift}
              disabled={shiftVoiceIds.length === 0 || createShiftMutation.isPending}
              data-testid="button-submit-shift"
            >
              {createShiftMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingShift ? t("common.save") : t("common.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogUI>

      <DialogUI open={holidayDialogOpen} onOpenChange={setHolidayDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>
              {editingHoliday ? t("scheduleSettings.editHoliday") : t("scheduleSettings.addHoliday")}
            </DialogTitle>
            <DialogDescription>
              {t("scheduleSettings.holidaysSubtitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("scheduleSettings.holidayDate")}</Label>
              <Input
                value={holidayDate}
                onChange={e => setHolidayDate(e.target.value)}
                placeholder={t("scheduleSettings.holidayDatePlaceholder")}
                data-testid="input-holiday-date"
              />
              <p className="text-xs text-muted-foreground">MM-DD</p>
            </div>

            <div className="space-y-2">
              <Label>{t("scheduleSettings.holidayNameRu")}</Label>
              <Input
                value={holidayNameRu}
                onChange={e => setHolidayNameRu(e.target.value)}
                placeholder="День Радио"
                data-testid="input-holiday-name-ru"
              />
            </div>

            <div className="space-y-2">
              <Label>{t("scheduleSettings.holidayName")}</Label>
              <Input
                value={holidayName}
                onChange={e => setHolidayName(e.target.value)}
                placeholder="Radio Day"
                data-testid="input-holiday-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("scheduleSettings.holidayCountry")}</Label>
                <Select value={holidayCountry} onValueChange={setHolidayCountry}>
                  <SelectTrigger data-testid="select-holiday-country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOTH">🌍 BOTH</SelectItem>
                    <SelectItem value="RU">🇷🇺 RU</SelectItem>
                    <SelectItem value="TR">🇹🇷 TR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("scheduleSettings.holidayPublic")}</Label>
                <div className="flex items-center gap-2 pt-2">
                  <Switch
                    checked={holidayIsPublic}
                    onCheckedChange={setHolidayIsPublic}
                    data-testid="switch-holiday-public"
                  />
                  <span className="text-sm text-muted-foreground">
                    {holidayIsPublic ? "✓" : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHolidayDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={submitHoliday}
              disabled={!holidayDate.trim() || !holidayName.trim() || !holidayNameRu.trim() || createHolidayMutation.isPending || updateHolidayMutation.isPending}
              data-testid="button-submit-holiday"
            >
              {(createHolidayMutation.isPending || updateHolidayMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingHoliday ? t("common.save") : t("common.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogUI>
    </div>
  );
}

function TemplateCard({
  template,
  voices,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddShift,
  onEditShift,
  onDeleteShift,
  totalSlots,
}: {
  template: ScheduleTemplate;
  voices: Voice[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddShift: () => void;
  onEditShift: (shift: HostShift) => void;
  onDeleteShift: (id: string) => void;
  totalSlots: number;
}) {
  const { t } = useTranslation();
  const { data: shifts } = useQuery<HostShift[]>({
    queryKey: ["/api/schedule-templates", template.id, "shifts"],
    queryFn: async () => {
      const res = await fetch(`/api/schedule-templates/${template.id}/shifts`);
      return res.json();
    },
  });

  const voiceNames = template.voiceIds
    ?.map(id => voices.find(v => v.id === id))
    .filter(Boolean)
    .map(v => getCleanVoiceName(v!)) || [];

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <div className="rounded-lg border p-4" data-testid={`template-${template.id}`}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {WEEKDAY_VALUES.map((day, i) => (
                  <span
                    key={day}
                    className={`text-xs w-6 h-6 rounded flex items-center justify-center ${
                      template.weekdays.includes(day)
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t(`schedule.weekdays.${WEEKDAY_KEYS[i]}`)}
                  </span>
                ))}
              </div>
              <div>
                <span className="font-medium">{template.name}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <Clock className="h-3 w-3" />
                  {template.startHour}:00 — {template.endHour}:00
                  <span>•</span>
                  {totalSlots} {t("generator.noSlots")}
                  {voiceNames.length > 0 && (
                    <>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        {template.voiceIds?.map(vid => {
                          const color = getVoiceColor(vid, voices);
                          return <div key={vid} className={`w-2 h-2 rounded-full ${color.bg}`} />;
                        })}
                      </div>
                      {voiceNames.join(", ")}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onEdit(); }} data-testid={`button-edit-${template.id}`}>
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(); }} data-testid={`button-delete-${template.id}`}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-4 pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t("scheduleSettings.hostShifts")}
              </h4>
              <Button variant="outline" size="sm" onClick={onAddShift} data-testid={`button-add-shift-${template.id}`}>
                <Plus className="mr-1 h-3 w-3" />
                {t("scheduleSettings.addShift")}
              </Button>
            </div>

            {!shifts?.length ? (
              <p className="text-sm text-muted-foreground py-2">
                {t("scheduleSettings.createTemplate")}
              </p>
            ) : (
              <div className="space-y-2">
                {shifts.map(shift => {
                  const shiftVoiceNames = shift.voiceIds
                    .map(id => voices.find(v => v.id === id))
                    .filter(Boolean)
                    .map(v => getCleanVoiceName(v!));

                  return (
                    <div
                      key={shift.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 bg-muted/30"
                      data-testid={`shift-${shift.id}`}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="font-mono text-xs">
                          {shift.startHour}:00—{shift.endHour}:00
                        </Badge>
                        {shift.label && <span className="font-medium">{shift.label}</span>}
                        <div className="flex items-center gap-1">
                          {shift.voiceIds.map(vid => {
                            const color = getVoiceColor(vid, voices);
                            return <div key={vid} className={`w-2 h-2 rounded-full ${color.bg}`} />;
                          })}
                        </div>
                        <span className="text-muted-foreground">{shiftVoiceNames.join(", ")}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onEditShift(shift)}
                          data-testid={`button-edit-shift-${shift.id}`}
                        >
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onDeleteShift(shift.id)}
                          data-testid={`button-delete-shift-${shift.id}`}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-2">
              <h4 className="text-sm font-medium mb-2">{t("schedule.title")}</h4>
              {(() => {
                const isOvn = template.endHour <= template.startHour;
                const totalHours = isOvn ? (24 - template.startHour + template.endHour) : (template.endHour - template.startHour);
                return (
                  <>
                    <div className="relative h-10 rounded-md overflow-hidden bg-muted">
                      {shifts?.map((shift, shiftIdx) => {
                        const shiftOvn = shift.endHour <= shift.startHour;
                        const shiftHours = shiftOvn ? (24 - shift.startHour + shift.endHour) : (shift.endHour - shift.startHour);
                        let offsetHours = shift.startHour - template.startHour;
                        if (offsetHours < 0) offsetHours += 24;
                        const left = (offsetHours / totalHours) * 100;
                        const width = (shiftHours / totalHours) * 100;
                        const firstVoiceColor = shift.voiceIds[0] ? getVoiceColor(shift.voiceIds[0], voices) : VOICE_COLORS[shiftIdx % VOICE_COLORS.length];

                        return (
                          <div
                            key={shift.id}
                            className={`absolute top-0 h-full ${firstVoiceColor.bgLight} border-x border-background flex items-center justify-center gap-1`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${shift.startHour}:00—${shift.endHour}:00 ${shift.label || ""}`}
                          >
                            {shift.voiceIds.map(vid => {
                              const c = getVoiceColor(vid, voices);
                              return <div key={vid} className={`w-2.5 h-2.5 rounded-full ${c.bg}`} />;
                            })}
                            {width > 15 && (
                              <span className="text-xs font-medium text-foreground/80 ml-1">
                                {shift.label || `${shift.startHour}-${shift.endHour}`}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>{template.startHour}:00</span>
                      <span>{template.endHour}:00</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
