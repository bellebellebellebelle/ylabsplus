import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { analyzeImage, wallpaperVeil } from '@/lib/wallpaper';

function useWallpaper(userId: string) {
  return useQuery({
    queryKey: ['lab-wallpaper', userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('ui_preferences').select('background_url, background_opacity').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function LabWallpaper({ userId }: { userId: string }) {
  const { data } = useWallpaper(userId);
  if (!data?.background_url) return null;
  return <div className="lab-wallpaper" aria-hidden="true">
    <img src={data.background_url} alt="" />
    <div className="lab-wallpaper-veil" style={{ opacity: Math.max(0.45, data.background_opacity ?? 0.65) }} />
  </div>;
}

export function WallpaperSettings({ userId }: { userId: string }) {
  const { data } = useWallpaper(userId);
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(file: File) {
    setBusy(true); setError('');
    let localUrl: string | undefined;
    try {
      if (!file.type.startsWith('image/')) throw new Error('Veuillez sélectionner une image.');
      localUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = localUrl;
      await image.decode();
      const { luminance, contrast } = analyzeImage(image);
      const opacity = wallpaperVeil(luminance, contrast);
      const path = `${userId}/${crypto.randomUUID()}`;
      const bucket = supabase.storage.from('backgrounds');
      const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: signed, error: signedError } = await bucket.createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedError || !signed?.signedUrl) {
        await bucket.remove([path]);
        throw signedError ?? new Error('Impossible de charger le fond d’écran.');
      }
      const { error: saveError } = await supabase.from('ui_preferences').upsert({ user_id: userId, background_url: signed.signedUrl, background_opacity: opacity, updated_at: new Date().toISOString() });
      if (saveError) { await bucket.remove([path]); throw saveError; }
      await queryClient.invalidateQueries({ queryKey: ['lab-wallpaper', userId] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible d’importer cette image.'); }
    finally {
      if (localUrl) URL.revokeObjectURL(localUrl);
      if (input.current) input.current.value = '';
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true); setError('');
    try {
      const { error } = await supabase.from('ui_preferences').upsert({ user_id: userId, background_url: null, updated_at: new Date().toISOString() });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['lab-wallpaper', userId] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de retirer le fond.'); }
    finally { setBusy(false); }
  }

  return <section className="lab-wallpaper-settings">
    <h3>Fond d’écran</h3>
    {data?.background_url && <div className="lab-wallpaper-preview"><img src={data.background_url} alt="Votre fond d’écran" /></div>}
    <input ref={input} type="file" accept="image/*" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}Importer un fond d’écran</Button>
      {data?.background_url && <Button variant="ghost" size="icon" disabled={busy} title="Retirer le fond d’écran" aria-label="Retirer le fond d’écran" onClick={() => void remove()}><Trash2 /></Button>}
    </div>
    {error && <p role="alert" className="auth-error">{error}</p>}
  </section>;
}