// supabase/functions/alerta-anden/index.ts
//
// Alerta "Carga No Preparada en Andén" — Quantrex Abbott
// ────────────────────────────────────────────────────────────────────────
// Qué hace:
//   1) Busca solicitudes tipo "carga_ol" que están en estado
//      "en_punto_cliente" (el chofer ya marcó "Llegué al punto de
//      entrega", automático o manual) hace más de UMBRAL_MINUTOS.
//   2) A cada una que aún no fue notificada (alerta_anden_enviada=false)
//      le envía un correo vía Resend con el diseño de la carpeta
//      email-template/, y marca alerta_anden_enviada=true para no
//      reenviarla en la próxima corrida.
//
// Por qué esto va en una Edge Function y NO dentro de App.jsx:
//   - Enviar el correo requiere una API key de proveedor de email
//     (Resend). Si esa key viviera en el código de React, cualquiera que
//     abra las herramientas de desarrollador del navegador podría
//     copiarla y enviar correos a nombre de Quantrex. Server-side (acá)
//     la key queda en un secreto de Supabase, nunca llega al navegador.
//   - Corre sola, con un cron (ver migration_alerta_anden.sql), sin
//     depender de que algún celular/PC tenga la app abierta.
//
// Variables de entorno (Supabase → Project Settings → Edge Functions →
// Secrets; NO se ponen en el código):
//   RESEND_API_KEY              -> API key de https://resend.com
//   ALERTA_ANDEN_REMITENTE      -> ej. "Quantrex Abbott <alertas@quantrex.cl>"
//                                   (el dominio debe estar verificado en Resend)
//   ALERTA_ANDEN_DESTINATARIOS  -> correos separados por coma, SOLO como
//                                   respaldo si la tabla "usuarios" no
//                                   devuelve ningún destinatario marcado
//                                   (ver obtenerDestinatarios más abajo). El
//                                   listado real y administrable vive en la
//                                   app: Gestión de Usuarios -> Operadores ->
//                                   casilla "Recibe email de carga no
//                                   preparada en andén" por cada operador.
//   APP_BASE_URL                -> URL pública donde vive la app Quantrex
//                                   (para armar el botón "Ver solicitud"),
//                                   ej. "https://app.quantrex.cl"
//   UMBRAL_MINUTOS              -> opcional, default 15
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -> ya vienen inyectadas
//                                   automáticamente por Supabase, no hace
//                                   falta configurarlas a mano.

const UMBRAL_MINUTOS = Number(Deno.env.get("UMBRAL_MINUTOS") || "15");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const REMITENTE = Deno.env.get("ALERTA_ANDEN_REMITENTE") || "Quantrex Abbott <alertas@quantrex.cl>";
const DESTINATARIOS_FALLBACK = (Deno.env.get("ALERTA_ANDEN_DESTINATARIOS") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") || "").replace(/\/$/, "");

function fmtHoraChile(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CL", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: "America/Santiago",
    });
  } catch { return iso; }
}

// Barra de urgencia: 0-100%, tope visual en 200% del umbral para que no se
// vea "llena" de forma poco informativa si lleva horas de atraso.
function barraUrgencia(minutos: number) {
  const pct = Math.min(100, Math.round((minutos / (UMBRAL_MINUTOS * 2)) * 100));
  return pct;
}

