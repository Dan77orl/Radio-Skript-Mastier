import { useState, useCallback } from "react";
import { useConversation } from "@11labs/react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID || "";

export function VoiceAgentWidget() {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const conversation = useConversation({
    onConnect: () => console.log("ElevenLabs agent connected"),
    onDisconnect: () => console.log("ElevenLabs agent disconnected"),
    onError: (error) => console.error("ElevenLabs agent error:", error),
    onMessage: (message) => console.log("Agent message:", message),
  });

  const startConversation = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      await conversation.startSession({
        agentId: AGENT_ID,
      });
    } catch (error) {
      console.error("Failed to start conversation:", error);
    }
  }, [conversation]);

  const stopConversation = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  if (!AGENT_ID) return null;

  const isConnected = conversation.status === "connected";
  const isSpeaking = conversation.isSpeaking;

  return (
    <div className="fixed bottom-6 right-24 z-50 flex flex-col items-end gap-2" data-testid="voice-agent-widget">
      {isExpanded && (
        <div className="bg-card border rounded-xl shadow-2xl p-4 w-72 mb-2 animate-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">RadioFlow AI Agent</h3>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setIsExpanded(false)}
              data-testid="button-close-agent"
            >
              ✕
            </Button>
          </div>

          <div className="flex flex-col items-center gap-3 py-4">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
              isConnected
                ? isSpeaking
                  ? "bg-green-500/20 ring-4 ring-green-500/40 animate-pulse"
                  : "bg-blue-500/20 ring-4 ring-blue-500/40"
                : "bg-muted"
            }`}>
              {isConnected ? (
                isSpeaking ? (
                  <Mic className="h-8 w-8 text-green-500" />
                ) : (
                  <Mic className="h-8 w-8 text-blue-500" />
                )
              ) : (
                <MicOff className="h-8 w-8 text-muted-foreground" />
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {isConnected
                ? isSpeaking
                  ? "Агент говорит..."
                  : "Слушаю вас..."
                : "Нажмите для начала разговора"
              }
            </p>

            <Button
              onClick={isConnected ? stopConversation : startConversation}
              variant={isConnected ? "destructive" : "default"}
              className="w-full"
              data-testid="button-toggle-conversation"
            >
              {isConnected ? (
                <>
                  <PhoneOff className="h-4 w-4 mr-2" />
                  Завершить
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4 mr-2" />
                  Начать разговор
                </>
              )}
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground text-center mt-1">
            Powered by ElevenLabs + Firecrawl
          </p>
        </div>
      )}

      <Button
        size="icon"
        className={`h-14 w-14 rounded-full shadow-lg transition-all duration-300 ${
          isConnected
            ? isSpeaking
              ? "bg-green-500 hover:bg-green-600 animate-pulse"
              : "bg-blue-500 hover:bg-blue-600"
            : "bg-violet-600 hover:bg-violet-700"
        }`}
        onClick={() => {
          if (!isExpanded && !isConnected) {
            setIsExpanded(true);
          } else if (isConnected) {
            setIsExpanded(!isExpanded);
          } else {
            setIsExpanded(!isExpanded);
          }
        }}
        data-testid="button-voice-agent"
      >
        {isConnected ? (
          <Mic className="h-6 w-6 text-white" />
        ) : (
          <Mic className="h-6 w-6 text-white" />
        )}
      </Button>
    </div>
  );
}
