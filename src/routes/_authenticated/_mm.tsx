import { createFileRoute, Outlet, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard, Workflow, Activity, Link2, Settings, LogOut, Sparkles,
  Bot, ChevronLeft, ChevronRight, Wrench, Radio,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useClickRipple } from "@/lib/use-click-ripple";
import { VoiceButton } from "@/components/voice-button";

export const Route = createFileRoute("/_authenticated/_mm")({ component: AuthedLayout });

import { BarChart3, Wand2, Coins } from "lucide-react";

const NAV = [
  { to: "/cockpit", label: "Cockpit", icon: LayoutDashboard },
  { to: "/automations", label: "Automatisations", icon: Workflow },
  { to: "/optimizer", label: "Optimiseur IA", icon: Wand2 },
  { to: "/kpi", label: "KPI", icon: BarChart3 },
  { to: "/costs", label: "Coûts", icon: Coins },
  { to: "/executions", label: "Exécutions", icon: Activity },
  { to: "/ticks", label: "Journal Cron", icon: Radio },
  { to: "/tools", label: "Outils", icon: Wrench },
  { to: "/helpy", label: "HELPY", icon: Bot },
  { to: "/connections", label: "Connexions", icon: Link2 },
  { to: "/preferences", label: "Paramètres", icon: Settings },
] as const;

type Prefs = { background_url: string | null; background_opacity: number; sidebar_collapsed: boolean };

function AuthedLayout() {
  const router = useRouter();
  const qc = useQueryClient();
  useClickRipple();
  const [collapsed, setCollapsed] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ background_url: null, background_opacity: 0.35, sidebar_collapsed: false });

  useEffect(() => {
    supabase.from("ui_preferences").select("background_url,background_opacity,sidebar_collapsed").maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPrefs(data as Prefs);
          setCollapsed(!!data.sidebar_collapsed);
        }
      });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--shadow-opacity", String(prefs.background_opacity ?? 0.35));
  }, [prefs.background_opacity]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  async function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    await supabase.from("ui_preferences").upsert({ sidebar_collapsed: next, user_id: (await supabase.auth.getUser()).data.user!.id });
  }

  // Fond d'écran : peindre le <body> directement pour passer sous tout le contenu vitrifié.
  useEffect(() => {
    const body = document.body;
    if (prefs.background_url) {
      body.style.backgroundImage = `linear-gradient(rgba(225,220,201,${1 - (prefs.background_opacity ?? 0.35)}), rgba(225,220,201,${1 - (prefs.background_opacity ?? 0.35)})), url("${prefs.background_url}")`;
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundAttachment = "fixed";
    } else {
      body.style.backgroundImage = "";
    }
    return () => {
      body.style.backgroundImage = "";
    };
  }, [prefs.background_url, prefs.background_opacity]);

  return (
    <div className="mm-theme min-h-screen flex relative">
      <aside className={`hidden md:flex flex-col border-r border-foreground/10 bento-card rounded-none transition-all duration-300 ${collapsed ? "w-14" : "w-64"}`}>
        <div className={`flex items-center justify-between ${collapsed ? "p-2" : "p-4"}`}>
          <Link to="/cockpit" className="flex items-center gap-2 min-w-0">
            <div className={`${collapsed ? "size-9" : "size-10"} rounded-2xl holo-gradient animate-holo holo-glow flex items-center justify-center text-white font-bold press`}>N</div>
            {!collapsed && <div className="min-w-0">
              <div className="font-display font-semibold truncate">Nexus</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Cockpit IA</div>
            </div>}
          </Link>
        </div>
        <nav className={`mt-4 flex flex-col gap-1 ${collapsed ? "px-1.5" : "px-3"}`}>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to}
              activeProps={{ className: "holo-gradient animate-holo text-white holo-glow" }}
              inactiveProps={{ className: "text-foreground/70 hover:bg-white/40 hover:text-foreground" }}
              className={`press flex items-center gap-3 rounded-xl text-sm transition-all ${collapsed ? "justify-center p-2.5" : "px-3 py-2.5"}`}
              title={collapsed ? n.label : undefined}>
              <n.icon className="size-4 shrink-0" /> {!collapsed && n.label}
            </Link>
          ))}
        </nav>
        <div className={`mt-auto space-y-2 ${collapsed ? "p-1.5" : "p-3"}`}>
          {!collapsed && (
            <Link to="/automations/new">
              <button className="press w-full inline-flex items-center justify-center gap-2 rounded-xl holo-gradient animate-holo holo-glow px-4 py-2.5 text-sm font-medium text-white">
                <Sparkles className="size-4" /> Nouvelle auto
              </button>
            </Link>
          )}
          <button onClick={signOut} title="Déconnexion" className={`press w-full inline-flex items-center justify-center gap-2 rounded-xl border border-foreground/10 text-sm text-muted-foreground hover:bg-white/40 ${collapsed ? "p-2" : "px-3 py-2"}`}>
            <LogOut className="size-4" /> {!collapsed && "Déconnexion"}
          </button>
          <button onClick={toggleCollapse} title={collapsed ? "Étendre" : "Réduire"} className={`press w-full inline-flex items-center justify-center gap-1 rounded-xl text-xs text-muted-foreground hover:bg-white/40 ${collapsed ? "p-1.5" : "py-1.5"}`}>
            {collapsed ? <ChevronRight className="size-4" /> : <><ChevronLeft className="size-4" /> Réduire</>}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="md:hidden border-b border-foreground/10 bento-card rounded-none p-3 flex items-center justify-between">
          <Link to="/cockpit" className="font-display font-semibold flex items-center gap-2">
            <div className="size-8 rounded-xl holo-gradient flex items-center justify-center text-white font-bold text-sm">N</div>
            Nexus
          </Link>
          <button onClick={signOut} className="text-xs text-muted-foreground"><LogOut className="size-4" /></button>
        </div>
        <div className="md:hidden border-b border-foreground/10 overflow-x-auto">
          <nav className="flex gap-1 p-2 min-w-max">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to}
                activeProps={{ className: "holo-gradient text-white" }}
                inactiveProps={{ className: "text-muted-foreground" }}
                className="press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap">
                <n.icon className="size-3.5" /> {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <Outlet />
      </main>

      <GlobalVoiceButton />
    </div>
  );
}

function GlobalVoiceButton() {
  return <VoiceButton floating onTranscript={(text) => {
    window.dispatchEvent(new CustomEvent("nexus:voice", { detail: { text } }));
    navigator.clipboard?.writeText(text).catch(() => {});
  }} />;
}
