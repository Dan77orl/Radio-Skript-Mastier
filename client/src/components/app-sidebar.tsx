import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Mic, Settings, Radio, Megaphone, Users, Podcast, LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import type { Settings as SettingsType } from "@shared/schema";

const menuItems = [
  {
    title: "Дашборд",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Подводки",
    url: "/podvodki",
    icon: Mic,
  },
  {
    title: "Передачи",
    url: "/shows",
    icon: Podcast,
  },
  {
    title: "Реклама",
    url: "/ads",
    icon: Megaphone,
  },
  {
    title: "Голоса",
    url: "/voices",
    icon: Users,
  },
  {
    title: "Настройки",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();
  
  const { data: settings } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
  });

  const stationName = settings?.stationName || "Alanya FM";
  const stationLogo = settings?.stationLogo;
  const stationLocation = settings?.stationLocation || "Аланья, Турция";

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          {stationLogo ? (
            <img 
              src={stationLogo} 
              alt={stationName}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-lg font-semibold">{stationName}</span>
            <span className="text-xs text-muted-foreground">RadioFlow AI</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Меню</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "") || "dashboard"}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-3">
        {user && (
          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">{user.name || user.email}</span>
              <span className="text-xs text-muted-foreground truncate">{user.email}</span>
            </div>
            <button
              onClick={logout}
              disabled={isLoggingOut}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Выйти"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="text-xs text-muted-foreground text-center">
          {stationLocation}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