// Plantilla del correo. El ícono de "cadena rota" del banner se arma con
// HTML/CSS puro (dos óvalos blancos + un corte con una "×" en el medio),
// NO con un emoji. Se probaron emojis de cadena (⛓, y la variante
// combinada ⛓️‍💥) y su render es inconsistente entre plataformas -- en
// algunos sistemas/fuentes una cadena simple llega a mostrarse como un
// ancla u otro glifo. Con óvalos hechos en la propia tabla del correo, el
// ícono se ve idéntico sin importar el sistema operativo o la fuente de
// emojis del destinatario (funciona igual en Outlook de escritorio, que ni
// siquiera soporta bien emojis recientes).
//
// IMPORTANTE sobre compatibilidad: el layout usa <table> (no flexbox ni
// CSS grid) y colores sólidos (no linear-gradient) a propósito. Outlook de
// escritorio (Windows) renderiza los correos con el motor de Word, que
// ignora flexbox y gradientes por completo -- si se usan, el correo se ve
// roto justo para quien probablemente más necesita verlo (Abbott/Quantrex
// suelen usar Outlook corporativo). Con tablas + colores sólidos el look
// se mantiene igual de llamativo (rojo fuerte, ícono grande, barra de
// urgencia) pero se ve bien en Gmail, Outlook, Apple Mail y clientes
// móviles por igual.
function buildEmailHtml(sol: any, minutos: number) {
  const pct = barraUrgencia(minutos);
  const link = APP_BASE_URL ? `${APP_BASE_URL}/#/detalle/${sol.id}` : null;
  const guias = sol.guia || "—";
  const fila = (label: string, valor: string) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #23345C;color:#8BAFD4;font-size:12px;font-family:Arial,sans-serif;width:150px;vertical-align:top;">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid #23345C;color:#F0F6FF;font-size:13px;font-weight:700;font-family:Arial,sans-serif;">${valor}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!--[if mso]>
<style type="text/css">body,table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#070D1A;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070D1A;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <!-- Logo / marca -->
  <tr><td align="center" style="padding:8px 0 20px;">
    <span style="font-size:20px;font-weight:900;letter-spacing:2px;color:#F0F6FF;">QUANTREX</span><br/>
    <span style="font-size:10px;letter-spacing:3px;color:#00AEEF;text-transform:uppercase;">Gestión Logística · Abbott</span>
  </td></tr>

  <!-- Banner de alerta (color sólido a propósito, ver nota de compatibilidad arriba) -->
  <tr><td align="center" bgcolor="#DC2626" style="background:#DC2626;border-radius:16px;padding:26px 20px;">
    <!-- Ícono "cadena rota" hecho con tabla: óvalo - corte (×) - óvalo -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td width="52" height="24" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:12px;font-size:0;line-height:0;">&nbsp;</td>
        <td width="26" align="center" style="color:#FFFFFF;font-size:26px;font-weight:900;font-family:Arial,sans-serif;">&times;</td>
        <td width="52" height="24" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:12px;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
    </table>
    <div style="color:#FFFFFF;font-size:19px;font-weight:900;margin-top:16px;font-family:Arial,sans-serif;">CARGA NO PREPARADA EN AND&Eacute;N</div>
    <div style="color:#FFE4E4;font-size:13px;margin-top:4px;font-family:Arial,sans-serif;">SLA de espera superado en el punto de retiro</div>
  </td></tr>

  <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>

  <!-- Barra de urgencia -->
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="left" style="font-size:11px;color:#8BAFD4;font-family:Arial,sans-serif;padding-bottom:4px;">Umbral: ${UMBRAL_MINUTOS} min</td>
        <td align="right" style="font-size:11px;color:#F97316;font-weight:800;font-family:Arial,sans-serif;padding-bottom:4px;">${minutos} min en espera</td>
      </tr>
      <tr><td colspan="2">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1E3A6E;border-radius:8px;">
          <tr>
            <td width="${pct}%" bgcolor="#F97316" style="background:#F97316;height:10px;font-size:0;line-height:0;border-radius:8px 0 0 8px;">&nbsp;</td>
            <td bgcolor="#1E3A6E" style="height:10px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>

  <!-- Cuerpo -->
  <tr><td bgcolor="#112347" style="background:#112347;border:1px solid #1E3A6E;border-radius:14px;padding:20px;">
    <p style="color:#F0F6FF;font-size:14px;margin:0 0 6px;font-family:Arial,sans-serif;">Estimado equipo,</p>
    <p style="color:#B9CBE8;font-size:13px;line-height:1.5;margin:0 0 16px;font-family:Arial,sans-serif;">
      El chofer de Quantrex se present&oacute; en el punto de retiro hace m&aacute;s de
      <b style="color:#F97316;">${UMBRAL_MINUTOS} minutos</b> y la carga
      a&uacute;n no ha sido entregada para su despacho hacia Abbott. Se requiere
      gesti&oacute;n inmediata para evitar impacto en la ventana de entrega.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${fila("N&deg; Solicitud", sol.ot || sol.id)}
      ${fila("Cliente", sol.titulo || sol.solicitante || "—")}
      ${fila("Direcci&oacute;n", sol.direccion || "—")}
      ${fila("Chofer", sol.choferAsignado || sol.chofer_asignado || "—")}
      ${fila("Patente", sol.ppuAsignada || sol.ppu_asignada || "—")}
      ${fila("Hora de llegada", fmtHoraChile(sol.llegadaTs || sol.llegada_ts))}
      ${fila("N&deg; Gu&iacute;a(s) / Documento(s)", guias)}
    </table>
  </td></tr>

  ${link ? `
  <tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td bgcolor="#00AEEF" style="background:#00AEEF;border-radius:10px;">
        <a href="${link}" style="display:inline-block;color:#0D1F3C;text-decoration:none;font-weight:900;font-size:13px;font-family:Arial,sans-serif;padding:13px 28px;">Ver solicitud en Quantrex &rarr;</a>
      </td>
    </tr></table>
  </td></tr>` : ""}

  <tr><td align="center" style="padding-top:20px;color:#4A6FA5;font-size:11px;font-family:Arial,sans-serif;line-height:1.5;">
    Aviso autom&aacute;tico generado por el sistema Quantrex.<br/>No responder a este correo.
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPatch(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/solicitudes?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${id} -> ${res.status}: ${await res.text()}`);
}

async function enviarResend(asunto: string, html: string, destinatarios: string[]) {
  if (destinatarios.length === 0) throw new Error("No hay destinatarios configurados (ni en usuarios ni en ALERTA_ANDEN_DESTINATARIOS).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: REMITENTE,
      to: destinatarios,
      subject: asunto,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// El destinatario real y administrable vive en la tabla "usuarios" (columna
// notif_alerta_anden), editable desde Gestión de Usuarios en la app -- así
// César u otro admin puede sumar o sacar gente sin tocar código ni secrets
// de Supabase. ALERTA_ANDEN_DESTINATARIOS queda solo como red de seguridad
// por si todavía nadie fue marcado en la tabla.
async function obtenerDestinatarios(): Promise<string[]> {
  try {
    const usuarios = await sbGet(`usuarios?notif_alerta_anden=eq.true&bloqueado=eq.false&select=email`);
    const emails = (usuarios || []).map((u: any) => u.email).filter(Boolean);
    if (emails.length > 0) return emails;
  } catch (e) {
    console.error("obtenerDestinatarios: no se pudo leer la tabla usuarios, se usa el respaldo.", e);
  }
  return DESTINATARIOS_FALLBACK;
}

Deno.serve(async (_req) => {
  try {
    const cols = "id,ot,titulo,solicitante,direccion,chofer_asignado,ppu_asignada,guia,llegada_ts,status,tipo,alerta_anden_enviada";
    const candidatas = await sbGet(
      `solicitudes?tipo=eq.carga_ol&status=eq.en_punto_cliente&alerta_anden_enviada=eq.false&select=${cols}`,
    );

    // Si no hay ninguna solicitud vencida, ni siquiera vale la pena consultar
    // destinatarios -- evita una llamada de más en la mayoría de las corridas
    // (la función se llama cada 5 minutos, la mayor parte del tiempo sin nada
    // que notificar).
    if (candidatas.length === 0) {
      return new Response(JSON.stringify({ ok: true, revisadas: 0, notificadas: 0, detalle: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const destinatarios = await obtenerDestinatarios();
    const ahora = Date.now();
    const resultados: any[] = [];

    for (const sol of candidatas) {
      if (!sol.llegada_ts) continue; // sin timestamp real, no se puede calcular espera
      const minutos = Math.floor((ahora - new Date(sol.llegada_ts).getTime()) / 60000);
      if (minutos < UMBRAL_MINUTOS) continue;

      const html = buildEmailHtml(sol, minutos);
      const asunto = `🚨 Carga no preparada en andén — Solicitud ${sol.ot || sol.id} (${minutos} min)`;
      await enviarResend(asunto, html, destinatarios);
      await sbPatch(sol.id, { alerta_anden_enviada: true, alerta_anden_enviada_en: new Date().toISOString() });
      resultados.push({ id: sol.id, ot: sol.ot, minutos, destinatarios, notificado: true });
    }

    return new Response(JSON.stringify({ ok: true, revisadas: candidatas.length, notificadas: resultados.length, detalle: resultados }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("alerta-anden error:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
