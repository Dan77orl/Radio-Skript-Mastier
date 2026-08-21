import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

interface TelegramLoginProps {
  onAuth: (data: Record<string, unknown>) => void;
  /** "write" also asks permission for the bot to message the user. */
  requestAccess?: "read" | "write";
  buttonSize?: "large" | "medium" | "small";
}

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

/**
 * Telegram Login Widget.
 *
 * The widget is an iframe Telegram injects via its own script — it cannot be
 * rendered as ordinary JSX, so the script tag is appended manually and the
 * callback is exposed on window, which is the only channel the widget offers.
 * Nothing here is trusted: the payload is verified server-side by HMAC.
 */
export function TelegramLoginButton({ onAuth, requestAccess = "read", buttonSize = "large" }: TelegramLoginProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  const { data: config } = useQuery<{ enabled: boolean; botUsername: string | null }>({
    queryKey: ["/api/auth/telegram/config"],
    retry: false,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !config?.enabled || !config.botUsername) return;

    window.onTelegramAuth = (user) => onAuthRef.current(user);

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", config.botUsername);
    script.setAttribute("data-size", buttonSize);
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", requestAccess);
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      delete window.onTelegramAuth;
    };
  }, [config?.enabled, config?.botUsername, buttonSize, requestAccess]);

  if (!config?.enabled) return null;

  return <div ref={containerRef} className="flex justify-center" data-testid="telegram-login-button" />;
}
