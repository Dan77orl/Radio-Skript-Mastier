import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Plus, Pencil, Trash2, Users, User, Mic, Settings2 } from "lucide-react";
import type { AdPreset, Voice } from "@shared/schema";

const contentTypes = [
  { value: "single", label: "Один голос", icon: User, description: "Простое объявление одним голосом" },
  { value: "dialog", label: "Диалог", icon: Users, description: "Диалог между двумя ведущими" },
  { value: "dialog_with_announcer", label: "Диалог + подводка", icon: Mic, description: "Диалог с подводкой ведущего" },
];

const categories = [
  { value: "general", label: "Общая" },
  { value: "restaurant", label: "Рестораны" },
  { value: "real_estate", label: "Недвижимость" },
  { value: "services", label: "Услуги" },
  { value: "shop", label: "Магазины" },
  { value: "events", label: "Мероприятия" },
  { value: "image", label: "Имиджевая" },
];

const presetFormSchema = z.object({
  name: z.string().min(2, "Название должно быть не менее 2 символов"),
  description: z.string().optional(),
  miniPrompt: z.string().min(10, "Промпт должен быть не менее 10 символов"),
  contentType: z.string().default("single"),
  speakersCount: z.number().min(1).max(3).default(1),
  voiceIds: z.array(z.string()).optional(),
  announcerVoiceId: z.string().optional(),
  defaultTargetDurationSeconds: z.number().min(10).max(180).default(30),
  defaultCategory: z.string().default("general"),
  elevenLabsTags: z.string().optional(),
  isActive: z.boolean().default(true),
});

type PresetFormValues = z.infer<typeof presetFormSchema>;

