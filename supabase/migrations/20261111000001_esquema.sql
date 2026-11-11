-- =====================================================================
-- RIFA ONLINE CCPP — 0001 Esquema base
-- Tablas, tipos, claves, índices y restricciones de integridad.
-- Ejecutar en orden. Compatible con Supabase (PostgreSQL 15+).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
create type public.estado_rifa as enum ('borrador','activa','pausada','cerrada','sorteada');

-- Estado visible de cada número (público, sin datos personales)
create type public.estado_numero as enum (
  'disponible',      -- libre
  'reservado',       -- reserva vigente, esperando comprobante (con plazo)
  'pendiente_pago',  -- comprobante enviado / en revisión por Tesorería
  'vendido',         -- pago aprobado
  'bloqueado'        -- bloqueado por administración
);

create type public.estado_reserva as enum (
  'reservado',            -- recién creada, plazo corriendo
  'pendiente_pago',       -- Tesorería pidió un nuevo comprobante (nuevo plazo)
  'comprobante_enviado',  -- comprador subió comprobante (plazo detenido)
  'en_revision',          -- Tesorería está revisando
  'pagado',               -- pago aprobado y confirmado
  'rechazado',            -- pago rechazado; números liberados
  'cancelado',            -- anulada por Tesorería
  'expirado'              -- venció el plazo sin comprobante
);

create type public.metodo_pago as enum ('transferencia','webpay','efectivo');
create type public.estado_pago as enum ('pendiente','aprobado','rechazado','revertido');
create type public.estado_revision as enum ('pendiente','aprobado','rechazado','reemplazado');
create type public.estado_sorteo as enum ('padron_congelado','ejecutado');
create type public.estado_cola as enum ('pendiente','enviado','error','omitido');

-- ---------------------------------------------------------------------
-- Roles, permisos y usuarios administrativos
-- (Los compradores NO tienen cuenta.)
-- ---------------------------------------------------------------------
create table public.roles (
  codigo       text primary key check (codigo ~ '^[a-z_]{3,30}$'),
  nombre       text not null,
  descripcion  text,
  es_sistema   boolean not null default true
);

create table public.permisos (
  codigo       text primary key check (codigo ~ '^[a-z_]+\.[a-z_]+$'),
  descripcion  text not null,
  solo_lectura boolean not null default false
);

create table public.rol_permisos (
  rol      text not null references public.roles(codigo) on delete cascade,
  permiso  text not null references public.permisos(codigo) on delete cascade,
  primary key (rol, permiso)
);

create table public.usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  nombre      text not null check (length(trim(nombre)) between 3 and 120),
  rol         text not null references public.roles(codigo),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.usuarios(id)
);

-- ---------------------------------------------------------------------
-- Configuración global (clave/valor). Nunca guardar secretos aquí.
-- ---------------------------------------------------------------------
create table public.configuraciones (
  clave       text primary key check (clave ~ '^[a-z_]+(\.[a-z_]+)*$'),
  valor       jsonb not null,
  publica     boolean not null default false,  -- visible para visitantes
  descripcion text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.usuarios(id)
);

-- ---------------------------------------------------------------------
-- Rifas y premios
-- ---------------------------------------------------------------------
create sequence public.rifa_correlativo_seq;

