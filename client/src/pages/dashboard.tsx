import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Mic, Calendar, CheckCircle, Clock, AlertCircle, PlayCircle, PauseCircle,
  Radio, Zap, Volume2, Upload, AudioLines, TrendingUp, Activity, Podcast,
  ArrowRight, BarChart3
} from "lucide-react";
import { HintTooltip } from "@/components/hint-tooltip";
import type { Program, ProgramType, Settings } from "@shared/schema";

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  loading,
  color = "text-muted-foreground",
  hint
}: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ElementType;
  loading?: boolean;
  color?: string;
  hint?: string;
}) {
  const card = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
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
  return hint ? <HintTooltip hint={hint}>{card}</HintTooltip> : card;
}

export default function Dashboard() {
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { t } = useTranslation();

  const { data: programs, isLoading: programsLoading } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
  });

  const { data: programTypes, isLoading: typesLoading } = useQuery<ProgramType[]>({
    queryKey: ["/api/program-types"],
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playAudio = (audioUrl: string, id: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (playingId === id) {
      setPlayingId(null);
      return;
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play().catch((err) => console.error("Error playing audio:", err));
    setPlayingId(id);
    audio.onended = () => setPlayingId(null);
  };

  const today = new Date().toISOString().split("T")[0];
  const todayPrograms = programs?.filter(p => p.scheduledDate === today) || [];
  const todayReady = todayPrograms.filter(p => p.status === "ready").length;
  const todayWithAudio = todayPrograms.filter(p => p.audioUrl).length;
  const todayWithScript = todayPrograms.filter(p => p.scriptText).length;
  const todayErrors = todayPrograms.filter(p => p.status === "error").length;
  const totalDailyNorm = programTypes?.reduce((acc, pt) => acc + (pt.dailyCount || 1), 0) || 0;

  const autoTypes = programTypes?.filter(pt => pt.autoGenerate) || [];

  const recentPrograms = programs
    ?.slice()
    .sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    })
    .slice(0, 8) || [];

  const typeMap = new Map(programTypes?.map(pt => [pt.id, pt]) || []);

  const isLoading = programsLoading || typesLoading || settingsLoading;

  const statusHints: Record<string, string> = {
    ready: t("hints.dashboard.statusReady"),
    script_ready: t("hints.dashboard.statusScriptReady"),
    generating: t("hints.dashboard.statusGenerating"),
    error: t("hints.dashboard.statusError"),
    pending: t("hints.dashboard.statusPending"),
  };

  function getStatusBadge(status: string) {
    const hint = statusHints[status] || statusHints.pending;
    switch (status) {
      case "ready":
        return <HintTooltip hint={hint}><span><Badge variant="default" className="bg-green-600 text-xs"><CheckCircle className="mr-1 h-3 w-3" />{t("statuses.ready")}</Badge></span></HintTooltip>;
      case "script_ready":
        return <HintTooltip hint={hint}><span><Badge variant="secondary" className="text-xs"><CheckCircle className="mr-1 h-3 w-3" />{t("statuses.script_ready")}</Badge></span></HintTooltip>;
      case "generating":
        return <HintTooltip hint={hint}><span><Badge variant="secondary" className="text-xs"><Clock className="mr-1 h-3 w-3 animate-spin" />{t("statuses.generating")}</Badge></span></HintTooltip>;
      case "error":
        return <HintTooltip hint={hint}><span><Badge variant="destructive" className="text-xs"><AlertCircle className="mr-1 h-3 w-3" />{t("statuses.error")}</Badge></span></HintTooltip>;
      default:
        return <HintTooltip hint={hint}><span><Badge variant="outline" className="text-xs"><Clock className="mr-1 h-3 w-3" />{t("statuses.pending")}</Badge></span></HintTooltip>;
    }
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground">
            {settings?.stationName || "Radio"} — {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/shows">
            <HintTooltip hint={t("hints.dashboard.goToShows")}>
              <Button variant="outline" data-testid="button-go-shows">
                <Podcast className="mr-2 h-4 w-4" />
                {t("nav.shows")}
              </Button>
            </HintTooltip>
          </Link>
          <Link href="/podvodki">
            <HintTooltip hint={t("hints.dashboard.goToPodvodki")}>
              <Button variant="outline" data-testid="button-go-podvodki">
                <Mic className="mr-2 h-4 w-4" />
                {t("nav.podvodki")}
              </Button>
            </HintTooltip>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("dashboard.readyToday")}
          value={`${todayReady}/${totalDailyNorm}`}
          description={t("dashboard.withAudio", { count: todayWithAudio, scripts: todayWithScript })}
          icon={Activity}
          color="text-green-600"
          loading={isLoading}
          hint={t("hints.dashboard.readyToday")}
        />
        <StatCard
          title={t("dashboard.errorsToday")}
          value={todayErrors}
          description={todayErrors > 0 ? t("dashboard.needAttention") : t("dashboard.allGood")}
          icon={AlertCircle}
          color={todayErrors > 0 ? "text-red-500" : "text-muted-foreground"}
          loading={isLoading}
          hint={t("hints.dashboard.errorsToday")}
        />
        <StatCard
          title={t("dashboard.autoGeneration")}
          value={`${autoTypes.length}/${programTypes?.length || 0}`}
          description={autoTypes.length > 0 ? t("dashboard.typesOnAuto") : t("dashboard.notConfigured")}
          icon={Zap}
          color={autoTypes.length > 0 ? "text-yellow-500" : "text-muted-foreground"}
          loading={isLoading}
          hint={t("hints.dashboard.autoGeneration")}
        />
        <StatCard
          title={t("dashboard.totalPrograms")}
          value={programs?.length || 0}
          description={t("common.allTime")}
          icon={BarChart3}
          loading={isLoading}
          hint={t("hints.dashboard.totalPrograms")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("dashboard.todayByShows")}</CardTitle>
                <CardDescription>{t("dashboard.statusForDate", { date: new Date().toLocaleDateString(undefined, { day: "numeric", month: "long" }) })}</CardDescription>
              </div>
              <Link href="/shows">
                <HintTooltip hint={t("hints.dashboard.allShows")}>
                  <Button variant="ghost" size="sm">
                    {t("dashboard.allShows")}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </HintTooltip>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : programTypes && programTypes.length > 0 ? (
              <div className="space-y-2">
                {programTypes.map(type => {
                  const typePrograms = todayPrograms.filter(p => p.programTypeId === type.id);
                  const dailyNorm = type.dailyCount || 1;
                  const ready = typePrograms.filter(p => p.status === "ready").length;
                  const withScript = typePrograms.filter(p => p.scriptText && p.status !== "ready").length;
                  const errors = typePrograms.filter(p => p.status === "error").length;
                  const hasAuto = type.autoGenerate;
                  const pct = Math.min(100, Math.round((ready / dailyNorm) * 100));

                  return (
                    <div key={type.id} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`dashboard-type-${type.id}`}>
                      <div className="shrink-0 h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                        <Radio className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{type.name}</span>
                          {hasAuto && (
                            <span className="flex items-center gap-1 text-xs text-green-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                              {t("dashboard.auto")}
                            </span>
                          )}
                          {errors > 0 && (
                            <Badge variant="destructive" className="text-xs h-5">{errors} {t("dashboard.errors")}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-blue-500' : 'bg-muted-foreground/20'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {ready}/{dailyNorm}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {ready > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-green-600" title={t("dashboard.readyForAir")}>
                            <Volume2 className="h-3.5 w-3.5" />{ready}
                          </span>
                        )}
                        {withScript > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-blue-600" title={t("dashboard.hasScript")}>
                            <Mic className="h-3.5 w-3.5" />{withScript}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Podcast className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">{t("dashboard.noTypes")}</p>
                <Link href="/shows">
                  <Button variant="ghost" className="mt-2">{t("common.configure")}</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t("dashboard.autoGeneration")}</CardTitle>
            <CardDescription>{t("dashboard.typesOnAuto")}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : autoTypes.length > 0 ? (
              <div className="space-y-2">
                {autoTypes.map(type => (
                  <div key={type.id} className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30 p-3 space-y-1.5" data-testid={`auto-type-${type.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="font-medium text-sm">{type.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {type.scheduleDays && type.scheduleDays.length > 0
                          ? (type.scheduleDays as number[]).map(d => ["Su","Mo","Tu","We","Th","Fr","Sa"][d]).join(", ")
                          : t("common.daily")
                        } {type.scheduleTime || "09:00"}
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {type.weeklyCount || 7}{t("dashboard.perWeek")}
                      </div>
                      <div className="flex gap-2 flex-wrap mt-1">
                        {type.autoVoice !== false && (
                          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                            <Volume2 className="h-3 w-3" />{t("dashboard.voicing")}
                          </span>
                        )}
                        {type.autoIsolate && (
                          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                            <AudioLines className="h-3 w-3" />{t("dashboard.denoiser")}
                          </span>
                        )}
                        {type.autoUpload !== false && (
                          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                            <Upload className="h-3 w-3" />{t("dashboard.uploading")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Zap className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">{t("dashboard.autoNotConfigured")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("dashboard.enableInSettings")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("dashboard.recentEpisodes")}</CardTitle>
              <CardDescription>{t("dashboard.recentDescription")}</CardDescription>
            </div>
            <Link href="/shows">
              <Button variant="ghost" size="sm">
                {t("dashboard.allShows")}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : recentPrograms.length > 0 ? (
            <div className="space-y-2">
              {recentPrograms.map(program => {
                const pType = typeMap.get(program.programTypeId);
                return (
                  <div
                    key={program.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    data-testid={`recent-program-${program.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Mic className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{program.title || t("dashboard.noTitle")}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {pType && <span className="truncate">{pType.name}</span>}
                          <span>{program.scheduledDate || "—"}</span>
                          {program.slotNumber && <span>#{program.slotNumber}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {program.audioUrl?.includes("_isolated") && (
                        <span className="text-green-600">
                          <AudioLines className="h-4 w-4" />
                        </span>
                      )}
                      {getStatusBadge(program.status)}
                      {program.audioUrl && (
                        <HintTooltip hint={t("hints.dashboard.playAudio")}>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            data-testid={`button-play-${program.id}`}
                            onClick={() => playAudio(program.audioUrl!, program.id)}
                          >
                            {playingId === program.id ? (
                              <PauseCircle className="h-4 w-4" />
                            ) : (
                              <PlayCircle className="h-4 w-4" />
                            )}
                          </Button>
                        </HintTooltip>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Radio className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">{t("dashboard.noPrograms")}</p>
              <Link href="/shows">
                <Button variant="ghost" className="mt-2">{t("dashboard.createFirst")}</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
