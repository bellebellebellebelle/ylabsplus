import { Check, LoaderCircle, Mail, Calendar, HardDrive, FileText, Sheet, Presentation, ClipboardList, Rss, CheckSquare, Users, MessageSquare, Unplug, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGoogleConnection } from "@/hooks/useGoogleConnection";

const services = [
  { icon: Mail, label: "Gmail" }, { icon: Calendar, label: "Agenda" }, { icon: HardDrive, label: "Drive" },
  { icon: FileText, label: "Docs" }, { icon: Sheet, label: "Sheets" }, { icon: Presentation, label: "Slides" },
  { icon: ClipboardList, label: "Forms" }, { icon: CheckSquare, label: "Tâches" }, { icon: Users, label: "Contacts" },
  { icon: Rss, label: "Blogger" }, { icon: MessageSquare, label: "Chat" },
];

/** Single place where the user links their Google account for every app. */
export function GoogleConnectionPanel() {
  const { connection, loading, busy, error, connect, disconnect } = useGoogleConnection();
  return (
    <div className="panel idea-card google-panel">
      <h3>Connexion Google</h3>
      <p>Une seule connexion pour toutes vos applications : OCKTAVUS, Aura et les futures apps l'utilisent automatiquement.</p>
      {loading ? (
        <p><LoaderCircle className="inline animate-spin" size={14} /> Chargement…</p>
      ) : connection ? (
        <p className="google-status ok"><Check size={14} /> Connecté : <strong>{connection.google_email ?? "compte Google"}</strong></p>
      ) : (
        <p className="google-status">Aucun compte Google connecté.</p>
      )}
      <div className="google-services">
        {services.map((s) => <span key={s.label}><s.icon size={12} />{s.label}</span>)}
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        {connection ? (
          <>
            <Button variant="secondary" onClick={connect} disabled={busy}><Link2 />Reconnecter</Button>
            <Button variant="outline" onClick={disconnect} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Unplug />}Déconnecter</Button>
          </>
        ) : (
          <Button className="voice-button" onClick={connect} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Link2 />}Connecter mon compte Google</Button>
        )}
      </div>
    </div>
  );
}
