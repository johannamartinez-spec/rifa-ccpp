import { Container, Typography } from '@mui/material';
import { useConfigPublica } from '../../components/Layouts';

/** Política de privacidad (Ley 19.628 modificada por Ley 21.719). Revisar con asesoría legal antes de publicar. */
export default function Privacidad() {
  const cfg = useConfigPublica();
  const cp = cfg['institucion.centro_padres'] || 'el Centro de Padres y Apoderados';
  const H = ({ children }: { children: string }) => <Typography variant="h3" sx={{ mt: 3, mb: 1 }}>{children}</Typography>;
  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h1" gutterBottom>Política de privacidad</Typography>
      <Typography>Responsable del tratamiento: <b>{cp}</b> ({cfg['institucion.colegio']}). Contacto: {cfg['institucion.contacto']}.</Typography>
      <H>¿Qué datos pedimos y para qué?</H>
      <Typography>
        Nombre y apellido, curso del estudiante y teléfono celular, y opcionalmente correo electrónico. Sólo si las bases de una rifa lo exigen, el RUT.
        Los usamos exclusivamente para identificar su compra, validar el pago, comunicarle el estado de su reserva y el resultado del sorteo, y
        entregar los premios. No pedimos ni guardamos claves ni datos de tarjetas o cuentas bancarias. Los comprobantes de transferencia se
        guardan en un almacenamiento privado al que sólo accede Tesorería.
      </Typography>
      <H>Base de licitud</H>
      <Typography>Su consentimiento al reservar y la ejecución de la compra del número de rifa que usted solicita.</Typography>
      <H>¿Quién puede ver sus datos?</H>
      <Typography>
        Sólo las personas de la directiva autorizadas para ello (por ejemplo, Tesorería), con acceso registrado en una bitácora. Ningún visitante puede ver
        nombres, teléfonos ni correos de otros participantes. En la página pública del sorteo sólo se muestran números.
        Proveedores que procesan datos por encargo: Supabase (base de datos y archivos), Vercel (sitio web), el servicio de correo configurado y
        Google Drive de la cuenta institucional de Tesorería (respaldo de documentos).
      </Typography>
      <H>¿Cuánto tiempo los conservamos?</H>
      <Typography>
        Durante la rifa y hasta {cfg['privacidad.meses_conservacion'] || '24'} meses después del sorteo para rendición de cuentas. Luego los datos personales se
        anonimizan. Los comprobantes y registros contables pueden conservarse como respaldo de la rendición financiera del Centro de Padres.
      </Typography>
      <H>Sus derechos</H>
      <Typography>
        Puede solicitar acceso, rectificación, supresión, oposición o portabilidad de sus datos escribiendo al contacto indicado. Responderemos dentro de los
        plazos legales. Si la supresión no afecta una reserva en curso o un premio pendiente, anonimizaremos sus datos.
      </Typography>
      <H>Seguridad</H>
      <Typography>Conexiones cifradas (HTTPS), control de acceso por roles, segundo factor de autenticación para administradores y registro de auditoría.</Typography>
    </Container>
  );
}
