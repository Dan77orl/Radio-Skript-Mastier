import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

const SILENCE_TIMEOUT_MS = 15000;

export function VoiceInput({ onTranscript, disabled, className }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      if (isRecording && mediaRecorderRef.current) {
        stopRecording();
        toast({
          title: "Микрофон отключен",
          description: "Автоотключение после 15 секунд",
        });
      }
    }, SILENCE_TIMEOUT_MS);
  }, [isRecording, toast]);

  const sendAudioForTranscription = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const response = await fetch("/api/transcribe-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Ошибка транскрипции");
      }

      const data = await response.json();
      if (data.transcript) {
        onTranscript(data.transcript);
        toast({
          title: "Распознано",
          description: data.transcript.length > 50 
            ? data.transcript.substring(0, 50) + "..." 
            : data.transcript,
        });
      }
    } catch (error) {
      console.error("Transcription error:", error);
      toast({
        title: "Ошибка транскрипции",
        description: error instanceof Error ? error.message : "Не удалось распознать речь",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
          await sendAudioForTranscription(audioBlob);
        }
        
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      resetSilenceTimer();
      
      toast({
        title: "Запись...",
        description: "Говорите в микрофон. Отключится через 15 сек.",
      });
    } catch (error) {
      console.error("Failed to start recording:", error);
      toast({
        title: "Ошибка микрофона",
        description: "Разрешите доступ к микрофону в браузере",
        variant: "destructive",
      });
    }
  };

  const stopRecording = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    setIsRecording(false);
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <Button
      type="button"
      variant={isRecording ? "destructive" : "ghost"}
      size="icon"
      onClick={toggleRecording}
      disabled={disabled || isProcessing}
      className={className}
      data-testid="button-voice-input"
      title={isRecording ? "Остановить запись" : "Голосовой ввод (Gemini)"}
    >
      {isProcessing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isRecording ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
