import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between py-5">
      <Link to="/memotrack" className="font-display text-lg font-semibold">
        Memo<span className="holo-text">Track</span> <span className="text-muted-foreground">Studio</span>
      </Link>
      <div className="flex items-center gap-2"><Link to="/dashboard" className="glass rounded-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground">← Laboratoire</Link><button onClick={() => supabase.auth.signOut()} className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
        <LogOut className="size-3.5" /> Déconnexion
      </button></div>
    </header>
  );
}
