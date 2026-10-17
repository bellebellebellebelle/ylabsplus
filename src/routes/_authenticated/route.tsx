import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router';
import { VoiceOrb } from '@/components/VoiceOrb';
import { supabase } from '@/integrations/supabase/client';
// getSession reads the locally cached session (no network round-trip on every navigation); RLS still verifies the token server-side.
export const Route=createFileRoute('/_authenticated')({ssr:false,beforeLoad:async()=>{const {data}=await supabase.auth.getSession();const user=data.session?.user;if(!user)throw redirect({to:'/auth'});return {user};},component:Layout});
const MM=['/cockpit','/automations','/optimizer','/kpi','/costs','/executions','/ticks','/tools','/helpy','/connections','/preferences'];
function Layout(){const {pathname}=useLocation();if(pathname.startsWith('/ocktavus')||MM.some(p=>pathname===p||pathname.startsWith(p+'/')))return <><Outlet/><VoiceOrb/></>;return <div className="lab-theme min-h-screen"><Outlet/><VoiceOrb/></div>;}
