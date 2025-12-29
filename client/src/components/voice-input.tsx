import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const SILENCE_TIMEOUT_MS = 15000;

export function VoiceInput({ onTranscript, disabled, className }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTextRef = useRef<string>("");
  const isListeningRef = useRef(false);
  const { toast } = useToast();

  onTranscriptRef.current = onTranscript;

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      if (isListeningRef.current && recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
        isListeningRef.current = false;
        toast({
          title: "Микрофон отключен",
          description: "Автоотключение после 15 секунд тишины",
        });
      }
    }, SILENCE_TIMEOUT_MS);
  }, [toast]);

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
    isListeningRef.current = false;
    accumulatedTextRef.current = "";
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSupported(true);
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = true;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = "ru-RU";

      recognitionInstance.onresult = (event: any) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const transcript = lastResult[0].transcript.trim();
          if (transcript) {
            onTranscriptRef.current(transcript);
            toast({
              title: "Распознано",
              description: transcript.length > 50 ? transcript.substring(0, 50) + "..." : transcript,
            });
          }
          resetSilenceTimer();
        }
      };

      recognitionInstance.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          stopListening();
          toast({
            title: "Ошибка микрофона",
            description: "Разрешите доступ к микрофону в браузере",
            variant: "destructive",
          });
        } else if (event.error === "no-speech") {
          // Продолжаем слушать, таймер сам отключит
        } else if (event.error === "aborted") {
          // Игнорируем - это нормальное поведение при остановке
        } else {
          toast({
            title: "Ошибка распознавания",
            description: event.error,
            variant: "destructive",
          });
        }
      };

      recognitionInstance.onend = () => {
        // Если всё ещё должны слушать - перезапускаем
        if (isListeningRef.current) {
          try {
            recognitionInstance.start();
          } catch (e) {
            // Игнорируем ошибки перезапуска
          }
        }
      };

      recognitionRef.current = recognitionInstance;
    }

    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [toast, resetSilenceTimer, stopListening]);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) {
      toast({
        title: "Не поддерживается",
        description: "Голосовой ввод не поддерживается в этом браузере",
        variant: "destructive",
      });
      return;
    }

    if (isListening) {
      stopListening();
      toast({
        title: "Микрофон отключен",
      });
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        isListeningRef.current = true;
        resetSilenceTimer();
        toast({
          title: "Слушаю...",
          description: "Говорите в микрофон. Отключится через 15 сек тишины.",
        });
      } catch (error) {
        console.error("Failed to start recognition:", error);
        toast({
          title: "Ошибка",
          description: "Не удалось запустить запись",
          variant: "destructive",
        });
      }
    }
  }, [isListening, toast, resetSilenceTimer, stopListening]);

  if (!isSupported) {
    return null;
  }

  return (
    <Button
      type="button"
      variant={isListening ? "destructive" : "ghost"}
      size="icon"
      onClick={toggleListening}
      disabled={disabled}
      className={className}
      data-testid="button-voice-input"
    >
      {isListening ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
