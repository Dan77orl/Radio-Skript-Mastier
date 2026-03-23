import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Plus, Trash2, Clock, Users, Calendar, Settings2, Loader2, Edit3, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Voice, InsertScheduleTemplate, InsertHostShift } from "@shared/schema";

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

const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 7];

export default function ScheduleSettings({ embedded }: { embedded?: boolean }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | null>(null);
  const [editingShiftTemplateId, setEditingShiftTemplateId] = useState<string | null>(null);
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

  const createTemplateMutation = useMutation({
    mutationFn: async (data: InsertScheduleTemplate) => {
      const res = await apiRequest("POST", "/api/schedule-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      setDialogOpen(false);
      toast({ title: "Шаблон создан" });
    },
    onError: () => toast({ title: "Ошибка создания", variant: "destructive" }),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertScheduleTemplate> }) => {
      const res = await apiRequest("PATCH", `/api/schedule-templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      setDialogOpen(false);
      toast({ title: "Шаблон обновлён" });
    },
    onError: () => toast({ title: "Ошибка обновления", variant: "destructive" }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/schedule-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      toast({ title: "Шаблон удалён" });
    },
    onError: () => toast({ title: "Ошибка удаления", variant: "destructive" }),
  });

  const createShiftMutation = useMutation({
    mutationFn: async (data: InsertHostShift) => {
      const res = await apiRequest("POST", "/api/host-shifts", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates", variables.templateId, "shifts"] });
      setShiftDialogOpen(false);
      toast({ title: "Смена добавлена" });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async ({ id, templateId }: { id: string; templateId: string }) => {
      await apiRequest("DELETE", `/api/host-shifts/${id}`);
      return templateId;
    },
    onSuccess: (templateId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates", templateId, "shifts"] });
      toast({ title: "Смена удалена" });
    },
    onError: () => toast({ title: "Ошибка", variant: "destructive" }),
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

  const openShiftDialog = (templateId: string) => {
    setEditingShiftTemplateId(templateId);
    const tpl = templates?.find(t => t.id === templateId);
    setShiftStartHour(tpl?.startHour || 7);
    setShiftEndHour(tpl ? Math.min(tpl.startHour + 7, tpl.endHour) : 14);
    setShiftVoiceIds([]);
    setShiftLabel("");
    setShiftDialogOpen(true);
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
    createShiftMutation.mutate({
      templateId: editingShiftTemplateId,
      startHour: shiftStartHour,
      endHour: shiftEndHour,
      voiceIds: shiftVoiceIds,
      label: shiftLabel || null,
    });
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

  const totalSlots = (tpl: ScheduleTemplate) => (tpl.endHour - tpl.startHour) * tpl.slotsPerHour;

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
            <h1 className="text-3xl font-bold tracking-tight">Настройка расписания</h1>
            <p className="text-muted-foreground">Шаблоны эфирного дня и смены ведущих</p>
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
                  Шаблоны расписания
                </CardTitle>
                <CardDescription>
                  Настройте часы эфира, количество слотов и назначьте ведущих для каждого дня недели
                </CardDescription>
              </div>
              <Button onClick={openCreateDialog} data-testid="button-create-template">
                <Plus className="mr-2 h-4 w-4" />
                Добавить
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !templates?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Нет шаблонов расписания</p>
                  <p className="text-sm mt-1">Создайте шаблон, чтобы настроить эфирный день</p>
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Ближайшие праздники
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingHolidays.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              ) : (
                <div className="space-y-2">
                  {upcomingHolidays.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <Badge variant={h.isPublic ? "default" : "outline"} className="shrink-0 text-xs">
                        {h.date.slice(5)}
                      </Badge>
                      <span className="truncate">{h.nameRu}</span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {h.country === "TR" ? "🇹🇷" : h.country === "RU" ? "🇷🇺" : "🌍"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Доступные голоса
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {activeVoices.map(v => (
                  <div key={v.id} className="flex items-center gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full ${v.gender === "male" ? "bg-blue-500" : "bg-pink-500"}`} />
                    <span>{v.personaName || v.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {v.gender === "male" ? "М" : "Ж"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <DialogUI open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? "Редактировать шаблон" : "Новый шаблон расписания"}
            </DialogTitle>
            <DialogDescription>
              Настройте часы эфира и количество слотов
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Например: Рабочие дни"
                data-testid="input-template-name"
              />
            </div>

            <div className="space-y-2">
              <Label>Дни недели</Label>
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
                    {WEEKDAY_NAMES[i]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Начало</Label>
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
                <Label>Конец</Label>
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
                <Label>Слотов/час</Label>
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
              Итого: {(formEndHour - formStartHour) * formSlotsPerHour} слотов/день
              ({formStartHour}:00 — {formEndHour}:00)
            </div>

            <div className="space-y-2">
              <Label>Голоса по умолчанию</Label>
              <div className="flex gap-2 flex-wrap">
                {activeVoices.map(v => (
                  <Button
                    key={v.id}
                    type="button"
                    size="sm"
                    variant={formVoiceIds.includes(v.id) ? "default" : "outline"}
                    onClick={() => toggleVoice(v.id, setFormVoiceIds)}
                    data-testid={`button-voice-${v.id}`}
                  >
                    <div className={`w-2 h-2 rounded-full mr-1 ${v.gender === "male" ? "bg-blue-400" : "bg-pink-400"}`} />
                    {v.personaName || v.name}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Эти голоса будут использоваться для слотов без отдельной смены
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button
              onClick={submitTemplate}
              disabled={!formName.trim() || formWeekdays.length === 0 || createTemplateMutation.isPending || updateTemplateMutation.isPending}
              data-testid="button-submit-template"
            >
              {(createTemplateMutation.isPending || updateTemplateMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingTemplate ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogUI>

      <DialogUI open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Добавить смену ведущих</DialogTitle>
            <DialogDescription>
              Назначьте голоса на определённый период эфира
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Название смены (опционально)</Label>
              <Input
                value={shiftLabel}
                onChange={e => setShiftLabel(e.target.value)}
                placeholder="Например: Утреннее шоу"
                data-testid="input-shift-label"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>С</Label>
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
                <Label>До</Label>
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
              <Label>Ведущие смены</Label>
              <div className="flex gap-2 flex-wrap">
                {activeVoices.map(v => (
                  <Button
                    key={v.id}
                    type="button"
                    size="sm"
                    variant={shiftVoiceIds.includes(v.id) ? "default" : "outline"}
                    onClick={() => toggleVoice(v.id, setShiftVoiceIds)}
                    data-testid={`button-shift-voice-${v.id}`}
                  >
                    <div className={`w-2 h-2 rounded-full mr-1 ${v.gender === "male" ? "bg-blue-400" : "bg-pink-400"}`} />
                    {v.personaName || v.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>Отмена</Button>
            <Button
              onClick={submitShift}
              disabled={shiftVoiceIds.length === 0 || createShiftMutation.isPending}
              data-testid="button-submit-shift"
            >
              {createShiftMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Добавить
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
  onDeleteShift: (id: string) => void;
  totalSlots: number;
}) {
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
    .map(v => v!.personaName || v!.name) || [];

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
                    {WEEKDAY_NAMES[i]}
                  </span>
                ))}
              </div>
              <div>
                <span className="font-medium">{template.name}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <Clock className="h-3 w-3" />
                  {template.startHour}:00 — {template.endHour}:00
                  <span>•</span>
                  {totalSlots} слотов
                  {voiceNames.length > 0 && (
                    <>
                      <span>•</span>
                      <Users className="h-3 w-3" />
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
                Смены ведущих
              </h4>
              <Button variant="outline" size="sm" onClick={onAddShift} data-testid={`button-add-shift-${template.id}`}>
                <Plus className="mr-1 h-3 w-3" />
                Добавить смену
              </Button>
            </div>

            {!shifts?.length ? (
              <p className="text-sm text-muted-foreground py-2">
                Нет смен. Будут использованы голоса по умолчанию из шаблона.
              </p>
            ) : (
              <div className="space-y-2">
                {shifts.map(shift => {
                  const shiftVoiceNames = shift.voiceIds
                    .map(id => voices.find(v => v.id === id))
                    .filter(Boolean)
                    .map(v => v!.personaName || v!.name);

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
                        <span className="text-muted-foreground">{shiftVoiceNames.join(", ")}</span>
                      </div>
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
                  );
                })}
              </div>
            )}

            <div className="pt-2">
              <h4 className="text-sm font-medium mb-2">Временная шкала</h4>
              <div className="relative h-8 rounded-md overflow-hidden bg-muted">
                {shifts?.map(shift => {
                  const left = ((shift.startHour - template.startHour) / (template.endHour - template.startHour)) * 100;
                  const width = ((shift.endHour - shift.startHour) / (template.endHour - template.startHour)) * 100;
                  const colors = ["bg-blue-500/40", "bg-pink-500/40", "bg-green-500/40", "bg-orange-500/40"];
                  const idx = shifts.indexOf(shift) % colors.length;

                  return (
                    <div
                      key={shift.id}
                      className={`absolute top-0 h-full ${colors[idx]} border-x border-background flex items-center justify-center text-xs text-foreground font-medium`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${shift.startHour}:00—${shift.endHour}:00 ${shift.label || ""}`}
                    >
                      {width > 15 && (shift.label || `${shift.startHour}-${shift.endHour}`)}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>{template.startHour}:00</span>
                <span>{template.endHour}:00</span>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
