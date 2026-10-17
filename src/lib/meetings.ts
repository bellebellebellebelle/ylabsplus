import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Meeting = Database["public"]["Tables"]["meetings"]["Row"];
export type Action = { task: string; owner?: string; deadline?: string };
export type Topic = { title: string; points?: string[] };

export function useMeetings() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("meetings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, () =>
        qc.invalidateQueries({ queryKey: ["meetings"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  return useQuery({
    queryKey: ["meetings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*")
        .order("meeting_date", { ascending: true });
      if (error) throw error;
      return data as Meeting[];
    },
  });
}

export const tone = (s: number) => (s >= 75 ? "good" : s >= 50 ? "warn" : "bad");
export const toneText = { good: "text-good", warn: "text-warn", bad: "text-bad" } as const;
export const toneBg = { good: "bg-good", warn: "bg-warn", bad: "bg-bad" } as const;
export const toneVar = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)" } as const;

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
