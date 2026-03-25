import { useEffect } from "react";

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID || "";

export function VoiceAgentWidget() {
  useEffect(() => {
    if (!AGENT_ID) return;

    if (document.querySelector('elevenlabs-convai')) return;

    const widget = document.createElement("elevenlabs-convai");
    widget.setAttribute("agent-id", AGENT_ID);
    document.body.appendChild(widget);

    if (!document.querySelector('script[src*="convai-widget-embed"]')) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
      script.async = true;
      script.type = "text/javascript";
      document.body.appendChild(script);
    }

    return () => {
      const el = document.querySelector('elevenlabs-convai');
      if (el) el.remove();
    };
  }, []);

  return null;
}
