import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MessageCircle, X, Send, Mic, MicOff, Loader2, Bot, User } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function SupportChat() {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!isOpen || messages.length === 0) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/support-chat/admin-replies");
        if (res.ok) {
          const data = await res.json();
          if (data.replies && data.replies.length > 0) {
            const existing = new Set(messages.filter(m => m.role === "assistant").map(m => m.content));
            const newReplies = data.replies.filter((r: { content: string }) => !existing.has(r.content));
            if (newReplies.length > 0) {
              setMessages(prev => [
                ...prev,
                ...newReplies.map((r: { content: string }) => ({ role: "assistant" as const, content: r.content })),
              ]);
            }
          }
        }
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [isOpen, messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isLoading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setIsLoading(true);

    try {
      const res = await apiRequest("POST", "/api/support-chat", {
        message: msg,
        language: i18n.language,
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: t("supportChat.error") },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const speechSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    const langMap: Record<string, string> = { ru: "ru-RU", en: "en-US", tr: "tr-TR" };
    recognition.lang = langMap[i18n.language] || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setInput((prev) => (prev ? prev + " " + transcript : transcript));
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.start();
    setIsListening(true);
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          data-testid="button-support-chat-open"
          aria-label={t("supportChat.openChat")}
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {isOpen && (
        <div role="dialog" aria-modal="true" aria-label={t("supportChat.title")} className="fixed bottom-6 right-6 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border bg-background shadow-xl sm:w-[420px]" style={{ height: "min(600px, calc(100vh - 4rem))" }} data-testid="panel-support-chat">
          <div className="flex items-center justify-between rounded-t-xl border-b bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <span className="font-semibold">{t("supportChat.title")}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 transition-colors hover:bg-primary-foreground/20"
              data-testid="button-support-chat-close"
              aria-label={t("supportChat.closeChat")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-4">
                <Bot className="h-12 w-12 mb-3 text-primary/50" />
                <p className="text-sm leading-relaxed">{t("supportChat.welcome")}</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`chat-message-${msg.role}-${i}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-2 justify-start" data-testid="chat-loading">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("supportChat.placeholder")}
                aria-label={t("supportChat.placeholder")}
                className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary min-h-[40px] max-h-[100px]"
                rows={1}
                disabled={isLoading}
                data-testid="input-support-chat"
              />
              {speechSupported && (
                <Button
                  size="icon"
                  variant={isListening ? "destructive" : "ghost"}
                  onClick={toggleVoice}
                  disabled={isLoading}
                  data-testid="button-support-voice"
                  aria-label={isListening ? t("supportChat.stopVoice") : t("supportChat.startVoice")}
                  className="shrink-0"
                >
                  {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button
                size="icon"
                onClick={() => sendMessage()}
                disabled={isLoading || !input.trim()}
                data-testid="button-support-send"
                aria-label={t("supportChat.send")}
                className="shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
