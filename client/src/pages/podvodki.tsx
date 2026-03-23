import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wand2, Calendar, Settings2 } from "lucide-react";
import Generator from "./generator";
import Schedule from "./schedule";
import ScheduleSettings from "./schedule-settings";

export default function Podvodki() {
  const [tab, setTab] = useState("generator");

  return (
    <div className="flex-1 p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Подводки</h1>
          <p className="text-muted-foreground">Генерация и расписание радио-подводок</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="generator" className="gap-2" data-testid="tab-generator">
            <Wand2 className="h-4 w-4" />
            Генератор
          </TabsTrigger>
          <TabsTrigger value="schedule" className="gap-2" data-testid="tab-schedule">
            <Calendar className="h-4 w-4" />
            Расписание
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2" data-testid="tab-schedule-settings">
            <Settings2 className="h-4 w-4" />
            Настройка
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generator" className="mt-4">
          <Generator embedded />
        </TabsContent>
        <TabsContent value="schedule" className="mt-4">
          <Schedule embedded />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <ScheduleSettings embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
