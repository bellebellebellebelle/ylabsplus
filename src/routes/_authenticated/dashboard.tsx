import { createFileRoute } from '@tanstack/react-router';
import { Laboratory } from '@/components/lab/Laboratory';
import { labQuery } from '@/lib/laboratory';
export const Route=createFileRoute('/_authenticated/dashboard')({
 loader:({context})=>context.queryClient.ensureQueryData(labQuery),
 head:()=>({meta:[{title:'IDEALAB — Accueil'},{name:'description',content:'Accueil dans votre laboratoire personnel IDEALAB.'},{property:'og:title',content:'IDEALAB — Accueil'},{property:'og:description',content:'Votre espace personnel d’idées, d’applications et d’activités.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),
 component:Page,
});
function Page(){const {user}=Route.useRouteContext();return <Laboratory user={user} view="dashboard"/>;}
