import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Database, LoaderCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { saveOdoo } from '@/lib/assistant.functions';
import { Button } from '@/components/ui/button';

export function OdooConnectionPanel() {
  const save = useServerFn(saveOdoo);
  const [fields, setFields] = useState({ url: '', db: '', username: '', api_key: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  useEffect(() => { void supabase.from('odoo_connections').select('url, db, username').maybeSingle().then(({ data }) => { if (data) { setFields(value => ({ ...value, ...data })); setConnected(true); } }); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await save({ data: fields }); setConnected(true); setFields(value => ({ ...value, api_key: '' })); setMessage('Connexion Odoo enregistrée.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Connexion impossible.'); }
    finally { setBusy(false); }
  }
  return <section className="odoo-settings"><h2><Database size={18}/>Connexion Odoo</h2><p>{connected ? 'Odoo connecté' : 'Connecter votre Odoo'}</p><form onSubmit={submit}>
    {([{ key: 'url', label: 'Adresse Odoo', placeholder: 'https://votre-societe.odoo.com', type: 'url' }, { key: 'db', label: 'Base de données', placeholder: 'Nom de la base', type: 'text' }, { key: 'username', label: 'Identifiant', placeholder: 'E-mail', type: 'text' }, { key: 'api_key', label: 'Clé API Odoo', placeholder: 'Clé API', type: 'password' }] as const).map(field => <label key={field.key}>{field.label}<input required type={field.type} autoComplete={field.key === 'api_key' ? 'new-password' : 'off'} placeholder={field.placeholder} value={fields[field.key]} onChange={event => setFields(value => ({ ...value, [field.key]: event.target.value }))}/></label>)}
    <p>Odoo → Préférences → Sécurité du compte → Nouvelle clé API.</p>
    {message && <p role="status">{message}</p>}<Button disabled={busy} type="submit">{busy && <LoaderCircle className="animate-spin"/>}{busy ? 'Vérification…' : connected ? 'Mettre à jour la connexion' : 'Connecter'}</Button>
  </form></section>;
}