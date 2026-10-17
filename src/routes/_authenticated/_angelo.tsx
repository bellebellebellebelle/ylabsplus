import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Bot, FileWarning, Gauge, History, LogOut, Menu, Plug, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_angelo")({
  component: AngeloLayout,
});

const NAV = [
  { to: "/tableau-de-bord", label: "Tableau de bord", icon: Gauge },
  { to: "/factures", label: "Factures impayées", icon: FileWarning },
  { to: "/parametres", label: "Paramètres ANGELO", icon: Settings2 },
  { to: "/connexion-odoo", label: "Connexion Odoo", icon: Plug },
  { to: "/journal", label: "Journal", icon: History },
] as const;

function AngeloLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="angelo min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <header className="flex items-center justify-between border-b bg-sidebar px-4 py-3 text-sidebar-foreground lg:hidden">
        <span className="flex items-center gap-2 font-semibold">
          <Bot className="size-5 text-sidebar-primary" /> ANGELO
        </span>
        <button onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>

      <aside className={cn("bg-sidebar text-sidebar-foreground lg:flex lg:min-h-screen lg:flex-col", open ? "block" : "hidden lg:block")}>
        <div className="hidden items-center gap-3 px-6 py-6 lg:flex">
          <span className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Bot className="size-5" />
          </span>
          <div>
            <p className="font-semibold tracking-tight">ANGELO</p>
            <p className="text-xs text-sidebar-foreground/60">Recouvrement Odoo</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1 px-3 pb-4 lg:flex-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
          <Link
            to="/dashboard"
            className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <ArrowLeft className="size-4" /> Retour au laboratoire
          </Link>
        </nav>

        <div className="border-t border-sidebar-border px-4 py-4">
          <p className="truncate text-xs text-sidebar-foreground/60">{user.email}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut className="size-4" /> Se déconnecter
          </Button>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-10">
        <Outlet />
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