create table public.rifas (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text not null unique
                          default ('RIFA_' || lpad(nextval('public.rifa_correlativo_seq')::text, 3, '0')),
  nombre                text not null check (length(trim(nombre)) between 3 and 150),
  colegio               text not null check (length(trim(colegio)) between 2 and 150),
  centro_padres         text not null check (length(trim(centro_padres)) between 2 and 150),
  descripcion           text check (length(descripcion) <= 5000),
  objetivo              text check (length(objetivo) <= 2000),
  afiche_path           text,  -- bucket público rifas-publico
  precio_numero         integer not null check (precio_numero between 100 and 10000000), -- CLP
  numero_inicial        integer not null default 1 check (numero_inicial >= 0),
  numero_final          integer not null,
  fecha_sorteo          timestamptz,
  cierre_ventas_at      timestamptz,  -- opcional: cierre automático de ventas
  bases                 text check (length(bases) <= 30000),
  info_pago             text check (length(info_pago) <= 3000),  -- instrucciones de transferencia (sin claves)
  contacto              text check (length(contacto) <= 500),
  minutos_reserva       integer not null default 30 check (minutos_reserva between 5 and 4320),
  max_numeros_reserva   integer not null default 20 check (max_numeros_reserva between 1 and 200),
  max_reservas_activas_telefono integer not null default 3 check (max_reservas_activas_telefono between 1 and 50),
  pedir_rut             boolean not null default false,
  estado                public.estado_rifa not null default 'borrador',
  venta_iniciada        boolean not null default false,  -- se activa con la primera reserva
  ventas_cerradas_at    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.usuarios(id),
  constraint rifas_rango_ck check (numero_final >= numero_inicial),
  constraint rifas_tamano_ck check (numero_final - numero_inicial + 1 <= 10000)
);
create index rifas_estado_idx on public.rifas(estado);

create table public.premios (
  id           uuid primary key default gen_random_uuid(),
  rifa_id      uuid not null references public.rifas(id) on delete restrict,
  posicion     integer not null check (posicion between 1 and 100),
  nombre       text not null check (length(trim(nombre)) between 2 and 200),
  descripcion  text check (length(descripcion) <= 2000),
  foto_path    text,
  created_at   timestamptz not null default now(),
  unique (rifa_id, posicion)
);

-- ---------------------------------------------------------------------
-- Números (tabla pública: NO contiene datos personales ni reserva_id,
-- para que pueda transmitirse por Realtime sin filtrar información)
-- ---------------------------------------------------------------------
create table public.numeros (
  id          bigint generated always as identity primary key,
  rifa_id     uuid not null references public.rifas(id) on delete restrict,
  numero      integer not null check (numero >= 0),
  estado      public.estado_numero not null default 'disponible',
  updated_at  timestamptz not null default now(),
  unique (rifa_id, numero)
);
create index numeros_rifa_estado_idx on public.numeros(rifa_id, estado);

-- Motivo de bloqueo (privado)
create table public.bloqueos_numeros (
  numero_id    bigint primary key references public.numeros(id) on delete restrict,
  motivo       text not null check (length(trim(motivo)) between 3 and 300),
  bloqueado_por uuid not null references public.usuarios(id),
  bloqueado_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Compradores (sin cuenta)
-- ---------------------------------------------------------------------
create table public.compradores (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 3 and 120),
  rut         text check (rut ~ '^[0-9]{7,8}-[0-9K]$'),
  curso       text not null check (length(trim(curso)) between 1 and 40),
  telefono    text check (telefono ~ '^\+569[0-9]{8}$'),
  email       text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  anonimizado_at timestamptz,   -- derecho de supresión / política de conservación
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint compradores_tel_ck check (anonimizado_at is not null or telefono is not null)
);
create unique index compradores_tel_nombre_uk on public.compradores (telefono, lower(nombre));
create index compradores_curso_idx on public.compradores (lower(curso));
create index compradores_nombre_idx on public.compradores (lower(nombre));

-- ---------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------
create table public.reservas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique check (codigo ~ '^CCPP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  rifa_id         uuid not null references public.rifas(id) on delete restrict,
  comprador_id    uuid not null references public.compradores(id) on delete restrict,
  estado          public.estado_reserva not null default 'reservado',
  cantidad        integer not null check (cantidad > 0),
  precio_unitario integer not null check (precio_unitario > 0),
  monto_total     integer not null,
  expira_at       timestamptz,       -- null cuando el plazo no aplica
  motivo          text check (length(motivo) <= 500),  -- motivo de rechazo / cancelación
  origen_ip_hash  text,              -- hash de la IP (para limitar abuso, no IP en claro)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint reservas_monto_ck check (monto_total = cantidad * precio_unitario),
  constraint reservas_expira_ck check (
    (estado in ('reservado','pendiente_pago') and expira_at is not null)
    or (estado not in ('reservado','pendiente_pago'))
  )
);
create index reservas_rifa_estado_idx on public.reservas(rifa_id, estado);
create index reservas_comprador_idx on public.reservas(comprador_id);
create index reservas_expira_idx on public.reservas(expira_at) where estado in ('reservado','pendiente_pago');

