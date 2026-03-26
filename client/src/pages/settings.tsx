import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, Key, Mic, Settings2, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, HardDrive, Radio, Upload, Globe, X, FileText, User, BookOpen } from "lucide-react";
import { VoiceInput } from "@/components/voice-input";
import { useAuth } from "@/hooks/use-auth";
import type { Settings } from "@shared/schema";

const settingsFormSchema = z.object({
  elevenLabsApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  yandexDiskToken: z.string().optional(),
  freesoundApiKey: z.string().optional(),
  maleVoiceId: z.string().min(1),
  femaleVoiceId: z.string().min(1),
  dailyDialogsCount: z.coerce.number().min(1).max(50),
  defaultPrompt: z.string().min(10),
  stationName: z.string().optional(),
  stationLogo: z.string().optional(),
  stationDescription: z.string().optional(),
  stationWebsite: z.string().optional(),
  stationLocation: z.string().optional(),
  stationAttachments: z.array(z.string()).optional(),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export default function SettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === "admin";
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showYandexToken, setShowYandexToken] = useState(false);
  const [showFreesoundKey, setShowFreesoundKey] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      elevenLabsApiKey: "",
      anthropicApiKey: "",
      yandexDiskToken: "",
      freesoundApiKey: "",
      maleVoiceId: "onwK4e9ZLuTAKqWW03F9",
      femaleVoiceId: "EXAVITQu4vr4xnSDxMaL",
      dailyDialogsCount: 12,
      defaultPrompt: `Создай короткий диалог между ведущими радио "Алания FM" (мужчина и женщина). 
Тема: жизнь экспатов в Аланье, Турция. 
Стиль: дружелюбный, непринужденный, с юмором.
Длительность: 30-50 секунд при чтении.`,
      stationName: "Alanya FM",
      stationLogo: "",
      stationDescription: "",
      stationWebsite: "",
      stationLocation: "Аланья, Турция",
      stationAttachments: [],
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        elevenLabsApiKey: settings.elevenLabsApiKey || "",
        anthropicApiKey: settings.anthropicApiKey || "",
        yandexDiskToken: settings.yandexDiskToken || "",
        freesoundApiKey: settings.freesoundApiKey || "",
        maleVoiceId: settings.maleVoiceId || "onwK4e9ZLuTAKqWW03F9",
        femaleVoiceId: settings.femaleVoiceId || "EXAVITQu4vr4xnSDxMaL",
        dailyDialogsCount: settings.dailyDialogsCount || 12,
        defaultPrompt: settings.defaultPrompt || "",
        stationName: settings.stationName || "Alanya FM",
        stationLogo: settings.stationLogo || "",
        stationDescription: settings.stationDescription || "",
        stationWebsite: settings.stationWebsite || "",
        stationLocation: settings.stationLocation || "Аланья, Турция",
        stationAttachments: settings.stationAttachments || [],
      });
    }
  }, [settings, form]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingLogo(true);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch("/api/upload/logo", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) throw new Error(t("settings.logoUploadError"));
      
      const data = await response.json();
      form.setValue("stationLogo", data.url);
      toast({ title: t("settings.logoUploaded") });
    } catch (error) {
      toast({ title: t("settings.logoUploadError"), variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch("/api/upload/attachment", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) throw new Error(t("settings.fileUploadError"));
      
      const data = await response.json();
      const currentAttachments = form.getValues("stationAttachments") || [];
      form.setValue("stationAttachments", [...currentAttachments, data.url]);
      toast({ title: t("settings.fileAdded") });
    } catch (error) {
      toast({ title: t("settings.fileUploadError"), variant: "destructive" });
    }
  };

  const removeAttachment = (index: number) => {
    const currentAttachments = form.getValues("stationAttachments") || [];
    form.setValue("stationAttachments", currentAttachments.filter((_, i) => i !== index));
  };

  const saveMutation = useMutation({
    mutationFn: async (data: SettingsFormValues) => {
      return apiRequest("POST", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: t("common.saved"),
        description: t("settings.settingsSaved"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
        description: error.message || t("settings.settingsError"),
        variant: "destructive",
      });
    },
  });

  const testElevenLabsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/test-elevenlabs", {
        apiKey: form.getValues("elevenLabsApiKey"),
      });
    },
    onSuccess: () => {
      toast({
        title: t("common.success"),
        description: t("settings.connectionSuccess"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.connectionError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testAnthropicMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/test-anthropic", {
        apiKey: form.getValues("anthropicApiKey"),
      });
    },
    onSuccess: () => {
      toast({
        title: t("common.success"),
        description: t("settings.connectionSuccess"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.connectionError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testYandexMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/test-yandex", {
        token: form.getValues("yandexDiskToken"),
      });
    },
    onSuccess: () => {
      toast({
        title: t("common.success"),
        description: t("settings.connectionSuccess"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("settings.connectionError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveFieldMutation = useMutation({
    mutationFn: async (fieldData: Partial<SettingsFormValues>) => {
      return apiRequest("POST", "/api/settings", { ...form.getValues(), ...fieldData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: t("common.saved"),
        description: t("settings.keySaved"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("common.error"),
        description: error.message || t("settings.settingsError"),
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SettingsFormValues) => {
    saveMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-settings-title">{t("settings.title")}</h1>
        <p className="text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Tabs defaultValue={isAdmin ? "api-keys" : "knowledge"} className="space-y-6">
            <TabsList className={`grid w-full ${isAdmin ? "grid-cols-3" : "grid-cols-2"}`} data-testid="tabs-settings">
              {isAdmin && (
                <TabsTrigger value="api-keys" data-testid="tab-api-keys">
                  <Key className="mr-2 h-4 w-4" />
                  {t("settings.apiKeys")}
                </TabsTrigger>
              )}
              <TabsTrigger value="knowledge" data-testid="tab-knowledge">
                <BookOpen className="mr-2 h-4 w-4" />
                {t("settings.knowledge")}
              </TabsTrigger>
              <TabsTrigger value="account" data-testid="tab-account">
                <User className="mr-2 h-4 w-4" />
                {t("settings.account")}
              </TabsTrigger>
            </TabsList>

            {isAdmin && <TabsContent value="api-keys" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    {t("settings.apiKeysTitle")}
                  </CardTitle>
                  <CardDescription>{t("settings.apiKeysDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="elevenLabsApiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.elevenLabsKey")}</FormLabel>
                        <div className="flex gap-2 items-center">
                          <FormControl>
                            <Input
                              type={showApiKey ? "text" : "password"}
                              placeholder={t("settings.elevenLabsPlaceholder")}
                              {...field}
                              data-testid="input-elevenlabs-key"
                              className="flex-1"
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowApiKey(!showApiKey)}
                          >
                            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => saveFieldMutation.mutate({ elevenLabsApiKey: field.value })}
                            disabled={saveFieldMutation.isPending || !field.value}
                            data-testid="button-save-elevenlabs"
                          >
                            {saveFieldMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => testElevenLabsMutation.mutate()}
                            disabled={testElevenLabsMutation.isPending || !field.value}
                            data-testid="button-test-elevenlabs"
                          >
                            {testElevenLabsMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              t("common.check")
                            )}
                          </Button>
                        </div>
                        <FormDescription>
                          {t("settings.elevenLabsDescription")}{" "}
                          <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                            elevenlabs.io
                          </a>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <FormField
                    control={form.control}
                    name="anthropicApiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.anthropicKey")}</FormLabel>
                        <div className="flex gap-2 items-center">
                          <FormControl>
                            <Input
                              type={showAnthropicKey ? "text" : "password"}
                              placeholder={t("settings.anthropicPlaceholder")}
                              {...field}
                              data-testid="input-anthropic-key"
                              className="flex-1"
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                          >
                            {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => saveFieldMutation.mutate({ anthropicApiKey: field.value })}
                            disabled={saveFieldMutation.isPending || !field.value}
                            data-testid="button-save-anthropic"
                          >
                            {saveFieldMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => testAnthropicMutation.mutate()}
                            disabled={testAnthropicMutation.isPending || !field.value}
                            data-testid="button-test-anthropic"
                          >
                            {testAnthropicMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              t("common.check")
                            )}
                          </Button>
                        </div>
                        <FormDescription>
                          {t("settings.anthropicDescription")}{" "}
                          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                            console.anthropic.com
                          </a>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <FormField
                    control={form.control}
                    name="yandexDiskToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4" />
                          {t("settings.yandexToken")}
                        </FormLabel>
                        <div className="flex gap-2 items-center">
                          <FormControl>
                            <Input
                              type={showYandexToken ? "text" : "password"}
                              placeholder={t("settings.yandexPlaceholder")}
                              {...field}
                              data-testid="input-yandex-token"
                              className="flex-1"
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowYandexToken(!showYandexToken)}
                          >
                            {showYandexToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => saveFieldMutation.mutate({ yandexDiskToken: field.value })}
                            disabled={saveFieldMutation.isPending || !field.value}
                            data-testid="button-save-yandex"
                          >
                            {saveFieldMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => testYandexMutation.mutate()}
                            disabled={testYandexMutation.isPending || !field.value}
                            data-testid="button-test-yandex"
                          >
                            {testYandexMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              t("common.check")
                            )}
                          </Button>
                        </div>
                        <FormDescription>
                          {t("settings.yandexDescription")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <FormField
                    control={form.control}
                    name="freesoundApiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Globe className="h-4 w-4" />
                          {t("settings.freesoundKey")}
                        </FormLabel>
                        <div className="flex gap-2 items-center">
                          <FormControl>
                            <Input
                              type={showFreesoundKey ? "text" : "password"}
                              placeholder={t("settings.freesoundPlaceholder")}
                              {...field}
                              data-testid="input-freesound-key"
                              className="flex-1"
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowFreesoundKey(!showFreesoundKey)}
                          >
                            {showFreesoundKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => saveFieldMutation.mutate({ freesoundApiKey: field.value })}
                            disabled={saveFieldMutation.isPending || !field.value}
                            data-testid="button-save-freesound"
                          >
                            {saveFieldMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <FormDescription>
                          {t("settings.freesoundDescription")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>}

            <TabsContent value="knowledge" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="h-5 w-5" />
                    {t("settings.aboutStation")}
                  </CardTitle>
                  <CardDescription>{t("settings.aboutStationDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="stationName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("settings.stationName")}</FormLabel>
                          <FormControl>
                            <Input placeholder="Alanya FM" {...field} data-testid="input-station-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="stationWebsite"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <Globe className="h-4 w-4" />
                            {t("settings.stationWebsiteLabel")}
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="https://alanyafm.com" {...field} data-testid="input-station-website" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="stationLocation"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>{t("settings.stationLocationLabel")}</FormLabel>
                          <FormControl>
                            <Input placeholder={t("settings.stationLocationLabel")} {...field} data-testid="input-station-location" />
                          </FormControl>
                          <FormDescription>
                            {t("settings.stationLocationHint")}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="stationLogo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.stationLogo")}</FormLabel>
                        <div className="flex items-center gap-4">
                          {field.value ? (
                            <div className="relative">
                              <img 
                                src={field.value} 
                                alt={t("settings.stationLogo")} 
                                className="h-16 w-16 rounded-md object-cover border"
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="destructive"
                                className="absolute -top-2 -right-2 h-6 w-6"
                                onClick={() => form.setValue("stationLogo", "")}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div className="h-16 w-16 rounded-md border-2 border-dashed flex items-center justify-center text-muted-foreground">
                              <Radio className="h-6 w-6" />
                            </div>
                          )}
                          <div>
                            <input
                              type="file"
                              accept="image/*"
                              ref={logoInputRef}
                              onChange={handleLogoUpload}
                              className="hidden"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => logoInputRef.current?.click()}
                              disabled={uploadingLogo}
                              data-testid="button-upload-logo"
                            >
                              {uploadingLogo ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="mr-2 h-4 w-4" />
                              )}
                              {t("settings.uploadLogo")}
                            </Button>
                          </div>
                        </div>
                        <FormDescription>
                          {t("settings.logoRecommendedSize")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <FormField
                    control={form.control}
                    name="stationDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.stationDescriptionLabel")}</FormLabel>
                        <div className="flex gap-1 items-start">
                          <FormControl>
                            <Textarea
                              placeholder={t("settings.stationDescriptionPlaceholder")}
                              className="min-h-[120px] flex-1"
                              {...field}
                              data-testid="textarea-station-description"
                            />
                          </FormControl>
                          <VoiceInput onTranscript={(text) => field.onChange(field.value + " " + text)} />
                        </div>
                        <FormDescription>
                          {t("settings.stationDescriptionHint")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <FormField
                    control={form.control}
                    name="stationAttachments"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          {t("settings.attachedFiles")}
                        </FormLabel>
                        <div className="space-y-2">
                          {(field.value || []).map((url, index) => (
                            <div key={index} className="flex items-center gap-2 p-2 rounded-md bg-muted">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="flex-1 text-sm truncate">{url.split("/").pop()}</span>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => removeAttachment(index)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          <div>
                            <input
                              type="file"
                              ref={attachmentInputRef}
                              onChange={handleAttachmentUpload}
                              className="hidden"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => attachmentInputRef.current?.click()}
                              data-testid="button-add-attachment"
                            >
                              <Upload className="mr-2 h-4 w-4" />
                              {t("settings.addAttachment")}
                            </Button>
                          </div>
                        </div>
                        <FormDescription>
                          {t("settings.attachedFilesHint")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings2 className="h-5 w-5" />
                    {t("settings.defaultGeneration")}
                  </CardTitle>
                  <CardDescription>{t("settings.defaultGenerationDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="dailyDialogsCount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.dailyCountLabel")}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            max={50}
                            className="w-32"
                            {...field}
                            data-testid="input-daily-count"
                          />
                        </FormControl>
                        <FormDescription>{t("settings.dailyCountHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <FormField
                    control={form.control}
                    name="defaultPrompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.defaultPrompt")}</FormLabel>
                        <div className="flex gap-1 items-start">
                          <FormControl>
                            <Textarea
                              placeholder={t("settings.defaultPromptPlaceholder")}
                              className="min-h-[150px] flex-1"
                              {...field}
                              data-testid="textarea-default-prompt"
                            />
                          </FormControl>
                          <VoiceInput onTranscript={(text) => field.onChange(field.value + " " + text)} />
                        </div>
                        <FormDescription>
                          {t("settings.defaultPromptHint")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="account" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    {t("settings.userProfile")}
                  </CardTitle>
                  <CardDescription>{t("settings.userProfileDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t("settings.email")}</Label>
                      <Input placeholder="admin@alanyafm.com" disabled data-testid="input-email" />
                      <p className="text-xs text-muted-foreground">{t("settings.comingSoon")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("settings.phone")}</Label>
                      <Input placeholder="+90 ..." disabled data-testid="input-phone" />
                      <p className="text-xs text-muted-foreground">{t("settings.comingSoon")}</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>{t("settings.changePassword")}</Label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input type="password" placeholder={t("settings.currentPassword")} disabled data-testid="input-current-password" />
                      <Input type="password" placeholder={t("settings.newPassword")} disabled data-testid="input-new-password" />
                    </div>
                    <p className="text-xs text-muted-foreground">{t("settings.comingSoon")}</p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>{t("settings.userManagement")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.userManagementDescription")}
                    </p>
                    <Button variant="outline" disabled data-testid="button-manage-users">
                      <User className="mr-2 h-4 w-4" />
                      {t("settings.userManagement")}
                    </Button>
                    <p className="text-xs text-muted-foreground">{t("settings.comingSoon")}</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t("settings.saveSettings")}
              </Button>
            </div>
          </Tabs>
        </form>
      </Form>
    </div>
  );
}
