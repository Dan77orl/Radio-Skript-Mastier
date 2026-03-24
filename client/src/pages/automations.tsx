import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Play, Trash2, Clock, CheckCircle, XCircle, Loader2, Zap, Settings2, Mic, MicOff } from "lucide-react";
import type { Automation, AutomationRun, Voice, ProgramType } from "@shared/schema";
import { format } from "date-fns";

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

const automationFormSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  automationType: z.enum(["dialog", "program"]),
  programTypeId: z.string().optional(),
  voiceIds: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  itemsCount: z.number().min(1).max(20).default(1),
  isActive: z.boolean().default(true),
});

type AutomationFormValues = z.infer<typeof automationFormSchema>;

export default function AutomationsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedAutomation, setSelectedAutomation] = useState<Automation | null>(null);
  const [showRuns, setShowRuns] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const { data: automations = [], isLoading: automationsLoading } = useQuery<Automation[]>({
    queryKey: ["/api/automations"],
  });

  const { data: voices = [] } = useQuery<Voice[]>({
    queryKey: ["/api/voices"],
  });

  const { data: programTypes = [] } = useQuery<ProgramType[]>({
    queryKey: ["/api/program-types"],
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<AutomationRun[]>({
    queryKey: ["/api/automations", showRuns, "runs"],
    enabled: !!showRuns,
  });

  const form = useForm<AutomationFormValues>({
    resolver: zodResolver(automationFormSchema),
    defaultValues: {
      name: "",
      automationType: "dialog",
      programTypeId: "",
      voiceIds: [],
      prompt: "",
      itemsCount: 1,
      isActive: true,
    },
  });

  const automationType = form.watch("automationType");

  useEffect(() => {
    if (selectedAutomation) {
      form.reset({
        name: selectedAutomation.name,
        automationType: selectedAutomation.automationType as "dialog" | "program",
        programTypeId: selectedAutomation.programTypeId || "",
        voiceIds: selectedAutomation.voiceIds || [],
        prompt: selectedAutomation.prompt || "",
        itemsCount: selectedAutomation.itemsCount || 1,
        isActive: selectedAutomation.isActive ?? true,
      });
    } else {
      form.reset({
        name: "",
        automationType: "dialog",
        programTypeId: "",
        voiceIds: [],
        prompt: "",
        itemsCount: 1,
        isActive: true,
      });
    }
  }, [selectedAutomation, form]);

  const createMutation = useMutation({
    mutationFn: (data: AutomationFormValues) =>
      apiRequest("POST", "/api/automations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automations"] });
      toast({ title: t("automations.createAutomation") });
      setIsCreateOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: t("common.error"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: AutomationFormValues) =>
      apiRequest("PATCH", `/api/automations/${selectedAutomation?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automations"] });
      toast({ title: t("common.saved") });
      setSelectedAutomation(null);
    },
    onError: () => {
      toast({ title: t("common.error"), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/automations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automations"] });
      toast({ title: t("common.deleted") });
      setSelectedAutomation(null);
    },
    onError: () => {
      toast({ title: t("common.error"), variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/automations/${id}/run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automations"] });
      toast({ title: t("automations.run") });
    },
    onError: () => {
      toast({ title: t("common.error"), variant: "destructive" });
    },
  });

  const onSubmit = (data: AutomationFormValues) => {
    if (selectedAutomation) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />{t("common.loading")}</Badge>;
      case "completed":
        return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />{t("common.success")}</Badge>;
      case "error":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />{t("common.error")}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case "dialog":
        return t("automations.dialogType");
      case "program":
        return t("automations.programType");
      default:
        return type;
    }
  };

  const startVoiceInput = () => {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      toast({
        title: t("common.error"),
        description: t("common.error"),
        variant: "destructive",
      });
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const currentPrompt = form.getValues("prompt") || "";
      if (event.results[event.results.length - 1].isFinal) {
        form.setValue("prompt", currentPrompt + " " + transcript);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      toast({
        title: t("common.error"),
        description: t("common.error"),
        variant: "destructive",
      });
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopVoiceInput = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  };

  if (automationsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("automations.title")}</h1>
          <p className="text-muted-foreground">
            {t("automations.subtitle")}
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-automation">
              <Plus className="h-4 w-4 mr-2" />
              {t("automations.createAutomation")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("automations.newAutomation")}</DialogTitle>
              <DialogDescription>
                {t("automations.newAutomationDesc")}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("automations.automationName")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("automations.automationName")} {...field} data-testid="input-automation-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="automationType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("automations.contentType")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-automation-type">
                            <SelectValue placeholder={t("automations.selectType")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="dialog">{t("automations.dialogType")}</SelectItem>
                          <SelectItem value="program">{t("automations.programType")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {automationType === "program" && (
                  <FormField
                    control={form.control}
                    name="programTypeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("automations.programTypeLabel")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-program-type">
                              <SelectValue placeholder={t("automations.selectProgramType")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {programTypes.map((pt) => (
                              <SelectItem key={pt.id} value={pt.id}>
                                {pt.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {t("automations.programTypeDesc")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="voiceIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("automations.voices")}</FormLabel>
                      <div className="space-y-2">
                        {voices.map((voice) => (
                          <div key={voice.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`voice-${voice.id}`}
                              checked={field.value?.includes(voice.id)}
                              onCheckedChange={(checked) => {
                                const current = field.value || [];
                                if (checked) {
                                  field.onChange([...current, voice.id]);
                                } else {
                                  field.onChange(current.filter((id) => id !== voice.id));
                                }
                              }}
                              data-testid={`checkbox-voice-${voice.id}`}
                            />
                            <label
                              htmlFor={`voice-${voice.id}`}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {voice.name} ({voice.gender === "male" ? t("common.maleShort") : t("common.femaleShort")})
                            </label>
                          </div>
                        ))}
                      </div>
                      <FormDescription>
                        {t("automations.voicesDesc")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("automations.promptOptional")}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t("automations.promptPlaceholder")}
                          className="min-h-[80px]"
                          {...field}
                          data-testid="input-automation-prompt"
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant={isListening ? "destructive" : "outline"}
                        size="sm"
                        onClick={toggleVoiceInput}
                        className="mt-2"
                        data-testid="button-voice-input-create"
                      >
                        {isListening ? (
                          <>
                            <MicOff className="mr-2 h-4 w-4" />
                            {t("automations.stop")}
                          </>
                        ) : (
                          <>
                            <Mic className="mr-2 h-4 w-4" />
                            {t("automations.voiceInput")}
                          </>
                        )}
                      </Button>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="itemsCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("automations.itemsCountLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                          data-testid="input-items-count"
                        />
                      </FormControl>
                      <FormDescription>
                        {t("automations.itemsCountDesc")}
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
                        <FormLabel>{t("automations.activeLabel")}</FormLabel>
                        <FormDescription>
                          {t("automations.activeDesc")}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-automation-active"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-automation">
                    {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t("common.create")}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {automations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t("automations.noAutomations")}</h3>
            <p className="text-muted-foreground text-center mb-4">
              {t("automations.createFirst")}
            </p>
            <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-automation">
              <Plus className="h-4 w-4 mr-2" />
              {t("automations.createAutomation")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {automations.map((automation) => (
            <Card key={automation.id} className="relative" data-testid={`card-automation-${automation.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{automation.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {getTypeName(automation.automationType)}
                    </CardDescription>
                  </div>
                  <Badge variant={automation.isActive ? "default" : "secondary"} className="shrink-0">
                    {automation.isActive ? t("common.active") : t("common.inactive")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Settings2 className="h-4 w-4" />
                  <span>{automation.itemsCount || 1} {t("automations.itemsPerRun")}</span>
                </div>
                {automation.lastRunAt && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      {t("automations.lastRun")}:{" "}
                      {format(new Date(automation.lastRunAt), "dd MMM, HH:mm")}
                    </span>
                  </div>
                )}

                <Separator />

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => runMutation.mutate(automation.id)}
                    disabled={runMutation.isPending || !automation.isActive}
                    data-testid={`button-run-${automation.id}`}
                  >
                    {runMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-1" />
                    )}
                    {t("automations.run")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowRuns(showRuns === automation.id ? null : automation.id);
                    }}
                    data-testid={`button-runs-${automation.id}`}
                  >
                    <Clock className="h-4 w-4 mr-1" />
                    {t("automations.history")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedAutomation(automation)}
                    data-testid={`button-edit-${automation.id}`}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(automation.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-${automation.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                {showRuns === automation.id && (
                  <div className="mt-3 pt-3 border-t">
                    <h4 className="text-sm font-medium mb-2">{t("automations.runHistory")}</h4>
                    {runsLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    ) : runs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("automations.noRuns")}</p>
                    ) : (
                      <ScrollArea className="h-[150px]">
                        <div className="space-y-2">
                          {runs.map((run) => (
                            <div
                              key={run.id}
                              className="flex items-center justify-between text-sm p-2 rounded-md bg-muted/50"
                              data-testid={`run-${run.id}`}
                            >
                              <div className="flex flex-col gap-1">
                                <span className="text-muted-foreground">
                                  {format(new Date(run.startedAt), "dd.MM HH:mm")}
                                </span>
                                {run.itemsCreated !== null && run.itemsCreated > 0 && (
                                  <span className="text-xs">{t("automations.created")}: {run.itemsCreated}</span>
                                )}
                              </div>
                              {getStatusBadge(run.status)}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selectedAutomation} onOpenChange={(open) => !open && setSelectedAutomation(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("automations.editAutomation")}</DialogTitle>
            <DialogDescription>
              {t("automations.editAutomationDesc")}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("automations.automationName")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("automations.automationName")} {...field} data-testid="input-edit-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="automationType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("automations.contentType")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-type">
                          <SelectValue placeholder={t("automations.selectType")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="dialog">{t("automations.dialogType")}</SelectItem>
                        <SelectItem value="program">{t("automations.programType")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {automationType === "program" && (
                <FormField
                  control={form.control}
                  name="programTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("automations.programTypeLabel")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-program-type">
                            <SelectValue placeholder={t("automations.selectProgramType")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {programTypes.map((pt) => (
                            <SelectItem key={pt.id} value={pt.id}>
                              {pt.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="voiceIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("automations.voices")}</FormLabel>
                    <div className="space-y-2">
                      {voices.map((voice) => (
                        <div key={voice.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`edit-voice-${voice.id}`}
                            checked={field.value?.includes(voice.id)}
                            onCheckedChange={(checked) => {
                              const current = field.value || [];
                              if (checked) {
                                field.onChange([...current, voice.id]);
                              } else {
                                field.onChange(current.filter((id) => id !== voice.id));
                              }
                            }}
                            data-testid={`checkbox-edit-voice-${voice.id}`}
                          />
                          <label
                            htmlFor={`edit-voice-${voice.id}`}
                            className="text-sm font-medium leading-none"
                          >
                            {voice.name} ({voice.gender === "male" ? t("common.maleShort") : t("common.femaleShort")})
                          </label>
                        </div>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("automations.promptOptional")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("automations.promptPlaceholder")}
                        className="min-h-[80px]"
                        {...field}
                        data-testid="input-edit-prompt"
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant={isListening ? "destructive" : "outline"}
                      size="sm"
                      onClick={toggleVoiceInput}
                      className="mt-2"
                      data-testid="button-voice-input-edit"
                    >
                      {isListening ? (
                        <>
                          <MicOff className="mr-2 h-4 w-4" />
                          {t("automations.stop")}
                        </>
                      ) : (
                        <>
                          <Mic className="mr-2 h-4 w-4" />
                          {t("automations.voiceInput")}
                        </>
                      )}
                    </Button>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="itemsCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("automations.itemsCountLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        data-testid="input-edit-items-count"
                      />
                    </FormControl>
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
                      <FormLabel>{t("automations.activeLabel")}</FormLabel>
                      <FormDescription>
                        {t("automations.activeDesc")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-edit-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    if (selectedAutomation) {
                      deleteMutation.mutate(selectedAutomation.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-in-dialog"
                >
                  {t("common.delete")}
                </Button>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-update-automation">
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
