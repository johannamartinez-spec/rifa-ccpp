import { useCallback, useEffect, useRef, useState } from 'react';
import type { EstadoNumero } from '../lib/estados';
import { supabase } from '../lib/supabase';

/**
 * Estado de los números de una rifa, actualizado en tiempo real (Supabase Realtime)
 * con respaldo de consulta periódica si el canal se cae.
 */
export function useNumeros(rifaId: string | undefined) {
  const [numeros, setNumeros] = useState<Map<number, EstadoNumero>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enVivo, setEnVivo] = useState(false);
  const idANumero = useRef<Map<number, number>>(new Map());

  const cargar = useCallback(async () => {
    if (!rifaId) return;
    try {
      const mapa = new Map<number, EstadoNumero>();
      const ids = new Map<number, number>();
      // PostgREST limita a 1000 filas por consulta: se pagina
      for (let desde = 0; ; desde += 1000) {
        const { data, error: e } = await supabase
          .from('numeros')
          .select('id, numero, estado')
          .eq('rifa_id', rifaId)
          .order('numero')
          .range(desde, desde + 999);
        if (e) throw e;
        for (const n of data ?? []) {
          mapa.set(n.numero, n.estado as EstadoNumero);
          ids.set(n.id, n.numero);
        }
        if (!data || data.length < 1000) break;
      }
      idANumero.current = ids;
      setNumeros(mapa);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [rifaId]);

  useEffect(() => {
    if (!rifaId) return;
    void cargar();
    const canal = supabase
      .channel(`numeros-${rifaId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'numeros', filter: `rifa_id=eq.${rifaId}` }, (p) => {
        const fila = p.new as { numero: number; estado: EstadoNumero };
        setNumeros((prev) => {
          const m = new Map(prev);
          m.set(fila.numero, fila.estado);
          return m;
        });
      })
      .subscribe((estado) => setEnVivo(estado === 'SUBSCRIBED'));

    const intervalo = window.setInterval(() => { if (!document.hidden) void cargar(); }, 45_000);
    const alVolver = () => { if (!document.hidden) void cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      void supabase.removeChannel(canal);
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [rifaId, cargar]);

  return { numeros, cargando, error, enVivo, recargar: cargar };
}

export function useCuentaRegresiva(hasta: string | null | undefined) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    if (!hasta) return;
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [hasta]);
  return hasta ? new Date(hasta).getTime() - ahora : null;
}
