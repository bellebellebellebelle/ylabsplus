import { createFileRoute } from '@tanstack/react-router';
import { Laboratory } from '@/components/lab/Laboratory';
import { labQuery } from '@/lib/laboratory';
export const Route=createFileRoute('/_authenticated/settings')({
 validateSearch:(s:Record<string,unknown>)=>({tab:s['tab']==='google'?'google' as const:s['tab']==='odoo'?'odoo' as const:undefined}),
 loader:({context})=>context.queryClient.ensureQueryData(labQuery),
 head:()=>({meta:[{title:'IDEALAB — Paramètres'},{name:'description',content:'Paramètres dans votre laboratoire personnel IDEALAB.'},{property:'og:title',content:'IDEALAB — Paramètres'},{property:'og:description',content:'Votre espace personnel d’idées, d’applications et d’activités.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),
 component:Page,
});
function Page(){const {user}=Route.useRouteContext();const {tab}=Route.useSearch();return <Laboratory user={user} view="settings" settingsTab={tab??'compte'}/>;}
