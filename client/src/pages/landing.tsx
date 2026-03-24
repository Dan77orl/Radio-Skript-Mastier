import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Radio,
  Wand2,
  Volume2,
  Calendar,
  Cloud,
  Megaphone,
  Users,
  Zap,
  Globe,
  Check,
  ArrowRight,
  Podcast,
  Sparkles,
} from "lucide-react";

export default function LandingPage() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = "RadioFlow AI — " + t("landing.hero.badge");
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute("content", t("landing.hero.subtitle"));
    } else {
      const el = document.createElement("meta");
      el.name = "description";
      el.content = t("landing.hero.subtitle");
      document.head.appendChild(el);
    }
    const setOg = (property: string, content: string) => {
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setOg("og:title", "RadioFlow AI");
    setOg("og:description", t("landing.hero.subtitle"));
    setOg("og:type", "website");
  }, [t]);

  const features = [
    { icon: Wand2, titleKey: "landing.features.aiScripts.title", descKey: "landing.features.aiScripts.desc" },
    { icon: Users, titleKey: "landing.features.multiSpeaker.title", descKey: "landing.features.multiSpeaker.desc" },
    { icon: Volume2, titleKey: "landing.features.tts.title", descKey: "landing.features.tts.desc" },
    { icon: Calendar, titleKey: "landing.features.scheduling.title", descKey: "landing.features.scheduling.desc" },
    { icon: Megaphone, titleKey: "landing.features.ads.title", descKey: "landing.features.ads.desc" },
    { icon: Cloud, titleKey: "landing.features.cloud.title", descKey: "landing.features.cloud.desc" },
    { icon: Podcast, titleKey: "landing.features.shows.title", descKey: "landing.features.shows.desc" },
    { icon: Globe, titleKey: "landing.features.multilang.title", descKey: "landing.features.multilang.desc" },
    { icon: Zap, titleKey: "landing.features.automation.title", descKey: "landing.features.automation.desc" },
  ];

  const pricingPlans = [
    {
      nameKey: "landing.pricing.starter.name",
      priceKey: "landing.pricing.starter.price",
      featuresKeys: [
        "landing.pricing.starter.f1",
        "landing.pricing.starter.f2",
        "landing.pricing.starter.f3",
        "landing.pricing.starter.f4",
      ],
      highlighted: false,
    },
    {
      nameKey: "landing.pricing.pro.name",
      priceKey: "landing.pricing.pro.price",
      featuresKeys: [
        "landing.pricing.pro.f1",
        "landing.pricing.pro.f2",
        "landing.pricing.pro.f3",
        "landing.pricing.pro.f4",
        "landing.pricing.pro.f5",
      ],
      highlighted: true,
    },
    {
      nameKey: "landing.pricing.enterprise.name",
      priceKey: "landing.pricing.enterprise.price",
      featuresKeys: [
        "landing.pricing.enterprise.f1",
        "landing.pricing.enterprise.f2",
        "landing.pricing.enterprise.f3",
        "landing.pricing.enterprise.f4",
        "landing.pricing.enterprise.f5",
      ],
      highlighted: false,
    },
  ];

  const stats = [
    { valueKey: "landing.stats.scripts", labelKey: "landing.stats.scriptsLabel" },
    { valueKey: "landing.stats.hours", labelKey: "landing.stats.hoursLabel" },
    { valueKey: "landing.stats.stations", labelKey: "landing.stats.stationsLabel" },
    { valueKey: "landing.stats.languages", labelKey: "landing.stats.languagesLabel" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <Radio className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold" data-testid="text-brand-name">RadioFlow AI</span>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <ThemeToggle />
              <Link href="/auth">
                <Button variant="ghost" size="sm" data-testid="button-landing-login">
                  {t("landing.nav.login")}
                </Button>
              </Link>
              <Link href="/auth">
                <Button size="sm" data-testid="button-landing-signup">
                  {t("landing.nav.signup")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 dark:from-primary/10 dark:to-primary/10" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36 relative">
          <div className="text-center max-w-4xl mx-auto">
            <Badge variant="secondary" className="mb-6" data-testid="badge-hero">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {t("landing.hero.badge")}
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6" data-testid="text-hero-title">
              {t("landing.hero.title")}
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed" data-testid="text-hero-subtitle">
              {t("landing.hero.subtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/auth">
                <Button size="lg" data-testid="button-hero-start">
                  {t("landing.hero.cta")}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <a href="#features" data-testid="link-hero-features">
                <Button variant="outline" size="lg" data-testid="button-hero-features">
                  {t("landing.hero.learnMore")}
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-primary" data-testid={`text-stat-value-${i}`}>
                  {t(stat.valueKey)}
                </div>
                <div className="text-sm text-muted-foreground mt-1" data-testid={`text-stat-label-${i}`}>
                  {t(stat.labelKey)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" data-testid="text-features-title">
              {t("landing.features.title")}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t("landing.features.subtitle")}
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <Card key={i} className="border bg-card" data-testid={`card-feature-${i}`}>
                <CardContent className="p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{t(feature.titleKey)}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t(feature.descKey)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-28 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" data-testid="text-how-title">
              {t("landing.howItWorks.title")}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t("landing.howItWorks.subtitle")}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[1, 2, 3].map((step) => (
              <div key={step} className="text-center" data-testid={`step-${step}`}>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold mx-auto mb-4">
                  {step}
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  {t(`landing.howItWorks.step${step}.title`)}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t(`landing.howItWorks.step${step}.desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" data-testid="text-pricing-title">
              {t("landing.pricing.title")}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t("landing.pricing.subtitle")}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {pricingPlans.map((plan, i) => (
              <Card
                key={i}
                className={`relative border ${plan.highlighted ? "border-primary ring-2 ring-primary/20" : ""}`}
                data-testid={`card-pricing-${i}`}
              >
                {plan.highlighted && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    {t("landing.pricing.popular")}
                  </Badge>
                )}
                <CardContent className="p-6 pt-8">
                  <h3 className="text-xl font-semibold mb-2">{t(plan.nameKey)}</h3>
                  <div className="mb-6">
                    <span className="text-4xl font-bold">{t(plan.priceKey)}</span>
                    <span className="text-muted-foreground ml-1">/ {t("landing.pricing.month")}</span>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.featuresKeys.map((fk, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{t(fk)}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/auth">
                    <Button
                      className="w-full"
                      variant={plan.highlighted ? "default" : "outline"}
                      data-testid={`button-pricing-${i}`}
                    >
                      {t("landing.pricing.getStarted")}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-28 bg-primary text-primary-foreground">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4" data-testid="text-cta-title">
            {t("landing.cta.title")}
          </h2>
          <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
            {t("landing.cta.subtitle")}
          </p>
          <Link href="/auth">
            <Button size="lg" variant="secondary" data-testid="button-cta-start">
              {t("landing.cta.button")}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                  <Radio className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="text-lg font-bold">RadioFlow AI</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("landing.footer.description")}
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3">{t("landing.footer.product")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" data-testid="link-footer-features">{t("landing.footer.features")}</a></li>
                <li><a href="#pricing" data-testid="link-footer-pricing">{t("landing.footer.pricing")}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">{t("landing.footer.company")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" data-testid="link-footer-terms">{t("landing.footer.terms")}</a></li>
                <li><a href="#" data-testid="link-footer-privacy">{t("landing.footer.privacy")}</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            {t("landing.footer.copyright", { year: new Date().getFullYear() })}
          </div>
        </div>
      </footer>
    </div>
  );
}
