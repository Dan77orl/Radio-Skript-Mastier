import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Mic, Calendar, CheckCircle, Clock, AlertCircle, Plus, PlayCircle } from "lucide-react";
import type { Dialog, Settings } from "@shared/schema";

function StatCard({ 
  title, 
  value, 
  description, 
  icon: Icon,
  loading 
}: { 
  title: string; 
  value: string | number; 
  description: string;
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "ready":
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="mr-1 h-3 w-3" />Готов</Badge>;
    case "generating":
      return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Генерация</Badge>;
    case "error":
      return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Ошибка</Badge>;
    default:
      return <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />Ожидание</Badge>;
  }
}

export default function Dashboard() {
  const { data: dialogs, isLoading: dialogsLoading } = useQuery<Dialog[]>({
    queryKey: ["/api/dialogs"],
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const today = new Date().toISOString().split("T")[0];
  const todayDialogs = dialogs?.filter(d => d.scheduledDate === today) || [];
  const readyToday = todayDialogs.filter(d => d.status === "ready").length;
  const pendingToday = todayDialogs.filter(d => d.status === "pending").length;
  const totalToday = settings?.dailyDialogsCount || 12;

  const recentDialogs = dialogs?.slice(0, 5) || [];

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Панель управления</h1>
          <p className="text-muted-foreground">Генератор подводок для радио Alanya FM</p>
        </div>
        <Link href="/generator">
          <Button data-testid="button-new-dialog">
            <Plus className="mr-2 h-4 w-4" />
            Создать подводку
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Подводок сегодня"
          value={`${readyToday}/${totalToday}`}
          description="Готово к эфиру"
          icon={Mic}
          loading={dialogsLoading || settingsLoading}
        />
        <StatCard
          title="В очереди"
          value={pendingToday}
          description="Ожидают генерации"
          icon={Clock}
          loading={dialogsLoading}
        />
        <StatCard
          title="Всего создано"
          value={dialogs?.length || 0}
          description="За все время"
          icon={Calendar}
          loading={dialogsLoading}
        />
        <StatCard
          title="Норма в день"
          value={settings?.dailyDialogsCount || 12}
          description="Подводок"
          icon={CheckCircle}
          loading={settingsLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Последние подводки</CardTitle>
            <CardDescription>Недавно созданные диалоги</CardDescription>
          </CardHeader>
          <CardContent>
            {dialogsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : recentDialogs.length > 0 ? (
              <div className="space-y-3">
                {recentDialogs.map(dialog => (
                  <div
                    key={dialog.id}
                    className="flex items-center justify-between gap-4 rounded-lg border p-3"
                    data-testid={`dialog-item-${dialog.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Mic className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{dialog.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {dialog.scheduledDate || "Без даты"}
                          {dialog.duration && ` • ${Math.floor(dialog.duration / 60)}:${String(dialog.duration % 60).padStart(2, "0")}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {getStatusBadge(dialog.status)}
                      {dialog.audioUrl && (
                        <Button size="icon" variant="ghost" data-testid={`button-play-${dialog.id}`}>
                          <PlayCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Mic className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Пока нет подводок</p>
                <Link href="/generator">
                  <Button variant="link" className="mt-2">Создать первую</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Сегодняшнее расписание</CardTitle>
            <CardDescription>{new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}</CardDescription>
          </CardHeader>
          <CardContent>
            {dialogsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: totalToday }, (_, i) => {
                  const slotDialog = todayDialogs.find(d => d.slotNumber === i + 1);
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-center rounded-lg border-2 border-dashed p-3 text-sm ${
                        slotDialog?.status === "ready"
                          ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400"
                          : slotDialog?.status === "generating"
                          ? "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                          : "border-muted text-muted-foreground"
                      }`}
                      data-testid={`schedule-slot-${i + 1}`}
                    >
                      {slotDialog ? (
                        <CheckCircle className="h-4 w-4 mr-1" />
                      ) : null}
                      #{i + 1}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Link href="/schedule">
                <Button variant="outline" size="sm">Открыть расписание</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
