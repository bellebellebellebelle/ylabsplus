import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { wsContacts, wsContactDetail } from "@/lib/workspace.functions";
import { useState } from "react";
import { Users, Search, X, Mail, Phone, MapPin, Briefcase, Cake, Globe, User as UserIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ocktavus/contacts")({ component: ContactsPage });

function ContactsPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useServerFn(wsContacts);
  const detailFn = useServerFn(wsContactDetail);
  const data = useQuery({ queryKey: ["contacts", q], queryFn: () => list({ data: { ...(q ? { query: q } : {}) } }) });
  const detail = useQuery({
    queryKey: ["contact-detail", selected],
    queryFn: () => detailFn({ data: { resourceName: selected! } }),
    enabled: !!selected,
  });
  const people = q
    ? ((data.data as any)?.results ?? []).map((r: any) => r.person)
    : ((data.data as any)?.connections ?? []);

  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="mb-4 flex items-center gap-3"><Users className="h-5 w-5 text-primary" /><h1 className="font-display text-2xl">Contacts</h1></header>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un contact…" className="w-full bg-transparent text-sm outline-none" />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {(people ?? []).filter(Boolean).map((p: any, i: number) => {
          const name = p.names?.[0]?.displayName ?? "(sans nom)";
          const email = p.emailAddresses?.[0]?.value;
          const phone = p.phoneNumbers?.[0]?.value;
          const photo = p.photos?.[0]?.url;
          return (
            <button
              key={p.resourceName ?? i}
              onClick={() => setSelected(p.resourceName)}
              className="bento flex items-center gap-3 p-3 text-left transition hover:holo-glow"
            >
              {photo ? <img src={photo} className="h-10 w-10 rounded-full" alt="" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-sm">{name[0]}</div>}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{name}</p>
                {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
                {phone && <p className="truncate text-xs text-muted-foreground">{phone}</p>}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div className="bento w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="font-display text-lg">Profil contact</h2>
              <button onClick={() => setSelected(null)} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/5"><X className="h-4 w-4" /></button>
            </div>
            {detail.isLoading || !detail.data ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <ContactDetail person={detail.data as any} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ContactDetail({ person }: { person: any }) {
  const name = person.names?.[0]?.displayName ?? "(sans nom)";
  const photo = person.photos?.[0]?.url;
  const bio = person.biographies?.[0]?.value;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {photo ? <img src={photo} className="h-16 w-16 rounded-full" alt="" /> : <div className="grid h-16 w-16 place-items-center rounded-full bg-white/10"><UserIcon className="h-6 w-6" /></div>}
        <div>
          <p className="font-display text-lg">{name}</p>
          {person.nicknames?.[0]?.value && <p className="text-xs text-muted-foreground">« {person.nicknames[0].value} »</p>}
        </div>
      </div>
      {bio && <p className="text-sm text-muted-foreground">{bio}</p>}
      <Section icon={Mail} title="E-mails" items={(person.emailAddresses ?? []).map((e: any) => `${e.value}${e.type ? ` · ${e.type}` : ""}`)} />
      <Section icon={Phone} title="Téléphones" items={(person.phoneNumbers ?? []).map((e: any) => `${e.value}${e.type ? ` · ${e.type}` : ""}`)} />
      <Section icon={Briefcase} title="Organisations" items={(person.organizations ?? []).map((o: any) => [o.name, o.title].filter(Boolean).join(" — "))} />
      <Section icon={MapPin} title="Adresses" items={(person.addresses ?? []).map((a: any) => a.formattedValue ?? [a.streetAddress, a.city, a.country].filter(Boolean).join(", "))} />
      <Section icon={Cake} title="Anniversaire" items={(person.birthdays ?? []).map((b: any) => b.text ?? `${b.date?.day ?? ""}/${b.date?.month ?? ""}/${b.date?.year ?? ""}`)} />
      <Section icon={Globe} title="Liens" items={(person.urls ?? []).map((u: any) => u.value)} />
    </div>
  );
}

function Section({ icon: Icon, title, items }: { icon: any; title: string; items: string[] }) {
  const cleaned = (items ?? []).filter((v) => v && v.trim());
  if (!cleaned.length) return null;
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {title}</p>
      <ul className="space-y-0.5 text-sm">
        {cleaned.map((v, i) => <li key={i} className="text-foreground/90">{v}</li>)}
      </ul>
    </div>
  );
}