create table public.detalle_reservas (
  id          bigint generated always as identity primary key,
  reserva_id  uuid not null references public.reservas(id) on delete restrict,
  numero_id   bigint not null references public.numeros(id) on delete restrict,
  rifa_id     uuid not null references public.rifas(id) on delete restrict,
  numero      integer not null,
  activo      boolean not null default true,  -- false al liberar (expirado/rechazado/cancelado)
  created_at  timestamptz not null default now(),
  unique (reserva_id, numero_id)
);
-- GARANTÍA CENTRAL: un número sólo puede pertenecer a UNA reserva activa.
create unique index detalle_numero_activo_uk on public.detalle_reservas(numero_id) where activo;
create index detalle_reserva_idx on public.detalle_reservas(reserva_id);

-- Historial de cambios de estado de reservas
create table public.historial_reservas (
  id             bigint generated always as identity primary key,
  reserva_id     uuid not null references public.reservas(id) on delete restrict,
  estado_anterior public.estado_reserva,
  estado_nuevo   public.estado_reserva not null,
  usuario_id     uuid references public.usuarios(id),
  actor          text not null,  -- 'publico' | 'sistema' | 'admin' | 'pasarela'
  detalle        text,
  created_at     timestamptz not null default now()
);
create index historial_reserva_idx on public.historial_reservas(reserva_id, created_at);

-- ---------------------------------------------------------------------
-- Pagos y comprobantes
-- ---------------------------------------------------------------------
create table public.pagos (
  id                 uuid primary key default gen_random_uuid(),
  reserva_id         uuid not null references public.reservas(id) on delete restrict,
  metodo             public.metodo_pago not null,
  monto              integer not null check (monto > 0),
  estado             public.estado_pago not null default 'pendiente',
  comprobante_id     uuid,  -- FK agregada abajo
  referencia_externa text check (length(referencia_externa) <= 200),  -- token Webpay / nº operación
  validado_por       uuid references public.usuarios(id),
  validado_at        timestamptz,
  motivo             text check (length(motivo) <= 500),
  observacion        text check (length(observacion) <= 1000),
  revertido_por      uuid references public.usuarios(id),
  revertido_at       timestamptz,
  created_at         timestamptz not null default now(),
  constraint pagos_validacion_ck check (
    estado not in ('aprobado','rechazado','revertido')
    or (validado_at is not null and (validado_por is not null or metodo = 'webpay'))
  )
);
-- Sólo un pago aprobado por reserva
create unique index pagos_aprobado_uk on public.pagos(reserva_id) where estado = 'aprobado';
-- Sólo un pago pendiente por reserva
create unique index pagos_pendiente_uk on public.pagos(reserva_id) where estado = 'pendiente';
create index pagos_estado_idx on public.pagos(estado, created_at);

create table public.comprobantes (
  id              uuid primary key default gen_random_uuid(),
  reserva_id      uuid not null references public.reservas(id) on delete restrict,
  rifa_id         uuid not null references public.rifas(id) on delete restrict,
  comprador_id    uuid not null references public.compradores(id) on delete restrict,
  storage_path    text not null unique,
  nombre_original text not null check (length(nombre_original) <= 255),
  mime            text not null check (mime in ('image/jpeg','image/png','application/pdf')),
  tamano_bytes    integer not null check (tamano_bytes > 0 and tamano_bytes <= 5242880),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  estado_revision public.estado_revision not null default 'pendiente',
  revisado_por    uuid references public.usuarios(id),
  revisado_at     timestamptz,
  motivo_rechazo  text check (length(motivo_rechazo) <= 500),
  created_at      timestamptz not null default now()
);
create index comprobantes_reserva_idx on public.comprobantes(reserva_id);
create index comprobantes_estado_idx on public.comprobantes(estado_revision, created_at);
-- Evita subir el mismo archivo dos veces a la misma reserva
create unique index comprobantes_hash_uk on public.comprobantes(reserva_id, sha256);

