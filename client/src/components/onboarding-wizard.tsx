import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Podcast,
  Megaphone,
  Users,
  Settings,
  Radio,
  ArrowRight,
  CheckCircle,
  Sparkles,
  Mic,
} from "lucide-react";

interface OnboardingWizardProps {
  open: boolean;
}

export function OnboardingWizard({ open }: OnboardingWizardProps) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"welcome" | "sections">("welcome");

  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/complete-onboarding");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const sections = [
    {
      key: "shows",
      icon: Podcast,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      path: "/shows",
    },
    {
      key: "ads",
      icon: Megaphone,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
      path: "/ads",
    },
    {
      key: "podvodki",
      icon: Mic,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      path: "/podvodki",
    },
    {
      key: "voices",
      icon: Users,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
      path: "/voices",
    },
    {
      key: "settings",
      icon: Settings,
      color: "text-gray-500",
      bgColor: "bg-gray-500/10",
      path: "/settings",
    },
  ];

  const handleNavigate = (path: string) => {
    completeMutation.mutate();
    setLocation(path);
  };

  const handleSkip = () => {
    completeMutation.mutate();
  };

  return (
    <Dialog open={open && !completeMutation.isSuccess}>
      <DialogContent className="sm:max-w-lg md:max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
        {step === "welcome" ? (
          <>
            <DialogHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Radio className="h-8 w-8 text-primary" />
                </div>
              </div>
              <DialogTitle className="text-2xl">
                {t("onboarding.welcomeTitle")}
              </DialogTitle>
              <DialogDescription className="text-base mt-2">
                {t("onboarding.welcomeDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{t("onboarding.feature1")}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{t("onboarding.feature2")}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{t("onboarding.feature3")}</span>
              </div>
            </div>
            <DialogFooter className="sm:justify-center gap-2">
              <Button
                variant="outline"
                onClick={handleSkip}
                data-testid="button-onboarding-skip"
              >
                {t("onboarding.skipSetup")}
              </Button>
              <Button
                onClick={() => setStep("sections")}
                data-testid="button-onboarding-start"
              >
                {t("onboarding.letsStart")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("onboarding.sectionsTitle")}</DialogTitle>
              <DialogDescription>
                {t("onboarding.sectionsDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              {sections.map((section) => (
                <Card
                  key={section.key}
                  className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
                  onClick={() => handleNavigate(section.path)}
                  data-testid={`card-onboarding-${section.key}`}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className={`h-10 w-10 rounded-lg ${section.bgColor} flex items-center justify-center shrink-0`}>
                      <section.icon className={`h-5 w-5 ${section.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">
                          {t(`onboarding.section.${section.key}.title`)}
                        </h4>
                        <Badge variant="secondary" className="text-xs">
                          {t(`onboarding.section.${section.key}.badge`)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {t(`onboarding.section.${section.key}.desc`)}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep("welcome")}
                data-testid="button-onboarding-back"
              >
                {t("common.back")}
              </Button>
              <Button
                variant="outline"
                onClick={handleSkip}
                data-testid="button-onboarding-finish"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {t("onboarding.finishSetup")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