export default function AdPresetsPage() {
  const { toast } = useToast();
  const [editingPreset, setEditingPreset] = useState<AdPreset | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: presets, isLoading } = useQuery<AdPreset[]>({
    queryKey: ["/api/ad-presets"],
  });

  const { data: voices } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const form = useForm<PresetFormValues>({
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

  const createMutation = useMutation({
    mutationFn: async (data: PresetFormValues) => {
      const response = await apiRequest("POST", "/api/ad-presets", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-presets"] });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Пресет создан" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PresetFormValues> }) => {
      const response = await apiRequest("PATCH", `/api/ad-presets/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-presets"] });
      setIsDialogOpen(false);
      setEditingPreset(null);
      form.reset();
      toast({ title: "Пресет обновлен" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ad-presets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-presets"] });
      toast({ title: "Пресет удален" });
    },
    onError: (error: Error) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: PresetFormValues) => {
    if (editingPreset) {
      updateMutation.mutate({ id: editingPreset.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEditDialog = (preset: AdPreset) => {
    setEditingPreset(preset);
    form.reset({
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
    setIsDialogOpen(true);
  };

  const openNewDialog = () => {
    setEditingPreset(null);
    form.reset();
    setIsDialogOpen(true);
  };

  const contentType = form.watch("contentType");

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
          <h1 className="text-3xl font-bold tracking-tight">Пресеты рекламы</h1>
          <p className="text-muted-foreground">Шаблоны для быстрого создания рекламных роликов</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog} data-testid="button-new-preset">
              <Plus className="mr-2 h-4 w-4" />
              Новый пресет
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingPreset ? "Редактировать пресет" : "Создать пресет"}</DialogTitle>
              <DialogDescription>
                Настройте шаблон для быстрого создания рекламы
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Название пресета</FormLabel>
                      <FormControl>
                        <Input placeholder="Например: Имиджевая реклама" {...field} data-testid="input-preset-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Описание</FormLabel>
                      <FormControl>
                        <Input placeholder="Краткое описание для чего этот пресет" {...field} data-testid="input-preset-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Тип контента</FormLabel>
                      <Select onValueChange={(val) => {
                        field.onChange(val);
                        if (val === "single") form.setValue("speakersCount", 1);
                        else if (val === "dialog") form.setValue("speakersCount", 2);
                        else form.setValue("speakersCount", 3);
                      }} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-content-type">
                            <SelectValue placeholder="Выберите тип" />
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
                        {getContentTypeInfo(field.value).description}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {voices && voices.length > 0 && (
                  <>
                    {(contentType === "single") && (
                      <FormField
                        control={form.control}
                        name="voiceIds"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Голос</FormLabel>
                            <Select 
                              onValueChange={(val) => field.onChange([val])} 
                              value={field.value?.[0] || ""}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-voice">
                                  <SelectValue placeholder="Выберите голос" />
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

                    {(contentType === "dialog" || contentType === "dialog_with_announcer") && (
                      <div className="space-y-4">
                        <FormField
                          control={form.control}
                          name="voiceIds"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Голоса диалога</FormLabel>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Select 
                                  onValueChange={(val) => {
                                    const current = field.value || [];
                                    field.onChange([val, current[1] || ""]);
                                  }} 
                                  value={field.value?.[0] || ""}
                                >
                                  <SelectTrigger data-testid="select-voice-1">
                                    <SelectValue placeholder="Первый голос" />
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
                                    <SelectValue placeholder="Второй голос" />
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

                        {contentType === "dialog_with_announcer" && (
                          <FormField
                            control={form.control}
                            name="announcerVoiceId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Голос подводки</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || ""}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-announcer-voice">
                                      <SelectValue placeholder="Выберите голос ведущего" />
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
                                <FormDescription>Голос для подводки в начале или конце</FormDescription>
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
                    control={form.control}
                    name="defaultCategory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Категория</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
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
                    name="defaultTargetDurationSeconds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Длительность (сек)</FormLabel>
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
                  control={form.control}
                  name="miniPrompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Промпт для генерации</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Инструкции для ИИ как генерировать текст рекламы..."
                          rows={4}
                          {...field}
                          data-testid="textarea-prompt"
                        />
                      </FormControl>
                      <FormDescription>
                        Базовые инструкции для генерации текста рекламы
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="elevenLabsTags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Разметка ElevenLabs (опционально)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="<break time='0.5s'/> для паузы, эмоциональные теги..."
                          rows={3}
                          {...field}
                          data-testid="textarea-elevenlabs-tags"
                        />
                      </FormControl>
                      <FormDescription>
                        SSML-теги для управления интонацией и паузами
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Активен</FormLabel>
                        <FormDescription>
                          Отображать пресет при создании рекламы
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
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-preset"
                  >
                    {editingPreset ? "Сохранить" : "Создать"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : presets && presets.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => {
            const typeInfo = getContentTypeInfo(preset.contentType || "single");
            const TypeIcon = typeInfo.icon;
            return (
              <Card key={preset.id} className={!preset.isActive ? "opacity-60" : ""} data-testid={`card-preset-${preset.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <TypeIcon className="h-4 w-4" />
                        {preset.name}
                      </CardTitle>
                      {preset.description && (
                        <CardDescription>{preset.description}</CardDescription>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(preset)}
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
                            <AlertDialogTitle>Удалить пресет?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Это действие нельзя отменить
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(preset.id)}>
                              Удалить
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
                    <Badge variant="secondary">{preset.defaultTargetDurationSeconds}с</Badge>
                    {preset.defaultCategory && (
                      <Badge variant="secondary">
                        {categories.find(c => c.value === preset.defaultCategory)?.label || preset.defaultCategory}
                      </Badge>
                    )}
                  </div>
                  
                  {preset.voiceIds && preset.voiceIds.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Голоса: {preset.voiceIds.map(id => getVoiceName(id)).join(", ")}
                    </div>
                  )}

                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {preset.miniPrompt}
                  </p>

                  {!preset.isActive && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Неактивен
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
              <h3 className="text-lg font-medium mb-2">Нет пресетов</h3>
              <p className="text-muted-foreground mb-4">
                Создайте первый пресет для быстрого создания рекламы
              </p>
              <Button onClick={openNewDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Создать пресет
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
