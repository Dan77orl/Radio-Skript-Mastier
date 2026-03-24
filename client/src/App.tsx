import { useEffect, useRef } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthPage from "@/pages/auth";
import Dashboard from "@/pages/dashboard";
import Generator from "@/pages/generator";
import Schedule from "@/pages/schedule";
import Podvodki from "@/pages/podvodki";
import NewsSources from "@/pages/news-sources";
import AdsPage from "@/pages/ads";
import VoicesPage from "@/pages/voices";
import ShowsPage from "@/pages/shows";
import AutomationsPage from "@/pages/automations";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function AdminRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/podvodki" component={Podvodki} />
      <Route path="/generator" component={Generator} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/news-sources" component={NewsSources} />
      <Route path="/ads" component={AdsPage} />
      <Route path="/voices" component={VoicesPage} />
      <Route path="/shows" component={ShowsPage} />
      <Route path="/automations" component={AutomationsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between gap-4 p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-1">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <AdminRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { i18n } = useTranslation();
  const langSynced = useRef(false);

  useEffect(() => {
    if (user && !langSynced.current) {
      langSynced.current = true;
      if (user.language && i18n.language !== user.language) {
        i18n.changeLanguage(user.language);
      }
    }
    if (!user) {
      langSynced.current = false;
    }
  }, [user, i18n]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return <AdminLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="radio-dialog-theme">
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
