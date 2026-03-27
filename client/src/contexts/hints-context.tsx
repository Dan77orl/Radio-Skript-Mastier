import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Settings } from "@shared/schema";

interface HintsContextType {
  showHints: boolean;
}

const HintsContext = createContext<HintsContextType>({ showHints: true });

export function HintsProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const showHints = settings?.showHints !== false;

  return (
    <HintsContext.Provider value={{ showHints }}>
      {children}
    </HintsContext.Provider>
  );
}

export function useHints() {
  return useContext(HintsContext);
}
