import { useEffect, useRef, useState, useMemo } from "react";
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
  Play,
  ChevronDown,
} from "lucide-react";
import heroDashboard from "@assets/generated_images/hero_dashboard.png";
import featureScripts from "@assets/generated_images/feature_scripts.png";
import featureVoices from "@assets/generated_images/feature_voices.png";
import featureAutomation from "@assets/generated_images/feature_automation.png";

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}

function useHeaderShadow() {
  const [hasShadow, setHasShadow] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHasShadow(!entry.isIntersecting),
      { threshold: 1.0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { sentinelRef, hasShadow };
}

function AnimatedCounter({ target, suffix = "" }: { target: string; suffix?: string }) {
  const [count, setCount] = useState(0);
  const { ref, isVisible } = useInView(0.3);
  const num = parseInt(target.replace(/\D/g, ""), 10) || 0;

  useEffect(() => {
    if (!isVisible || num === 0) return;
    let current = 0;
    const step = Math.max(1, Math.floor(num / 40));
    const timer = setInterval(() => {
      current += step;
      if (current >= num) {
        setCount(num);
        clearInterval(timer);
      } else {
        setCount(current);
      }
    }, 30);
    return () => clearInterval(timer);
  }, [isVisible, num]);

  const hasPlusOrK = target.includes("+") || target.includes("K") || target.includes("k");
  const displaySuffix = target.includes("K") || target.includes("k") ? "K+" : target.includes("+") ? "+" : "";

  return (
    <span ref={ref}>
      {isVisible ? `${count >= 1000 && displaySuffix.includes("K") ? Math.floor(count / 1000) * 1000 > 0 ? count : 0 : count}${displaySuffix}${suffix}` : "0"}
    </span>
  );
}

function FloatingParticle({ delay, x, size, duration }: { delay: number; x: number; size: number; duration: number }) {
  return (
    <div
      className="absolute rounded-full bg-primary/20 dark:bg-primary/10 animate-float"
      style={{
        width: size,
        height: size,
        left: `${x}%`,
        bottom: "-20px",
        animationDelay: `${delay}s`,
        animationDuration: `${duration}s`,
      }}
    />
  );
}

export default function LandingPage() {
  const { t } = useTranslation();
  const { sentinelRef, hasShadow } = useHeaderShadow();
  const [activeFeature, setActiveFeature] = useState(0);

  const productName = t("landing.productName");

  useEffect(() => {
    document.title = productName + " — " + t("landing.hero.badge");
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
    setOg("og:title", productName);
    setOg("og:description", t("landing.hero.subtitle"));
    setOg("og:type", "website");
  }, [t, productName]);

  const heroParticles = useMemo(() =>
    Array.from({ length: 8 }, (_, i) => ({
      delay: i * 0.8,
      x: 10 + i * 12,
      size: 6 + Math.random() * 10,
      duration: 6 + Math.random() * 4,
    })), []);

  const ctaParticles = useMemo(() =>
    Array.from({ length: 5 }, (_, i) => ({
      delay: i * 1.2,
      x: 5 + i * 20,
      size: 8 + Math.random() * 12,
      duration: 6 + Math.random() * 4,
    })), []);

  const features = [
    { icon: Wand2, titleKey: "landing.features.aiScripts.title", descKey: "landing.features.aiScripts.desc", image: featureScripts },
    { icon: Users, titleKey: "landing.features.multiSpeaker.title", descKey: "landing.features.multiSpeaker.desc" },
    { icon: Volume2, titleKey: "landing.features.tts.title", descKey: "landing.features.tts.desc", image: featureVoices },
    { icon: Calendar, titleKey: "landing.features.scheduling.title", descKey: "landing.features.scheduling.desc" },
    { icon: Megaphone, titleKey: "landing.features.ads.title", descKey: "landing.features.ads.desc" },
    { icon: Cloud, titleKey: "landing.features.cloud.title", descKey: "landing.features.cloud.desc" },
    { icon: Podcast, titleKey: "landing.features.shows.title", descKey: "landing.features.shows.desc" },
    { icon: Globe, titleKey: "landing.features.multilang.title", descKey: "landing.features.multilang.desc" },
    { icon: Zap, titleKey: "landing.features.automation.title", descKey: "landing.features.automation.desc", image: featureAutomation },
  ];

  const pricingPlans = [
    {
      nameKey: "landing.pricing.starter.name",
      priceKey: "landing.pricing.starter.price",
      featuresKeys: ["landing.pricing.starter.f1", "landing.pricing.starter.f2", "landing.pricing.starter.f3", "landing.pricing.starter.f4"],
      highlighted: false,
    },
    {
      nameKey: "landing.pricing.pro.name",
      priceKey: "landing.pricing.pro.price",
      featuresKeys: ["landing.pricing.pro.f1", "landing.pricing.pro.f2", "landing.pricing.pro.f3", "landing.pricing.pro.f4", "landing.pricing.pro.f5"],
      highlighted: true,
    },
    {
      nameKey: "landing.pricing.enterprise.name",
      priceKey: "landing.pricing.enterprise.price",
      featuresKeys: ["landing.pricing.enterprise.f1", "landing.pricing.enterprise.f2", "landing.pricing.enterprise.f3", "landing.pricing.enterprise.f4", "landing.pricing.enterprise.f5"],
      highlighted: false,
    },
  ];

  const stats = [
    { valueKey: "landing.stats.scripts", labelKey: "landing.stats.scriptsLabel" },
    { valueKey: "landing.stats.hours", labelKey: "landing.stats.hoursLabel" },
    { valueKey: "landing.stats.stations", labelKey: "landing.stats.stationsLabel" },
    { valueKey: "landing.stats.languages", labelKey: "landing.stats.languagesLabel" },
  ];

  const featuresSection = useInView();
  const howSection = useInView();
  const pricingSection = useInView();
  const ctaSection = useInView();

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.6; }
          50% { transform: translateY(-100vh) scale(0.5); opacity: 0; }
        }
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-in-left {
          from { opacity: 0; transform: translateX(-40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-3deg); }
          75% { transform: rotate(3deg); }
        }
        .animate-float { animation: float linear infinite; }
        .animate-slide-up { animation: slide-up 0.7s ease-out both; }
        .animate-slide-in-left { animation: slide-in-left 0.7s ease-out both; }
        .animate-slide-in-right { animation: slide-in-right 0.7s ease-out both; }
        .animate-fade-in { animation: fade-in 0.6s ease-out both; }
        .animate-scale-in { animation: scale-in 0.5s ease-out both; }
        .stagger-1 { animation-delay: 0.1s; }
        .stagger-2 { animation-delay: 0.2s; }
        .stagger-3 { animation-delay: 0.3s; }
        .stagger-4 { animation-delay: 0.4s; }
        .stagger-5 { animation-delay: 0.5s; }
        .stagger-6 { animation-delay: 0.6s; }
        .stagger-7 { animation-delay: 0.7s; }
        .stagger-8 { animation-delay: 0.8s; }
        .stagger-9 { animation-delay: 0.9s; }
        .hover-lift { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .hover-lift:hover { transform: translateY(-6px); box-shadow: 0 12px 40px -12px rgba(0,0,0,0.15); }
        .dark .hover-lift:hover { box-shadow: 0 12px 40px -12px rgba(0,0,0,0.4); }
        .gradient-text {
          background: linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(207 89% 60%) 50%, hsl(280 65% 55%) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>

      <div ref={sentinelRef} className="absolute top-0 h-1 w-full" />
      <header
        className={`sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-shadow duration-300 ${hasShadow ? "shadow-[0_4px_20px_rgba(0,0,0,0.08)]" : ""}`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary relative">
                <Radio className="h-5 w-5 text-primary-foreground" />
                <div className="absolute inset-0 rounded-lg bg-primary" style={{ animation: "pulse-ring 2s ease-out infinite" }} />
              </div>
              <span className="text-xl font-bold" data-testid="text-brand-name">{productName}</span>
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

      <section className="relative overflow-hidden min-h-[85vh] flex items-center">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 dark:from-primary/10 dark:to-primary/5" />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {heroParticles.map((p, i) => (
            <FloatingParticle key={i} delay={p.delay} x={p.x} size={p.size} duration={p.duration} />
          ))}
        </div>
        <div className="absolute top-20 right-[-10%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl dark:bg-primary/10 pointer-events-none" />
        <div className="absolute bottom-10 left-[-5%] w-[300px] h-[300px] rounded-full bg-chart-4/5 blur-3xl dark:bg-chart-4/10 pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 relative w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="animate-slide-up">
              <Badge variant="secondary" className="mb-6 animate-fade-in" data-testid="badge-hero">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {t("landing.hero.badge")}
              </Badge>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6" data-testid="text-hero-title">
                <span className="gradient-text">{t("landing.hero.title")}</span>
              </h1>
              <p className="text-lg sm:text-xl text-muted-foreground mb-10 leading-relaxed animate-fade-in stagger-2" data-testid="text-hero-subtitle">
                {t("landing.hero.subtitle")}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 animate-fade-in stagger-3">
                <Link href="/auth">
                  <Button size="lg" data-testid="button-hero-start">
                    {t("landing.hero.cta")}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <a href="#features" data-testid="link-hero-features">
                  <Button variant="outline" size="lg" data-testid="button-hero-features">
                    <Play className="mr-2 h-4 w-4" />
                    {t("landing.hero.learnMore")}
                  </Button>
                </a>
              </div>
            </div>
            <div className="animate-slide-in-right stagger-2 hidden lg:block">
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-chart-4/20 to-primary/20 rounded-2xl blur-2xl opacity-50" />
                <img
                  src={heroDashboard}
                  alt="RadioFlow AI Dashboard"
                  className="relative rounded-xl border shadow-2xl w-full"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-center mt-12 animate-fade-in stagger-5">
            <a href="#stats" className="text-muted-foreground hover:text-primary transition-colors">
              <ChevronDown className="h-6 w-6 animate-bounce" />
            </a>
          </div>
        </div>
      </section>

      <section id="stats" className="border-y bg-muted/30 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={i} className="text-center group">
                <div className="text-3xl sm:text-5xl font-bold text-primary transition-transform duration-300 group-hover:scale-110" data-testid={`text-stat-value-${i}`}>
                  <AnimatedCounter target={t(stat.valueKey)} />
                </div>
                <div className="text-sm text-muted-foreground mt-2" data-testid={`text-stat-label-${i}`}>
                  {t(stat.labelKey)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-20 sm:py-28" ref={featuresSection.ref}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`text-center mb-16 ${featuresSection.isVisible ? "animate-slide-up" : "opacity-0"}`}>
            <Badge variant="secondary" className="mb-4">
              <Sparkles className="h-3 w-3 mr-1" />
              {t("landing.features.title")}
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" data-testid="text-features-title">
              <span className="gradient-text">{t("landing.features.title")}</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t("landing.features.subtitle")}
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-center mb-16">
            <div className={`space-y-3 ${featuresSection.isVisible ? "animate-slide-in-left stagger-2" : "opacity-0"}`}>
              {features.map((feature, i) => (
                <button
                  key={i}
                  onClick={() => setActiveFeature(i)}
                  className={`w-full text-left p-4 rounded-xl border transition-all duration-300 ${
                    activeFeature === i
                      ? "border-primary bg-primary/5 shadow-md"
                      : "border-transparent hover:border-border hover:bg-muted/50"
                  }`}
                  data-testid={`button-feature-${i}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-300 ${
                      activeFeature === i ? "bg-primary text-primary-foreground" : "bg-primary/10"
                    }`}>
                      <feature.icon className={`h-5 w-5 ${activeFeature === i ? "" : "text-primary"}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold">{t(feature.titleKey)}</h3>
                      {activeFeature === i && (
                        <p className="text-sm text-muted-foreground mt-1 animate-fade-in leading-relaxed">
                          {t(feature.descKey)}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className={`${featuresSection.isVisible ? "animate-slide-in-right stagger-3" : "opacity-0"}`}>
              <div className="relative aspect-square max-w-md mx-auto">
                <div className="absolute -inset-4 bg-gradient-to-br from-primary/10 to-chart-4/10 rounded-2xl blur-xl" />
                <div className="relative bg-card rounded-xl border p-8 h-full flex items-center justify-center overflow-hidden">
                  {features[activeFeature]?.image ? (
                    <img
                      src={features[activeFeature].image}
                      alt={t(features[activeFeature].titleKey)}
                      className="w-full h-full object-contain animate-scale-in"
                      key={activeFeature}
                    />
                  ) : (
                    <div className="text-center animate-scale-in" key={activeFeature}>
                      {(() => {
                        const Icon = features[activeFeature].icon;
                        return <Icon className="h-24 w-24 text-primary/30 mx-auto mb-4" />;
                      })()}
                      <p className="text-lg font-semibold">{t(features[activeFeature].titleKey)}</p>
                      <p className="text-sm text-muted-foreground mt-2 max-w-xs">
                        {t(features[activeFeature].descKey)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-28 bg-muted/30 relative overflow-hidden" ref={howSection.ref}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className={`text-center mb-16 ${howSection.isVisible ? "animate-slide-up" : "opacity-0"}`}>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4" data-testid="text-how-title">
              {t("landing.howItWorks.title")}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {t("landing.howItWorks.subtitle")}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto relative">
            <div className="hidden md:block absolute top-12 left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-primary/30 via-primary to-primary/30" />
            {[1, 2, 3].map((step) => (
              <div
                key={step}
                className={`text-center relative ${howSection.isVisible ? `animate-slide-up stagger-${step + 1}` : "opacity-0"}`}
                data-testid={`step-${step}`}
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-2xl font-bold mx-auto mb-6 relative shadow-lg">
                  {step}
                  <div className="absolute inset-0 rounded-full bg-primary/50" style={{ animation: "pulse-ring 3s ease-out infinite", animationDelay: `${step * 0.5}s` }} />
                </div>
                <h3 className="text-lg font-semibold mb-3">
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

      <section id="pricing" className="py-20 sm:py-28" ref={pricingSection.ref}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`text-center mb-16 ${pricingSection.isVisible ? "animate-slide-up" : "opacity-0"}`}>
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
                className={`relative border hover-lift ${
                  pricingSection.isVisible ? `animate-slide-up stagger-${i + 2}` : "opacity-0"
                } ${plan.highlighted ? "border-primary ring-2 ring-primary/20 scale-105" : ""}`}
                data-testid={`card-pricing-${i}`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-5 left-0 right-0 flex justify-center">
                    <Badge className="shadow-lg">{t("landing.pricing.popular")}</Badge>
                  </div>
                )}
                <CardContent className="p-6 pt-8">
                  <h3 className="text-xl font-semibold mb-2">{t(plan.nameKey)}</h3>
                  <div className="mb-6">
                    <span className="text-4xl font-bold gradient-text">{t(plan.priceKey)}</span>
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

      <section className="py-20 sm:py-28 relative overflow-hidden" ref={ctaSection.ref}>
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-chart-4/80" />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {ctaParticles.map((p, i) => (
            <FloatingParticle key={i} delay={p.delay} x={p.x} size={p.size} duration={p.duration} />
          ))}
        </div>
        <div className={`max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative text-primary-foreground ${ctaSection.isVisible ? "animate-slide-up" : "opacity-0"}`}>
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
                <span className="text-lg font-bold">{productName}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("landing.footer.description")}
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3">{t("landing.footer.product")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" data-testid="link-footer-features" className="hover:text-primary transition-colors">{t("landing.footer.features")}</a></li>
                <li><a href="#pricing" data-testid="link-footer-pricing" className="hover:text-primary transition-colors">{t("landing.footer.pricing")}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">{t("landing.footer.company")}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" data-testid="link-footer-terms" className="hover:text-primary transition-colors">{t("landing.footer.terms")}</a></li>
                <li><a href="#" data-testid="link-footer-privacy" className="hover:text-primary transition-colors">{t("landing.footer.privacy")}</a></li>
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
