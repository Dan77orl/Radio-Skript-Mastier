import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Mic, Settings, Radio, Megaphone, Users, Podcast, LogOut, Shield } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { VoiceAgentMenuItem } from "@/components/voice-agent-widget";
import type { Settings as SettingsType } from "@shared/schema";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();
  const { t } = useTranslation();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const { data: settings } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
  });

  const stationName = settings?.stationName || "Radio FM";
  const stationLogo = settings?.stationLogo;
  const stationLocation = settings?.stationLocation;

  const menuItems = [
    { title: t("nav.dashboard"), url: "/", icon: LayoutDashboard },
    { title: t("nav.podvodki"), url: "/podvodki", icon: Mic },
    { title: t("nav.shows"), url: "/shows", icon: Podcast },
    { title: t("nav.ads"), url: "/ads", icon: Megaphone },
    { title: t("nav.voices"), url: "/voices", icon: Users },
    { title: t("nav.settings"), url: "/settings", icon: Settings },
    ...(user?.role === "admin" ? [{ title: t("nav.admin", "Admin"), url: "/admin", icon: Shield }] : []),
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={isCollapsed ? "p-2" : "p-4"}>
        <div className={`flex items-center ${isCollapsed ? "justify-center" : "gap-3"}`}>
          {stationLogo ? (
            <img
              src={stationLogo}
              alt={stationName}
              className={`rounded-lg object-cover shrink-0 ${isCollapsed ? "h-8 w-8" : "h-10 w-10"}`}
            />
          ) : (
            <div className={`flex items-center justify-center rounded-lg bg-primary shrink-0 ${isCollapsed ? "h-8 w-8" : "h-10 w-10"}`}>
              <Radio className={isCollapsed ? "h-4 w-4 text-primary-foreground" : "h-5 w-5 text-primary-foreground"} />
            </div>
          )}
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-lg font-semibold truncate">{stationName}</span>
              <span className="text-xs text-muted-foreground">{t("landing.productName")}</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {!isCollapsed && <SidebarGroupLabel>{t("nav.menu")}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    tooltip={item.title}
                    data-testid={`nav-${item.url.replace("/", "") || "dashboard"}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <VoiceAgentMenuItem />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className={isCollapsed ? "p-2" : "p-4 space-y-3"}>
        {user && (
          <div className={`flex items-center ${isCollapsed ? "justify-center" : "justify-between"}`}>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{user.name || user.email}</span>
                <span className="text-xs text-muted-foreground truncate">{user.email}</span>
              </div>
            )}
            <button
              onClick={logout}
              disabled={isLoggingOut}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t("auth.logout")}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
        {!isCollapsed && stationLocation && (
          <div className="text-xs text-muted-foreground text-center">
            {stationLocation}
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
