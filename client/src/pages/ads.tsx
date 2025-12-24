import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Sparkles, Loader2, Trash2, Play, Building2 } from "lucide-react";
import type { Ad } from "@shared/schema";

const adFormSchema = z.object({
  prompt: z.string().min(10, "Промпт должен быть не менее 10 символов"),
  clientName: z.string().optional(),
  category: z.string().default("general"),
});

type AdFormValues = z.infer<typeof adFormSchema>;

const categories = [
  { value: "general", label: "Общая" },
  { value: "restaurant", label: "Рестораны" },
  { value: "real_estate", label: "Недвижимость" },
  { value: "services", label: "Услуги" },
  { value: "shop", label: "Магазины" },
  { value: "events", label: "Мероприятия" },
];

export default function AdsPage() {
  const { toast } = useToast();
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);

  const { data: ads, isLoading } = useQuery<Ad[]>({
    queryKey: ["/api/ads"],
  });

  const form = useForm<AdFormValues>({
    resolver: zodResolver(adFormSchema),
    defaultValues: {
      prompt: "",
      clientName: "",
      category: "general",
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (data: AdFormValues) => {
      const response = await apiRequest("POST", "/api/generate-ad", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      setSelectedAd(data);
      form.reset();
      toast({
        title: "Реклама создана",
        description: "Рекламный ролик успешно сгенерирован",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось создать рекламу",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ads"] });
      if (selectedAd) setSelectedAd(null);
      toast({
        title: "Удалено",
        description: "Реклама удалена",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: AdFormValues) => {
    generateMutation.mutate(data);
  };

  const getCategoryLabel = (value: string) => {
    return categories.find(c => c.value === value)?.label || value;
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Реклама</h1>
        <p className="text-muted-foreground">Генерация рекламных роликов с помощью ИИ</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Создать рекламу
            </CardTitle>
            <CardDescription>Опишите рекламируемый продукт или услугу</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Название клиента</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Например: Ресторан У Моря"
                          {...field}
                          data-testid="input-client-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Категория</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                  name="prompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Описание рекламы</FormLabel>
                      <div className="flex gap-1">
                        <FormControl>
                          <Textarea
                            placeholder="Опишите что нужно рекламировать: продукт, услугу, акцию, контактные данные и т.д."
                            rows={5}
                            {...field}
                            data-testid="textarea-ad-prompt"
                            className="flex-1"
                          />
                        </FormControl>
                        <VoiceInput onTranscript={(text) => field.onChange(field.value + " " + text)} />
                      </div>
                      <FormDescription>
                        ИИ создаст диалог между ведущими на основе вашего описания
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={generateMutation.isPending}
                  data-testid="button-generate-ad"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Генерация...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Создать рекламу
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Предпросмотр</CardTitle>
            <CardDescription>Сгенерированный рекламный ролик</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedAd ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="font-semibold">{selectedAd.title}</h3>
                    {selectedAd.clientName && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {selectedAd.clientName}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary">{getCategoryLabel(selectedAd.category || "general")}</Badge>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border p-3 bg-blue-500/10">
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Мужской голос:</p>
                    <p className="text-sm">{selectedAd.maleText}</p>
                  </div>
                  <div className="rounded-lg border p-3 bg-pink-500/10">
                    <p className="text-xs font-medium text-pink-600 dark:text-pink-400 mb-1">Женский голос:</p>
                    <p className="text-sm">{selectedAd.femaleText}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" disabled>
                    <Play className="mr-2 h-4 w-4" />
                    Прослушать
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="icon">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Удалить рекламу?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Это действие нельзя отменить.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(selectedAd.id)}>
                          Удалить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Создайте рекламу, чтобы увидеть результат</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Все рекламы</CardTitle>
          <CardDescription>Список сгенерированных рекламных роликов</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : ads && ads.length > 0 ? (
            <div className="space-y-3">
              {ads.map((ad) => (
                <div
                  key={ad.id}
                  className={`flex items-center justify-between gap-4 rounded-lg border p-4 cursor-pointer hover-elevate ${
                    selectedAd?.id === ad.id ? "border-primary bg-primary/5" : ""
                  }`}
                  onClick={() => setSelectedAd(ad)}
                  data-testid={`ad-item-${ad.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium truncate">{ad.title}</h4>
                      <Badge variant="secondary" className="text-xs">
                        {getCategoryLabel(ad.category || "general")}
                      </Badge>
                    </div>
                    {ad.clientName && (
                      <p className="text-sm text-muted-foreground truncate">{ad.clientName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ad.audioUrl ? (
                      <Badge className="bg-green-500">Готов</Badge>
                    ) : (
                      <Badge variant="outline">Текст</Badge>
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
                          <AlertDialogTitle>Удалить рекламу?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Это действие нельзя отменить.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(ad.id)}>
                            Удалить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>Пока нет рекламных роликов</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
