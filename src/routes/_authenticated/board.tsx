import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Loader2,
  PlugZap,
  Plus,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardCanvas, type View } from "@/components/smart-teams/BoardCanvas";
import { AgentNote } from "@/components/smart-teams/AgentNote";
import { AgentPanel } from "@/components/smart-teams/AgentPanel";
import { MissionPanel } from "@/components/smart-teams/MissionPanel";
import { OdooPanel } from "@/components/smart-teams/OdooPanel";
import { DEPARTMENTS, DEPARTMENT_MAP } from "@/lib/smart-teams/agent-config";
import { suggestTeam } from "@/lib/smart-teams/ai.functions";
import {
  BOARD_KEY,
  createAgent,
  createCustomDepartment,
  createTeam,
  deleteCustomDepartment,
  deleteTeam,
  fetchCustomDepartments,
  fetchOdooState,
  updateAgent,
  useBoard,
  type Agent,
  type CustomDepartment,
  type OdooState,
} from "@/lib/smart-teams/board-data";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/board")({
  head: () => ({
    meta: [
      { title: "Tableau de pilotage — Smart Teams" },
      {
        name: "description",
        content: "Tableau infini de post-it : composez vos équipes d'agents IA et lancez vos missions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Tableau de pilotage — Smart Teams" },
      {
        property: "og:description",
        content: "Composez vos équipes d'agents IA par département et suivez leurs livrables.",
      },
    ],
  }),
  component: BoardPage,
});

function BoardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useBoard();
  const suggest = useServerFn(suggestTeam);

  const [view, setView] = useState<View>({ x: 120, y: 100, scale: 1 });
  const [department, setDepartment] = useState<string>("marketing");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [missionTeam, setMissionTeam] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [newTeam, setNewTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [smartFocus, setSmartFocus] = useState("");
  const [odooOpen, setOdooOpen] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [customDepts, setCustomDepts] = useState<CustomDepartment[]>([]);
  const [odooState, setOdooState] = useState<OdooState>({
    connected: false,
    url: "",
    database: "",
    username: "",
    modulesByDept: {},
  });

  const refreshExtras = () => {
    void fetchCustomDepartments().then(setCustomDepts).catch(() => {});
    void fetchOdooState().then(setOdooState).catch(() => {});
  };
  useEffect(refreshExtras, []);

  const allDepartments = useMemo(
    () => [
      ...DEPARTMENTS,
      ...customDepts.map((d) => ({
        key: d.key,
        label: d.label,
        blurb: d.blurb,
        defaultTeam: d.default_team,
      })),
    ],
    [customDepts],
  );
  const deptLabel = (key: string) =>
    DEPARTMENT_MAP[key]?.label ?? customDepts.find((d) => d.key === key)?.label ?? key;
  const deptDefaultTeam = (key: string) =>
    DEPARTMENT_MAP[key]?.defaultTeam ??
    customDepts.find((d) => d.key === key)?.default_team ??
    "Nouvelle équipe";
  const drag = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(
    null,
  );

  const teams = data?.teams ?? [];
  const agents = data?.agents ?? [];
  const departmentTeams = teams.filter((t) => t.department === department);
  const visibleAgents = useMemo(
    () =>
      agents.filter(
        (a) => a.department === department && (teamId === null || a.team_id === teamId),
      ),
    [agents, department, teamId],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: BOARD_KEY });

  function onPointerDownDrag(event: React.PointerEvent, agent: Agent) {
    event.stopPropagation();
    drag.current = {
      id: agent.id,
      startX: event.clientX,
      startY: event.clientY,
      ox: agent.pos_x,
      oy: agent.pos_y,
    };
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const x = d.ox + (e.clientX - d.startX) / view.scale;
      const y = d.oy + (e.clientY - d.startY) / view.scale;
      queryClient.setQueryData(BOARD_KEY, (prev: typeof data) =>
        prev
          ? {
              ...prev,
              agents: prev.agents.map((a) =>
                a.id === d.id ? { ...a, pos_x: Math.round(x), pos_y: Math.round(y) } : a,
              ),
            }
          : prev,
      );
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      if (!d) return;
      const current = (queryClient.getQueryData(BOARD_KEY) as typeof data)?.agents.find(
        (a) => a.id === d.id,
      );
      if (current) void updateAgent(d.id, { pos_x: current.pos_x, pos_y: current.pos_y });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  async function addTeam() {
    const name = newTeam.trim() || deptDefaultTeam(department);
    try {
      const team = await createTeam(department, name);
      setNewTeam("");
      setTeamId(team.id);
      await refresh();
      toast.success(`Équipe « ${team.name} » créée`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible");
    }
  }

  async function addAgent() {
    try {
      const target = teamId ?? departmentTeams[0]?.id ?? null;
      const count = agents.filter((a) => a.department === department).length;
      const agent = await createAgent({
        department,
        team_id: target,
        name: `Agent ${count + 1}`,
        role: "",
        color: department,
        model: "openai/gpt-5.6-terra",
        is_chief: !agents.some((a) => a.team_id === target && a.is_chief),
        pos_x: 80 + (count % 4) * 260,
        pos_y: 80 + Math.floor(count / 4) * 230,
      });
      await refresh();
      setSelectedAgent(agent.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible");
    }
  }

  async function buildSmartTeam() {
    setBusy(true);
    try {
      const label = deptLabel(department);
      const res = await suggest({ data: { department: label, focus: smartFocus.trim() } });
      const team = await createTeam(department, res.teamName);
      const base = agents.filter((a) => a.department === department).length;
      await Promise.all(
        res.members.map((m, i) =>
          createAgent({
            department,
            team_id: team.id,
            name: m.name,
            role: m.role,
            is_chief: m.is_chief,
            skills: m.skills,
            system_prompt: m.system_prompt,
            color: department,
            model: m.is_chief ? "openai/gpt-5.6-sol" : "openai/gpt-5.6-terra",
            pos_x: 80 + ((base + i) % 4) * 260,
            pos_y: 80 + Math.floor((base + i) / 4) * 230,
          }),
        ),
      );
      setTeamId(team.id);
      await refresh();
      toast.success(`Équipe « ${team.name} » composée par l'IA`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suggestion impossible");
    } finally {
      setBusy(false);
    }
  }

  async function addDepartment() {
    const label = newDept.trim();
    if (!label) return;
    try {
      const dept = await createCustomDepartment(label);
      setNewDept("");
      refreshExtras();
      setDepartment(dept.key);
      setTeamId(null);
      toast.success(`Département « ${dept.label} » créé`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible");
    }
  }

  const activeAgent = agents.find((a) => a.id === selectedAgent) ?? null;
  const activeMissionTeam = teams.find((t) => t.id === missionTeam) ?? null;

  return (
    <div className="st-theme flex h-screen w-full overflow-hidden bg-background">
      <Toaster theme="dark" />
      <aside
        className={cn(
          "scroll-slim z-20 flex h-full shrink-0 flex-col overflow-y-auto border-r border-border st-panel transition-all",
          sidebar ? "w-[272px]" : "w-0",
        )}
      >
        {sidebar && (
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
              <p className="font-display text-base font-semibold">Smart Teams</p>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Se déconnecter"
                onClick={async () => {
                  await supabase.auth.signOut();
                  queryClient.clear();
                  await navigate({ to: "/auth" });
                }}
              >
                <LogOut className="size-4" />
              </Button>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Départements
              </p>
              {allDepartments.map((d) => {
                const count = agents.filter((a) => a.department === d.key).length;
                const isCustom = d.key.startsWith("custom_");
                return (
                  <div key={d.key} className="flex items-center gap-1">
                    <Button variant="ghost"
                      onClick={() => {
                        setDepartment(d.key);
                        setTeamId(null);
                        setSelectedAgent(null);
                        setMissionTeam(null);
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        department === d.key
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:bg-secondary/60",
                      )}
                    >
                      <span className="truncate font-medium">{d.label}</span>
                      <span className="text-xs tabular-nums opacity-70">{count}</span>
                    </Button>
                    {isCustom && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Supprimer le département"
                        onClick={async () => {
                          const custom = customDepts.find((c) => c.key === d.key);
                          if (!custom) return;
                          await deleteCustomDepartment(custom.id);
                          if (department === d.key) setDepartment("marketing");
                          refreshExtras();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
              <div className="flex gap-1.5 pt-1">
                <Input
                  value={newDept}
                  placeholder="Nouveau département"
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addDepartment()}
                />
                <Button size="icon" variant="secondary" aria-label="Créer le département" onClick={addDepartment}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Équipes
              </p>
              <Button variant="ghost"
                onClick={() => setTeamId(null)}
                className={cn(
                  "w-full rounded-lg px-2.5 py-1.5 text-left text-sm",
                  teamId === null ? "bg-secondary" : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                Tout le département
              </Button>
              {departmentTeams.map((t) => (
                <div key={t.id} className="flex items-center gap-1">
                  <Button variant="ghost"
                    onClick={() => setTeamId(t.id)}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-sm",
                      teamId === t.id ? "bg-secondary" : "text-muted-foreground hover:bg-secondary/60",
                    )}
                  >
                    {t.name}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Confier une mission"
                    onClick={() => {
                      setMissionTeam(t.id);
                      setSelectedAgent(null);
                    }}
                  >
                    <Target className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Supprimer l'équipe"
                    onClick={async () => {
                      await deleteTeam(t.id);
                      if (teamId === t.id) setTeamId(null);
                      if (missionTeam === t.id) setMissionTeam(null);
                      await refresh();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              <div className="flex gap-1.5 pt-1">
                <Input
                  value={newTeam}
                  placeholder="Nom de l'équipe"
                  onChange={(e) => setNewTeam(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addTeam()}
                />
                <Button size="icon" variant="secondary" aria-label="Créer l'équipe" onClick={addTeam}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>

            <div className="mt-auto space-y-2">
              <Button
                variant={odooState.connected ? "secondary" : "outline"}
                className="w-full"
                onClick={() => {
                  setOdooOpen(true);
                  setSelectedAgent(null);
                  setMissionTeam(null);
                }}
              >
                <PlugZap className="size-4" />
                {odooState.connected ? `Odoo · ${odooState.database}` : "Connecter Odoo"}
              </Button>
              <Button className="w-full" onClick={addAgent}>
                <UserPlus className="size-4" /> Ajouter un agent
              </Button>
              <Input
                value={smartFocus}
                placeholder="Consigne pour l'équipe (optionnel)"
                onChange={(e) => setSmartFocus(e.target.value)}
              />
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={buildSmartTeam}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Équipe clé en main
              </Button>
            </div>
          </div>
        )}
      </aside>

      <div className="relative min-w-0 flex-1">
        <Button variant="ghost"
          onClick={() => setSidebar((s) => !s)}
          aria-label={sidebar ? "Masquer le panneau" : "Afficher le panneau"}
          className="absolute left-3 top-3 z-20 rounded-full border border-border st-panel p-2 hover:bg-secondary"
        >
          {sidebar ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>

        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-border st-panel px-3 py-1.5 text-xs font-semibold">
          {deptLabel(department)} ·{" "}
          {teamId ? departmentTeams.find((t) => t.id === teamId)?.name : "vue globale"} ·{" "}
          {visibleAgents.length} agent(s)
        </div>

        <BoardCanvas
          view={view}
          onViewChange={setView}
          onBackgroundClick={() => {
            setSelectedAgent(null);
            setMissionTeam(null);
            setOdooOpen(false);
          }}
          onRecenter={() => setView({ x: 120, y: 100, scale: 1 })}
        >
          {visibleAgents.map((agent) => (
            <AgentNote
              key={agent.id}
              agent={agent}
              teamName={teams.find((t) => t.id === agent.team_id)?.name}
              tasks={(data?.tasks ?? []).filter((t) => t.agent_id === agent.id)}
              selected={selectedAgent === agent.id}
              onPointerDownDrag={onPointerDownDrag}
              onOpen={(a) => {
                setMissionTeam(null);
                setOdooOpen(false);
                setSelectedAgent(a.id);
              }}
            />
          ))}
        </BoardCanvas>

        {!isLoading && visibleAgents.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="max-w-xs text-center text-sm text-muted-foreground">
              Aucun agent ici. Ajoutez un agent ou laissez l'IA composer une équipe clé en main.
            </p>
          </div>
        )}

        {activeAgent && (
          <AgentPanel
            agent={activeAgent}
            teams={teams}
            onClose={() => setSelectedAgent(null)}
            onSaved={() => void refresh()}
          />
        )}

        {odooOpen && !activeAgent && !activeMissionTeam && (
          <OdooPanel
            odoo={odooState}
            customDepartments={customDepts}
            onClose={() => setOdooOpen(false)}
            onChanged={refreshExtras}
          />
        )}

        {activeMissionTeam && !activeAgent && (
          <MissionPanel
            team={activeMissionTeam}
            agents={agents.filter((a) => a.team_id === activeMissionTeam.id)}
            missions={data?.missions ?? []}
            tasks={data?.tasks ?? []}
            onClose={() => setMissionTeam(null)}
            onChanged={() => void refresh()}
          />
        )}
      </div>
    </div>
  );
}
