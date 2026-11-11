import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

interface EstadoAuth {
  cargando: boolean;
  sesion: Session | null;
  nombre: string;
  rol: string | null;
  permisos: Set<string>;
  mfaObligatorio: boolean;
  aal: 'aal1' | 'aal2' | null;
  necesitaMfa: boolean;
  tiene: (p: string) => boolean;
  recargar: () => Promise<void>;
  salir: () => Promise<void>;
}

const Ctx = createContext<EstadoAuth | null>(null);

export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);
  const [datos, setDatos] = useState<{ uid: string | null; nombre: string; rol: string | null; permisos: Set<string>; mfa: boolean; aal: 'aal1' | 'aal2' | null }>({
    uid: null, nombre: '', rol: null, permisos: new Set(), mfa: false, aal: null,
  });

  const cargarPermisos = useCallback(async (s: Session | null) => {
    if (!s) {
      setDatos({ uid: null, nombre: '', rol: null, permisos: new Set(), mfa: false, aal: null });
      return;
    }
    const [{ data }, aal] = await Promise.all([
      supabase.rpc('mis_permisos'),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    const filas = (data ?? []) as { permiso: string; rol: string; nombre: string; mfa_obligatorio: boolean }[];
    setDatos({
      uid: s.user.id,
      nombre: filas[0]?.nombre ?? s.user.email ?? '',
      rol: filas[0]?.rol ?? null,
      permisos: new Set(filas.map((f) => f.permiso)),
      mfa: filas[0]?.mfa_obligatorio ?? false,
      aal: (aal.data?.currentLevel as 'aal1' | 'aal2' | null) ?? null,
    });
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      setSesion(data.session);
      await cargarPermisos(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSesion(s);
      // diferido para no bloquear el callback de auth
      setTimeout(() => void cargarPermisos(s), 0);
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [cargarPermisos]);

  const valor = useMemo<EstadoAuth>(() => {
    const necesitaMfa = !!sesion && datos.mfa && datos.aal !== 'aal2';
    // Mientras los permisos de la sesión actual no se han cargado, se considera "cargando"
    const permisosPendientes = !!sesion && datos.uid !== sesion.user.id;
    return {
      cargando: cargando || permisosPendientes,
      sesion,
      nombre: datos.nombre,
      rol: datos.rol,
      permisos: datos.permisos,
      mfaObligatorio: datos.mfa,
      aal: datos.aal,
      necesitaMfa,
      tiene: (p: string) => !necesitaMfa && datos.permisos.has(p),
      recargar: () => cargarPermisos(sesion),
      salir: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [cargando, sesion, datos, cargarPermisos]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): EstadoAuth {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de ProveedorAuth');
  return c;
}
