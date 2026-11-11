-- Datos FICTICIOS para pruebas E2E (nunca en producción)
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'tesorera@e2e.test'),
  ('22222222-2222-2222-2222-222222222222', 'presidenta@e2e.test');
insert into public.usuarios (id, email, nombre, rol) values
  ('11111111-1111-1111-1111-111111111111', 'tesorera@e2e.test', 'Tesorera E2E', 'tesorera'),
  ('22222222-2222-2222-2222-222222222222', 'presidenta@e2e.test', 'Presidenta E2E', 'presidenta');
-- La pasarela de pruebas no emula TOTP: el MFA se prueba a nivel de base de datos (claim aal)
update public.configuraciones set valor = 'false' where clave = 'seguridad.mfa_obligatorio';
update public.configuraciones set valor = '"Colegio Ficticio E2E"' where clave = 'institucion.colegio';

insert into public.rifas (id, nombre, colegio, centro_padres, descripcion, objetivo, precio_numero, numero_inicial, numero_final,
                          fecha_sorteo, bases, info_pago, contacto, minutos_reserva, created_by)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Gran Rifa Ficticia E2E', 'Colegio Ficticio E2E', 'CCPP Ficticio',
        'Rifa de prueba automatizada.', 'Financiar el paseo de fin de año', 2000, 1, 60, now() + interval '10 days',
        'Bases ficticias de prueba.', E'Banco Ficticio\nCuenta Vista 000-000\nRUT 11.111.111-1', 'tesoreria@e2e.test', 30,
        '11111111-1111-1111-1111-111111111111');
insert into public.premios (rifa_id, posicion, nombre) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'Bicicleta (ficticia)'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, 'Canasta familiar (ficticia)');
update public.rifas set estado = 'activa' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
