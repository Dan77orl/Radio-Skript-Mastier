import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Loader2 } from "lucide-react";
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

export function VoiceInput({ onTranscript, disabled, className }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  const { toast } = useToast();

  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSupported(true);
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = "ru-RU";

      recognitionInstance.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        onTranscriptRef.current(transcript);
        setIsListening(false);
        toast({
          title: "Голосовой ввод",
          description: `Распознано: "${transcript}"`,
        });
      };

      recognitionInstance.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        if (event.error === "not-allowed") {
          toast({
            title: "Ошибка микрофона",
            description: "Разрешите доступ к микрофону в браузере",
            variant: "destructive",
          });
        } else if (event.error === "no-speech") {
          toast({
            title: "Голос не распознан",
            description: "Попробуйте говорить громче",
            variant: "destructive",
          });
        }
      };

      recognitionInstance.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognitionInstance;
    }
  }, [toast]);

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
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        toast({
          title: "Слушаю...",
          description: "Говорите в микрофон",
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
  }, [isListening, toast]);

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
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
