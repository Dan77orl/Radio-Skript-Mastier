import { type ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useHints } from "@/contexts/hints-context";

interface HintTooltipProps {
  children: ReactNode;
  hint: string;
  side?: "top" | "bottom" | "left" | "right";
  delayDuration?: number;
}

export function HintTooltip({ children, hint, side = "top", delayDuration = 300 }: HintTooltipProps) {
  const { showHints } = useHints();

  if (!showHints) {
    return <>{children}</>;
  }

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs">
        <p>{hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}
