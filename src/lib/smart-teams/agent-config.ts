export type DepartmentKey =
  | "marketing"
  | "finance"
  | "vente"
  | "achat"
  | "rh"
  | "admin"
  | "autre";

export type Department = {
  key: DepartmentKey;
  label: string;
  blurb: string;
  defaultTeam: string;
};

export const DEPARTMENTS: Department[] = [
  {
    key: "marketing",
    label: "Marketing",
    blurb: "Contenus, campagnes, marque, acquisition",
    defaultTeam: "Studio Marketing",
  },
  {
    key: "finance",
    label: "Finance",
    blurb: "Trésorerie, budgets, analyses, reporting",
    defaultTeam: "Cellule Finance",
  },
  {
    key: "vente",
    label: "Vente",
    blurb: "Prospection, closing, comptes clés",
    defaultTeam: "Force de Vente",
  },
  {
    key: "achat",
    label: "Achat",
    blurb: "Fournisseurs, négociation, sourcing",
    defaultTeam: "Pôle Achat",
  },
  {
    key: "rh",
    label: "RH",
    blurb: "Recrutement, onboarding, culture",
    defaultTeam: "Équipe RH",
  },
  {
    key: "admin",
    label: "Administratif",
    blurb: "Juridique, process, documents, conformité",
    defaultTeam: "Back-office",
  },
  {
    key: "autre",
    label: "Autres",
    blurb: "Produit, technique, R&D, projets spéciaux",
    defaultTeam: "Cellule Projet",
  },
];

export const DEPARTMENT_MAP: Record<string, Department> = Object.fromEntries(
  DEPARTMENTS.map((d) => [d.key, d]),
) as Record<string, Department>;

/** Classes Tailwind statiques (scannables) pour la couleur des post-it. */
export const NOTE_BG: Record<string, string> = {
  marketing: "bg-note-marketing",
  finance: "bg-note-finance",
  vente: "bg-note-vente",
  achat: "bg-note-achat",
  rh: "bg-note-rh",
  admin: "bg-note-admin",
  autre: "bg-note-autre",
};

export const NOTE_TEXT: Record<string, string> = {
  marketing: "text-note-marketing",
  finance: "text-note-finance",
  vente: "text-note-vente",
  achat: "text-note-achat",
  rh: "text-note-rh",
  admin: "text-note-admin",
  autre: "text-note-autre",
};

export type ModelOption = { id: string; label: string; hint: string };

export const MODELS: ModelOption[] = [
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    hint: "Raisonnement maximal — dossiers complexes, stratégie",
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    hint: "Équilibré — le meilleur choix par défaut",
  },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    hint: "Rapide et économique — tâches à volume",
  },
  {
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    hint: "Analyse et rédaction de très haut niveau",
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    hint: "Bon rapport qualité / coût",
  },
  {
    id: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    hint: "Très rapide, gros volumes de contexte",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    hint: "Raisonnement long et documents massifs",
  },
];

export const ROLE_SUGGESTIONS: Record<string, string[]> = {
  marketing: ["Chef de studio", "Copywriter", "Growth / acquisition", "Community manager"],
  finance: ["Directeur financier", "Contrôleur de gestion", "Analyste", "Comptable"],
  vente: ["Directeur commercial", "SDR / prospection", "Closer", "Account manager"],
  achat: ["Responsable achats", "Acheteur", "Sourcing", "Négociateur"],
  rh: ["DRH", "Recruteur", "Chargé onboarding", "Formation"],
  admin: ["Responsable administratif", "Juriste", "Assistant de direction", "Conformité"],
  autre: ["Chef de projet", "Analyste", "Rédacteur technique", "Veille"],
};

export type OdooModule = { key: string; label: string; blurb: string };

export const ODOO_MODULES: OdooModule[] = [
  { key: "ventes", label: "Ventes", blurb: "Devis, commandes, chiffre d'affaires" },
  { key: "achats", label: "Achats", blurb: "Commandes fournisseurs, sourcing" },
  { key: "crm", label: "CRM", blurb: "Prospects, opportunités, pipeline" },
  { key: "facturation", label: "Facturation", blurb: "Factures, paiements, échéances" },
  { key: "marketing", label: "Marketing", blurb: "Campagnes e-mail, automation" },
  { key: "agenda", label: "Agenda", blurb: "Réunions, événements, planning" },
  { key: "connaissance", label: "Connaissance", blurb: "Base de connaissances interne" },
  { key: "employes", label: "Employés", blurb: "Effectifs, postes, organigramme" },
  { key: "projets", label: "Projets", blurb: "Tâches, jalons, deadlines" },
  { key: "stock", label: "Stock", blurb: "Inventaire, niveaux de stock" },
];

/** Modules Odoo suggérés par défaut pour chaque département. */
export const DEPARTMENT_MODULE_DEFAULTS: Record<string, string[]> = {
  marketing: ["marketing", "crm", "connaissance"],
  finance: ["facturation", "achats", "ventes"],
  vente: ["ventes", "crm", "agenda"],
  achat: ["achats", "stock"],
  rh: ["employes", "agenda"],
  admin: ["agenda", "connaissance", "facturation"],
  autre: ["projets", "connaissance"],
};

export const AGENT_STATUS_LABEL: Record<string, string> = {
  idle: "Disponible",
  working: "En cours",
  done: "Livré",
  error: "Erreur",
};
