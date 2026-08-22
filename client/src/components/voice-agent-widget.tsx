import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Phone, PhoneOff } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID || "";

// Sidebar entry for the ElevenLabs conversational agent. The launcher used to
// be a floating draggable pill that covered toasts and action buttons in the
// bottom-right corner; only the call panel itself appears over the page now,
// and only while a call is active.
export function VoiceAgentMenuItem() {
  const { t } = useTranslation();
  const [isConnected, setIsConnected] = useState(false);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    if (!AGENT_ID || scriptLoaded.current) return;
    if (!document.querySelector('script[src*="convai-widget-embed"]')) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
      script.async = true;
      script.type = "text/javascript";
      document.body.appendChild(script);
      scriptLoaded.current = true;
    }
  }, []);

  useEffect(() => {
    return () => {
      document.querySelector("elevenlabs-convai")?.remove();
    };
  }, []);

  const toggleWidget = useCallback(() => {
    if (!isConnected) {
      if (!document.querySelector("elevenlabs-convai")) {
        const widget = document.createElement("elevenlabs-convai");
        widget.setAttribute("agent-id", AGENT_ID);
        widget.style.position = "fixed";
        widget.style.bottom = "20px";
        widget.style.right = "20px";
        widget.style.zIndex = "10000";
        document.body.appendChild(widget);
      }
      setIsConnected(true);
    } else {
      document.querySelector("elevenlabs-convai")?.remove();
      setIsConnected(false);
    }
  }, [isConnected]);

  if (!AGENT_ID) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={toggleWidget}
        tooltip={isConnected ? t("voiceWidget.disconnect") : t("voiceWidget.title")}
        className={isConnected ? "text-red-600 dark:text-red-400" : ""}
        data-testid="voice-widget-toggle"
      >
        {isConnected ? <PhoneOff className="h-4 w-4 shrink-0" /> : <Phone className="h-4 w-4 shrink-0" />}
        <span>{isConnected ? t("voiceWidget.disconnect") : t("voiceWidget.title")}</span>
        {isConnected && <span className="ml-auto h-2 w-2 rounded-full bg-green-500 animate-pulse" />}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