alter table public.pagos
  add constraint pagos_comprobante_fk foreign key (comprobante_id) references public.comprobantes(id);

-- Transacciones de pasarela (Webpay) — preparado
create table public.transacciones_pasarela (
  id           uuid primary key default gen_random_uuid(),
  reserva_id   uuid not null references public.reservas(id) on delete restrict,
  proveedor    text not null default 'webpay',
  buy_order    text not null unique,
  token        text unique,
  monto        integer not null check (monto > 0),
  estado       text not null default 'iniciada' check (estado in ('iniciada','autorizada','rechazada','anulada','error')),
  respuesta    jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Notificaciones (cola + historial)
-- ---------------------------------------------------------------------
create table public.notificaciones (
  id           bigint generated always as identity primary key,
  rifa_id      uuid references public.rifas(id) on delete restrict,
  reserva_id   uuid references public.reservas(id) on delete restrict,
  tipo         text not null check (tipo in (
                 'reserva_confirmada','recordatorio_pago','reserva_expirada','pago_confirmado',
                 'pago_rechazado','nuevo_comprobante_solicitado','reserva_cancelada','resultado_sorteo')),
  canal        text not null check (canal in ('email','whatsapp')),
  destinatario text not null,
  datos        jsonb not null default '{}'::jsonb,
  estado       public.estado_cola not null default 'pendiente',
  intentos     integer not null default 0,
  error        text,
  proveedor_id text,
  created_at   timestamptz not null default now(),
  enviado_at   timestamptz
);
create index notificaciones_pendientes_idx on public.notificaciones(estado, created_at) where estado = 'pendiente';
create unique index notificaciones_recordatorio_uk on public.notificaciones(reserva_id, tipo, canal)
  where tipo in ('recordatorio_pago','resultado_sorteo','reserva_confirmada');

-- ---------------------------------------------------------------------
-- Sorteos
-- ---------------------------------------------------------------------
create table public.sorteos (
  id                    uuid primary key default gen_random_uuid(),
  rifa_id               uuid not null unique references public.rifas(id) on delete restrict,
  estado                public.estado_sorteo not null default 'padron_congelado',
  cantidad_ganadores    integer not null check (cantidad_ganadores between 1 and 100),
  permitir_repetidos    boolean not null default false,
  algoritmo             text not null default 'CCPP-SHA256-RS',
  version_algoritmo     text not null default '1.0.0',
  total_participantes   integer not null,
  padron_hash           text not null check (padron_hash ~ '^[0-9a-f]{64}$'),
  semilla_compromiso    text not null check (semilla_compromiso ~ '^[0-9a-f]{64}$'), -- sha256(semilla), publicado antes
  semilla               text,   -- se revela al ejecutar (privada hasta entonces)
  entropia_externa      text check (length(entropia_externa) <= 200),
  hash_base             text,
  reservas_excluidas    integer not null default 0,  -- reservas no resueltas al congelar
  padron_congelado_at   timestamptz not null default now(),
  padron_congelado_por  uuid not null references public.usuarios(id),
  ejecutado_at          timestamptz,
  ejecutado_por         uuid references public.usuarios(id),
  acta_path             text,
  created_at            timestamptz not null default now()
);

create table public.participantes_sorteo (
  sorteo_id     uuid not null references public.sorteos(id) on delete restrict,
  orden         integer not null,  -- posición en el padrón ordenado (0-based)
  numero        integer not null,
  numero_id     bigint not null references public.numeros(id),
  reserva_id    uuid not null references public.reservas(id),
  comprador_id  uuid not null references public.compradores(id),
  primary key (sorteo_id, orden),
  unique (sorteo_id, numero)
);

create table public.ganadores (
  id            uuid primary key default gen_random_uuid(),
  sorteo_id     uuid not null references public.sorteos(id) on delete restrict,
  posicion      integer not null,
  premio_id     uuid references public.premios(id),
  numero        integer not null,
  numero_id     bigint not null references public.numeros(id),
  reserva_id    uuid not null references public.reservas(id),
  comprador_id  uuid not null references public.compradores(id),
  intento       integer not null,  -- contador del muestreo por rechazo (evidencia)
  created_at    timestamptz not null default now(),
  unique (sorteo_id, posicion)
);

create table public.entrega_premios (
  id            uuid primary key default gen_random_uuid(),
  ganador_id    uuid not null unique references public.ganadores(id) on delete restrict,
  entregado_at  timestamptz not null default now(),
  recibido_por  text not null check (length(trim(recibido_por)) between 3 and 120),
  observacion   text check (length(observacion) <= 1000),
  evidencia_path text,
  registrado_por uuid not null references public.usuarios(id),
  created_at    timestamptz not null default now()
);

-- Documentos administrativos (actas, reportes, evidencias)
create table public.documentos (
  id            uuid primary key default gen_random_uuid(),
  rifa_id       uuid references public.rifas(id) on delete restrict,
  tipo          text not null check (tipo in ('ACTAS','REPORTES','GANADORES','EVIDENCIAS')),
  storage_path  text not null unique,
  nombre        text not null,
  mime          text not null,
  sha256        text,
  subido_por    uuid references public.usuarios(id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Respaldo Google Drive (cola + resultados)
-- ---------------------------------------------------------------------
create table public.respaldos_drive (
  id              bigint generated always as identity primary key,
  rifa_id         uuid references public.rifas(id) on delete restrict,
  tipo_evidencia  text not null check (tipo_evidencia in ('COMPROBANTES','REPORTES','GANADORES','EVIDENCIAS','ACTAS')),
  entidad         text not null,         -- 'comprobante' | 'documento'
  entidad_id      uuid not null,
  codigo_reserva  text,
  storage_bucket  text not null,
  storage_path    text not null,
  nombre_archivo  text not null,         -- nombre estandarizado en Drive
  carpeta_drive   text not null,         -- ruta lógica CENTRO_DE_PADRES/RIFAS/2026/RIFA_001/...
  sha256          text,
  drive_file_id   text,
  estado          public.estado_cola not null default 'pendiente',
  intentos        integer not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  ultimo_intento_at timestamptz,
  subido_at       timestamptz,
  unique (storage_bucket, storage_path)   -- evita duplicados
);
create index respaldos_estado_idx on public.respaldos_drive(estado, created_at);

-- Credenciales de integración (sólo service_role; tokens CIFRADOS por la función Edge)
create table public.integraciones (
  proveedor          text primary key check (proveedor in ('google_drive')),
  cuenta_email       text,
  token_cifrado      text,     -- AES-GCM, clave en secreto de la función Edge
  carpeta_raiz_id    text,
  carpetas_cache     jsonb not null default '{}'::jsonb,
  conectado_at       timestamptz,
  conectado_por      uuid references public.usuarios(id),
  oauth_state        text,
  oauth_state_expira timestamptz,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Auditoría (inmutable) y limitación de solicitudes
-- ---------------------------------------------------------------------
create table public.auditoria (
  id               bigint generated always as identity primary key,
  fecha            timestamptz not null default now(),
  usuario_id       uuid,           -- sin FK para conservar aunque se elimine el usuario
  usuario_email    text,
  actor            text not null,  -- 'admin' | 'publico' | 'sistema'
  tabla            text not null,
  registro_id      text,
  operacion        text not null,  -- INSERT | UPDATE | DELETE | o acción de negocio
  datos_anteriores jsonb,
  datos_nuevos     jsonb
);
create index auditoria_tabla_reg_idx on public.auditoria(tabla, registro_id);
create index auditoria_fecha_idx on public.auditoria(fecha desc);

create table public.limites_solicitudes (
  clave         text not null,
  ventana_inicio timestamptz not null,
  contador      integer not null default 0,
  primary key (clave, ventana_inicio)
);
