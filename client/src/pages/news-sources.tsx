import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Newspaper, Plus, Trash2, Edit2, Globe, Loader2, RefreshCw, Download } from "lucide-react";
import { VoiceInput } from "@/components/voice-input";
import type { NewsSource, NewsItem } from "@shared/schema";
import { format } from "date-fns";

const sourceFormSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  type: z.string().default("rss"),
  language: z.string().default("ru"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

type SourceFormValues = z.infer<typeof sourceFormSchema>;

export default function NewsSources() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<NewsSource | null>(null);

  const { data: sources = [], isLoading } = useQuery<NewsSource[]>({
    queryKey: ["/api/news-sources"],
  });

  const { data: newsItems = [] } = useQuery<NewsItem[]>({
    queryKey: ["/api/news-items"],
  });

  const [fetchingSourceId, setFetchingSourceId] = useState<string | null>(null);

  const form = useForm<SourceFormValues>({
    resolver: zodResolver(sourceFormSchema),
    defaultValues: {
      name: "",
      url: "",
      type: "rss",
      language: "ru",
      description: "",
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SourceFormValues) => {
      const response = await apiRequest("POST", "/api/news-sources", data);
      return response.json() as Promise<NewsSource>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-sources"] });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: t("common.saved") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SourceFormValues> }) => {
      const response = await apiRequest("PATCH", `/api/news-sources/${id}`, data);
      return response.json() as Promise<NewsSource>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-sources"] });
      setIsDialogOpen(false);
      setEditingSource(null);
      form.reset();
      toast({ title: t("common.saved") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/news-sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-sources"] });
      toast({ title: t("common.deleted") });
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    },
  });

  const fetchSourceMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      setFetchingSourceId(sourceId);
      const response = await apiRequest("POST", `/api/news-sources/${sourceId}/fetch`, {});
      return response.json() as Promise<{ fetched: number; saved: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/news-items"] });
      toast({
        title: t("newsSources.newsLoaded"),
        description: `${data.fetched} / ${data.saved}`,
      });
      setFetchingSourceId(null);
    },
    onError: (error: Error) => {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
      setFetchingSourceId(null);
    },
  });

  const openEditDialog = (source: NewsSource) => {
    setEditingSource(source);
    form.reset({
      name: source.name,
      url: source.url,
      type: source.type,
      language: source.language || "ru",
      description: source.description || "",
      isActive: source.isActive ?? true,
    });
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingSource(null);
    form.reset({
      name: "",
      url: "",
      type: "rss",
      language: "ru",
      description: "",
      isActive: true,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: SourceFormValues) => {
    if (editingSource) {
      updateMutation.mutate({ id: editingSource.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const toggleActive = (source: NewsSource) => {
    updateMutation.mutate({ id: source.id, data: { isActive: !source.isActive } });
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("newsSources.title")}</h1>
          <p className="text-muted-foreground">{t("newsSources.subtitle")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} data-testid="button-add-source">
                <Plus className="mr-2 h-4 w-4" />
                {t("newsSources.addSource")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingSource ? t("newsSources.editSource") : t("newsSources.addSource")}</DialogTitle>
                <DialogDescription>
                  {editingSource ? t("newsSources.editSourceDesc") : t("newsSources.addSourceDesc")}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("newsSources.sourceName")}</FormLabel>
                        <div className="flex gap-1 items-center">
                          <FormControl>
                            <Input placeholder="Alanya News" {...field} data-testid="input-source-name" className="flex-1" />
                          </FormControl>
                          <VoiceInput onTranscript={(text) => field.onChange(field.value + text)} />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://example.com/rss" {...field} data-testid="input-source-url" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("newsSources.sourceType")}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-source-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="rss">RSS</SelectItem>
                              <SelectItem value="api">API</SelectItem>
                              <SelectItem value="web">Web</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="language"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("newsSources.sourceLanguage")}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-source-language">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="ru">{t("languages.ru")}</SelectItem>
                              <SelectItem value="en">{t("languages.en")}</SelectItem>
                              <SelectItem value="tr">{t("languages.tr")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("newsSources.descriptionLabel")}</FormLabel>
                        <div className="flex gap-1 items-center">
                          <FormControl>
                            <Input placeholder={t("newsSources.descriptionPlaceholder")} {...field} data-testid="input-source-description" className="flex-1" />
                          </FormControl>
                          <VoiceInput onTranscript={(text) => field.onChange((field.value || "") + text)} />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <FormLabel>{t("newsSources.activeLabel")}</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-source-active" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-source">
                      {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {t("common.save")}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Newspaper className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-center">
              {t("newsSources.noSources")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <Card key={source.id} data-testid={`card-source-${source.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-lg truncate">{source.name}</CardTitle>
                    <CardDescription className="truncate">{source.url}</CardDescription>
                  </div>
                  <Badge variant={source.isActive ? "default" : "secondary"}>
                    {source.isActive ? t("common.active") : t("common.inactive")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">
                    <Globe className="mr-1 h-3 w-3" />
                    {source.type?.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">{source.language?.toUpperCase()}</Badge>
                </div>
                {source.description && (
                  <p className="text-sm text-muted-foreground">{source.description}</p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Switch
                    checked={source.isActive ?? false}
                    onCheckedChange={() => toggleActive(source)}
                    data-testid={`switch-toggle-${source.id}`}
                  />
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => fetchSourceMutation.mutate(source.id)}
                      disabled={fetchingSourceId === source.id}
                      data-testid={`button-fetch-${source.id}`}
                    >
                      {fetchingSourceId === source.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEditDialog(source)}
                      data-testid={`button-edit-${source.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(source.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-${source.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {newsItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("newsSources.loadedNews")}</CardTitle>
            <CardDescription>
              {newsItems.length} {t("newsSources.newsCount")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {newsItems.map((item) => {
                  const source = sources.find(s => s.id === item.sourceId);
                  return (
                    <div key={item.id} className="p-3 rounded-lg border space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm">{item.title}</span>
                        {item.isUsed && (
                          <Badge variant="secondary" className="text-xs shrink-0">{t("newsSources.used")}</Badge>
                        )}
                      </div>
                      {item.summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{item.summary}</p>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {source && <span>{source.name}</span>}
                        {item.publishedAt && (
                          <span>{format(new Date(item.publishedAt), "d MMM, HH:mm")}</span>
                        )}
                        {item.category && <Badge variant="outline" className="text-xs">{item.category}</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
