import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Team = {
  id: string;
  user_id: string;
  department: string;
  name: string;
  mission: string | null;
  created_at: string;
};

export type Agent = {
  id: string;
  user_id: string;
  team_id: string | null;
  department: string;
  name: string;
  role: string;
  is_chief: boolean;
  model: string;
  system_prompt: string;
  temperature: number;
  skills: string;
  tone: string;
  color: string;
  pos_x: number;
  pos_y: number;
  status: string;
};

export type Mission = {
  id: string;
  team_id: string;
  objective: string;
  status: string;
  summary: string | null;
  created_at: string;
};

export type Task = {
  id: string;
  team_id: string;
  mission_id: string | null;
  agent_id: string | null;
  title: string;
  brief: string;
  status: string;
  result: string | null;
  created_at: string;
};

export type BoardData = {
  teams: Team[];
  agents: Agent[];
  missions: Mission[];
  tasks: Task[];
};

export const BOARD_KEY = ["smart-teams-board"] as const;

export async function fetchBoard(): Promise<BoardData> {
  const [teams, agents, missions, tasks] = await Promise.all([
    supabase.from("st_teams").select("*").order("created_at"),
    supabase.from("st_agents").select("*").order("created_at"),
    supabase.from("st_missions").select("*").order("created_at", { ascending: false }),
    supabase.from("st_tasks").select("*").order("created_at"),
  ]);
  const err = teams.error || agents.error || missions.error || tasks.error;
  if (err) throw new Error(err.message);
  return {
    teams: (teams.data ?? []) as Team[],
    agents: (agents.data ?? []) as Agent[],
    missions: (missions.data ?? []) as Mission[],
    tasks: (tasks.data ?? []) as Task[],
  };
}

export function useBoard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: BOARD_KEY, queryFn: fetchBoard });

  useEffect(() => {
    const channel = supabase
      .channel("board-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "st_agents" }, () =>
        queryClient.invalidateQueries({ queryKey: BOARD_KEY }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "st_teams" }, () =>
        queryClient.invalidateQueries({ queryKey: BOARD_KEY }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "st_tasks" }, () =>
        queryClient.invalidateQueries({ queryKey: BOARD_KEY }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "st_missions" }, () =>
        queryClient.invalidateQueries({ queryKey: BOARD_KEY }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}

export async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Session expirée.");
  return data.user.id;
}

export async function createTeam(department: string, name: string, mission = "") {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from("st_teams")
    .insert({ user_id, department, name, mission })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Team;
}

export async function updateTeam(id: string, patch: Partial<Team>) {
  const { error } = await supabase.from("st_teams").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTeam(id: string) {
  const { error } = await supabase.from("st_teams").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createAgent(input: Partial<Agent> & { department: string; name: string }) {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from("st_agents")
    .insert({ ...input, user_id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Agent;
}

export async function updateAgent(id: string, patch: Partial<Agent>) {
  const { error } = await supabase.from("st_agents").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteAgent(id: string) {
  const { error } = await supabase.from("st_agents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTask(id: string) {
  const { error } = await supabase.from("st_tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type CustomDepartment = {
  id: string;
  key: string;
  label: string;
  blurb: string;
  default_team: string;
};

export type OdooState = {
  connected: boolean;
  url: string;
  database: string;
  username: string;
  modulesByDept: Record<string, string[]>;
};

export async function fetchCustomDepartments(): Promise<CustomDepartment[]> {
  const { data, error } = await supabase
    .from("st_custom_departments")
    .select("id, key, label, blurb, default_team")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomDepartment[];
}

export async function createCustomDepartment(label: string): Promise<CustomDepartment> {
  const user_id = await currentUserId();
  const key = `custom_${label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)}_${Date.now().toString(36)}`;
  const { data, error } = await supabase
    .from("st_custom_departments")
    .insert({ user_id, key, label, default_team: `Équipe ${label}` })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CustomDepartment;
}

export async function deleteCustomDepartment(id: string) {
  const { error } = await supabase.from("st_custom_departments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchOdooState(): Promise<OdooState> {
  const [conn, mods] = await Promise.all([
    supabase
      .from("odoo_connections")
      .select("url, database:db, username, status")
      .maybeSingle(),
    supabase.from("st_department_modules").select("department, modules"),
  ]);
  if (conn.error) throw new Error(conn.error.message);
  if (mods.error) throw new Error(mods.error.message);
  const modulesByDept: Record<string, string[]> = {};
  for (const row of mods.data ?? []) modulesByDept[row.department] = row.modules ?? [];
  return {
    connected: Boolean(conn.data?.url && conn.data?.database),
    url: conn.data?.url ?? "",
    database: conn.data?.database ?? "",
    username: conn.data?.username ?? "",
    modulesByDept,
  };
}
