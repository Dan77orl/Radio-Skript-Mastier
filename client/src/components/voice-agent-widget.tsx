import { useEffect, useRef, useState, useCallback } from "react";
import { Phone, PhoneOff, GripVertical, Mic, MicOff } from "lucide-react";

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID || "";

export function VoiceAgentWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const scriptLoaded = useRef(false);
  const convaiRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("voice-widget-pos");
    if (saved) {
      try {
        setPosition(JSON.parse(saved));
      } catch {}
    }
  }, []);

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

  const toggleWidget = useCallback(() => {
    if (!isOpen) {
      setIsOpen(true);
      if (!document.querySelector("elevenlabs-convai")) {
        const widget = document.createElement("elevenlabs-convai");
        widget.setAttribute("agent-id", AGENT_ID);
        widget.style.position = "fixed";
        widget.style.bottom = "100px";
        widget.style.right = "20px";
        widget.style.zIndex = "10000";
        document.body.appendChild(widget);
        convaiRef.current = widget;
      }
      setIsConnected(true);
    } else {
      setIsOpen(false);
      const el = document.querySelector("elevenlabs-convai");
      if (el) el.remove();
      convaiRef.current = null;
      setIsConnected(false);
      setIsMuted(false);
    }
  }, [isOpen]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!buttonRef.current) return;
      e.preventDefault();
      const rect = buttonRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setIsDragging(true);
    },
    []
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 60;
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem("voice-widget-pos", JSON.stringify(position));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const newX = touch.clientX - dragOffset.x;
      const newY = touch.clientY - dragOffset.y;
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 60;
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };
    const handleTouchEnd = () => {
      setIsDragging(false);
      localStorage.setItem("voice-widget-pos", JSON.stringify(position));
    };
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, dragOffset, position]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!buttonRef.current) return;
      const touch = e.touches[0];
      const rect = buttonRef.current.getBoundingClientRect();
      setDragOffset({
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      });
      setIsDragging(true);
    },
    []
  );

  if (!AGENT_ID) return null;

  const useCustomPos = position.x !== 0 || position.y !== 0;

  const style: React.CSSProperties = useCustomPos
    ? {
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 10001,
      }
    : {
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 10001,
      };

  return (
    <div ref={widgetRef} style={style} data-testid="voice-agent-widget">
      <div
        ref={buttonRef}
        className="flex items-center gap-2"
        style={{ cursor: isDragging ? "grabbing" : "default" }}
      >
        <div
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          className="w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-50 hover:opacity-100 transition-opacity"
          title="Перетащить виджет"
          data-testid="voice-widget-drag"
        >
          <GripVertical className="w-4 h-4 text-gray-400" />
        </div>

        {isConnected && (
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg ${
              isMuted
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-gray-700 hover:bg-gray-600 text-white"
            }`}
            title={isMuted ? "Включить микрофон" : "Выключить микрофон"}
            data-testid="voice-widget-mute"
          >
            {isMuted ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
        )}

        <button
          onClick={toggleWidget}
          className={`relative group flex items-center gap-3 rounded-full px-5 py-3 font-medium transition-all shadow-lg ${
            isConnected
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
          }`}
          data-testid="voice-widget-toggle"
        >
          {isConnected ? (
            <>
              <PhoneOff className="w-5 h-5" />
              <span className="text-sm">Завершить</span>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            </>
          ) : (
            <>
              <Phone className="w-5 h-5" />
              <span className="text-sm">Голосовой помощник</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
