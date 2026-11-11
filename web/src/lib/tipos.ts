import type { EstadoNumero, EstadoReserva } from './estados';

export interface Rifa {
  id: string;
  codigo: string;
  nombre: string;
  colegio: string;
  centro_padres: string;
  descripcion: string | null;
  objetivo: string | null;
  afiche_path: string | null;
  precio_numero: number;
  numero_inicial: number;
  numero_final: number;
  fecha_sorteo: string | null;
  cierre_ventas_at: string | null;
  bases: string | null;
  info_pago: string | null;
  contacto: string | null;
  minutos_reserva: number;
  max_numeros_reserva: number;
  max_reservas_activas_telefono: number;
  pedir_rut: boolean;
  estado: 'borrador' | 'activa' | 'pausada' | 'cerrada' | 'sorteada';
  venta_iniciada: boolean;
  ventas_cerradas_at: string | null;
  created_at: string;
}

export interface Premio {
  id: string;
  rifa_id: string;
  posicion: number;
  nombre: string;
  descripcion: string | null;
  foto_path: string | null;
}

export interface Numero {
  id: number;
  numero: number;
  estado: EstadoNumero;
}

export interface ResultadoReserva {
  codigo: string;
  numeros: number[];
  cantidad: number;
  precio_unitario: number;
  monto_total: number;
  expira_at: string;
  minutos_reserva: number;
  info_pago: string;
  rifa: string;
}

export interface ConsultaReserva {
  codigo: string;
  estado: EstadoReserva;
  rifa_id: string;
  rifa: string;
  fecha_sorteo: string | null;
  nombre: string;
  numeros: number[];
  monto_total: number;
  expira_at: string | null;
  motivo: string | null;
  info_pago: string | null;
  puede_subir_comprobante: boolean;
  comprobantes: { fecha: string; estado: string; motivo: string | null }[];
  creada_at: string;
}

export interface ReservaAdmin {
  id: string;
  codigo: string;
  estado: EstadoReserva;
  cantidad: number;
  monto_total: number;
  expira_at: string | null;
  motivo: string | null;
  created_at: string;
  updated_at: string;
  rifa_id: string;
  rifa_codigo: string;
  rifa_nombre: string;
  comprador_id: string;
  comprador_nombre: string;
  curso: string;
  telefono: string | null;
  email: string | null;
  rut: string | null;
  numeros: number[];
  ultimo_comprobante_id: string | null;
  ultimo_comprobante_at: string | null;
}

export interface SorteoPublico {
  rifa: Pick<Rifa, 'id' | 'codigo' | 'nombre' | 'colegio' | 'centro_padres' | 'fecha_sorteo' | 'estado' | 'afiche_path'>;
  premios: { posicion: number; nombre: string; descripcion: string | null; foto_path: string | null }[];
  sorteo: null | {
    id: string;
    estado: 'padron_congelado' | 'ejecutado';
    algoritmo: string;
    version: string;
    cantidad_ganadores: number;
    permitir_repetidos: boolean;
    total_participantes: number;
    padron_hash: string;
    semilla_compromiso: string;
    padron_congelado_at: string;
    semilla: string | null;
    entropia_externa: string | null;
    hash_base: string | null;
    ejecutado_at: string | null;
    participantes: number[];
    ganadores: { posicion: number; numero: number; intento: number; premio: string | null }[] | null;
  };
}
