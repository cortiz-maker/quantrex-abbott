import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { PUENTE_URL, SUPABASE_URL } from "./config.js";

// ── Valores de enums (tal cual están en Postgres) ────────────
const TIPOS_PAGO = ["Efectivo", "Transferencia", "Tarjeta", "Debito", "Plan PrePago", "Por Cobrar"];
const TIPOS_DOC = ["boleta", "factura", "sin_documento"];
const MARCAS = ["TrisQ", "Positive", "AguaFine"];
// Origen de un descuento manual en pedido_descuentos (texto libre, pero acotamos).
const ORIGENES_DESC = ["cliente", "volumen", "plan", "combo", "manual"];

const CLP = (n) =>
  "$" + (Number(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });

// Mensaje que ve el operador y que se envía por correo al cliente.
function mensajeConfirmacion(guia, nombreCliente) {
  const nombre = (nombreCliente || "").trim();
  return `¡Hola! 👋
Tu Pedido N° ${guia} ha sido ingresado a nuestra agenda y se encuentra programado para despacho el día de mañana. 🚚💧

📲 Síguenos en Instagram @aquatrisq y no olvides etiquetarnos cuando recibas tu pedido. ¡Nos encanta conocer tu experiencia y ver cómo disfrutas nuestros productos! 💦💙

🟡 Información Importante:
• Si solicitaste recargas, recuerda tener disponibles para intercambio la misma cantidad de bidones.
• Las fechas de despacho podrían sufrir modificaciones por motivos operacionales. En caso de cualquier cambio, te informaremos oportunamente por este mismo medio.

💳 Para tu comodidad, también puedes realizar el pago de forma rápida y segura a través de nuestro enlace de pago:
https://pay.sumup.com/b2c/Q4EFMRBM

📝 Importante al momento de pagar:
• Ingresa el monto correspondiente a tu pedido.
• En el campo "Tu nombre completo", por favor escribe tu nombre junto con el número de pedido o factura (${nombre} - N° ${guia}).

Una vez realizado el pago, agradeceremos nos envíes el comprobante por este mismo medio para actualizar nuestros registros.

¡Muchas gracias por preferirnos!
Saludos, Equipo TrisQ 💧`;
}

// Email válido (mismo criterio que la normalización de la base).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
const emailValido = (e) => !!e && EMAIL_RE.test(String(e).trim());

// Precio sugerido de un producto según su modo de descuento por volumen.
function precioSugerido(prod, cantidad, tramos) {
  if (!prod) return 0;
  const base = prod.precio_lista || 0;
  const modo = prod.modo_descuento_volumen || "ninguno";
  if (modo === "tramos") {
    const delProd = tramos
      .filter((t) => t.producto_id === prod.id)
      .sort((a, b) => Number(a.cantidad_min) - Number(b.cantidad_min));
    const m = delProd.find(
      (t) =>
        cantidad >= Number(t.cantidad_min) &&
        (t.cantidad_max == null || cantidad <= Number(t.cantidad_max))
    );
    return m ? m.precio_unit : base;
  }
  if (modo === "porcentaje") {
    const umbral = prod.desc_volumen_umbral;
    const pct = prod.desc_volumen_pct;
    if (umbral != null && pct != null && cantidad >= Number(umbral)) {
      return Math.round(base * (1 - Number(pct) / 100));
    }
    return base;
  }
  return base;
}

// Estado de entrega legible a partir del retorno de DispatchTrack (fila dt_entregas).
// status: 1 = pendiente/en ruta, 2 = gestionado. El substatus indica el resultado
// (p.ej. "Venta" = entregado con venta, o un motivo de no entrega). Si no hay fila
// de entrega, caemos al estado de sincronización del pedido.
function estadoEntregaDT(entrega, pedido) {
  if (entrega) {
    const sub = (entrega.substatus || "").toString();
    const gestionado = !!entrega.gestionado_en || Number(entrega.status) >= 2;
    if (gestionado) {
      const noEntrega = /no entreg|fallid|rechaz|sin morador|sin moradores|error|ausente|fuera horario/i.test(sub);
      if (noEntrega) return { label: "No entregado" + (sub ? " · " + sub : ""), cls: "bad" };
      return { label: "Entregado" + (sub ? " · " + sub : ""), cls: "ok" };
    }
    return { label: "En ruta / pendiente", cls: "warn" };
  }
  if (pedido && pedido.estado_sync === "enviado_dt") return { label: "En DT", cls: "warn" };
  return { label: "Pendiente", cls: "warn" };
}

// Respuestas del formulario del chofer, extraídas del payload crudo (raw.evaluation_answers
// o raw.form_answers). Defensivo ante el nombre de la llave del valor.
function answersFromRaw(entrega) {
  if (!entrega || !entrega.raw) return [];
  const raw = entrega.raw;
  const arr = raw.evaluation_answers || raw.form_answers || raw.end_form_answers || [];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((a) => {
      const name = a.name || a.question || a.label || "";
      let val = a.value;
      if (val === undefined || val === null || val === "") val = a.answer ?? a.text ?? a.option ?? a.selected ?? a.url ?? "";
      if (Array.isArray(val)) val = val.join(", ");
      if (val && typeof val === "object") val = val.url || val.name || JSON.stringify(val);
      return { name, val: val == null ? "" : String(val) };
    })
    .filter((x) => x.name && x.val !== "");
}

// ¿El chofer marcó "Pago = No" en el formulario de entrega? (= entregado sin pagar)
function respPago(entrega) {
  const a = answersFromRaw(entrega).find((x) => x.name.trim().toLowerCase() === "pago");
  return a ? a.val : null;
}
function esPagoNo(entrega) {
  const v = respPago(entrega);
  return v != null && /^\s*no\s*$/i.test(String(v));
}
function montoEntrega(entrega) {
  const a = answersFromRaw(entrega).find((x) => /monto venta/i.test(x.name));
  if (!a) return 0;
  const n = Number(String(a.val).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
// Compra Proveedor: substatus = "Compra Proveedor", campo "Prooveedor" contiene "Aguas Altas"
// Monto: campo "Monto Factura"
function esCompraProveedor(entrega) {
  if (!entrega) return false;
  const sub = (entrega.substatus || "").trim();
  return sub === "Compra Proveedor";
}
function montoCompraProveedor(entrega) {
  const a = answersFromRaw(entrega).find((x) => /monto factura/i.test(x.name));
  if (!a) return 0;
  const n = Number(String(a.val).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
// Rendición Efectivo: substatus = "Compra", campo "Tipo Compra" = "Rendición Efectivo"
// Monto: campo "Monto Compra"
function esRendicionEfectivo(entrega) {
  if (!entrega) return false;
  const sub = (entrega.substatus || "").trim();
  if (sub !== "Compra") return false;
  const a = answersFromRaw(entrega).find((x) => /tipo compra/i.test(x.name));
  return a ? /rendici[oó]n efectivo/i.test(a.val) : false;
}
function montoRendicion(entrega) {
  const a = answersFromRaw(entrega).find((x) => /monto compra/i.test(x.name));
  if (!a) return 0;
  const n = Number(String(a.val).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function App() {
  const credsListas =
    SUPABASE_URL && !SUPABASE_URL.startsWith("PEGA_");

  // Catálogos
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [tramos, setTramos] = useState([]);
  const [todosDomicilios, setTodosDomicilios] = useState([]); // índice para buscar por identificador_dt (215-1)
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");

  // Selección de cliente / domicilio / plan
  const [buscarCliente, setBuscarCliente] = useState("");
  const [cliente, setCliente] = useState(null);
  const [domicilios, setDomicilios] = useState([]);
  const [domicilioId, setDomicilioId] = useState("");
  const [planPrepago, setPlanPrepago] = useState(null);
  const [descCliente, setDescCliente] = useState([]);
  const [consumePlan, setConsumePlan] = useState(false);

  // Líneas y descuentos
  const [items, setItems] = useState([]);
  const [descuentos, setDescuentos] = useState([]);

  // Cabecera
  const [tipoDocumento, setTipoDocumento] = useState("boleta");
  const [tipoPago, setTipoPago] = useState("Por Cobrar");
  const [rutFactura, setRutFactura] = useState("");
  const [marca, setMarca] = useState("");
  const [fechaMin, setFechaMin] = useState("");
  const [fechaMax, setFechaMax] = useState("");
  const [observacion, setObservacion] = useState("");
  const [creadoPor, setCreadoPor] = useState("");

  // Guardado
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null); // { ok, guia, sync, msg }

  // Navegación entre vistas: inicio (dashboard) | nuevo | mantenedor | confirmacion
  const [vista, setVista] = useState("inicio");
  const [confirma, setConfirma] = useState(null); // { guia, mensaje, emailEnviado, emailDestino, sync }

  // ── Autenticación (Supabase Auth) ──────────────────────────
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [rol, setRol] = useState(null);           // admin | operador | gerencial
  const [perfilNombre, setPerfilNombre] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [logueando, setLogueando] = useState(false);

  // ── Dashboard gerencial (solo lectura, con gráficos) ───────
  const [ger, setGer] = useState(null);
  const [cargandoGer, setCargandoGer] = useState(false);
  const [errorGer, setErrorGer] = useState("");

  // Agregar email faltante al cliente desde el formulario
  const [emailNuevo, setEmailNuevo] = useState("");
  const [guardandoEmail, setGuardandoEmail] = useState(false);

  // Dashboard por mes calendario
  const hoyPeriodo = () => new Date().toISOString().slice(0, 7); // YYYY-MM
  const [periodo, setPeriodo] = useState(hoyPeriodo());
  const [pedidosMes, setPedidosMes] = useState([]);
  const [filtroEstado, setFiltroEstado] = useState("todos"); // todos | enviados | pendientes
  const [buscarPedido, setBuscarPedido] = useState("");
  const [cargandoDash, setCargandoDash] = useState(false);
  const [errorDash, setErrorDash] = useState("");

  // Mantenedor de bloqueo
  const [buscarMant, setBuscarMant] = useState("");
  const [clienteMant, setClienteMant] = useState(null);
  const [domMant, setDomMant] = useState(null);
  const [bloqMant, setBloqMant] = useState(false);
  const [motivoMant, setMotivoMant] = useState("");
  const [operadorMant, setOperadorMant] = useState("");
  const [guardandoMant, setGuardandoMant] = useState(false);
  const [okMant, setOkMant] = useState("");

  // ── Bloque 4: mantenedores (sub-pestañas) ──────────────────
  const [mantTab, setMantTab] = useState("clientes"); // clientes | productos | perfiles

  // Mantenedor de clientes (alta / edición)
  const [cliEdit, setCliEdit] = useState(null);   // objeto cliente en edición (null = ninguno)
  const [guardandoCli, setGuardandoCli] = useState(false);
  const [okCli, setOkCli] = useState("");
  const [semaforoCli, setSemaforoCli] = useState(null);
  const [domEdit, setDomEdit] = useState(null);    // domicilio en edición { id?, cliente_id, identificador_dt, etiqueta, direccion, comuna, es_principal, _nuevo }
  const [guardandoDom, setGuardandoDom] = useState(false);
  const [okDom, setOkDom] = useState("");
  const [errDom, setErrDom] = useState(""); // { cls, dias, label } o null
  // Historial de pedidos del cliente
  const [histPedidos, setHistPedidos] = useState(null); // null = no cargado
  const [cargandoHist, setCargandoHist] = useState(false);
  const [errorHist, setErrorHist] = useState("");
  const [histItems, setHistItems] = useState({});       // pedido_id -> items[]
  const [histAbierto, setHistAbierto] = useState(null);  // pedido_id expandido
  const [histEntregas, setHistEntregas] = useState({});  // numero_guia -> fila dt_entregas (retorno DispatchTrack)

  // ── Cobranza / gestión de cobro (Pago = No en el formulario de entrega) ──
  const [entregasMap, setEntregasMap] = useState({});   // guide -> dt_entregas (pedidos del dashboard)
  const [pedidoModal, setPedidoModal] = useState(null);  // { pedido, entrega } para el popup de detalle
  const [cobranzas, setCobranzas] = useState(null);      // lista de gestión de cobro (null = no cargado)
  const [cargandoCob, setCargandoCob] = useState(false);
  const [errorCob, setErrorCob] = useState("");
  const [okCob, setOkCob] = useState("");
  const [filtroCob, setFiltroCob] = useState("pendientes"); // pendientes | gestionados | todos
  const [guardandoCob, setGuardandoCob] = useState("");  // id del pedido en proceso
  const [avisoDeuda, setAvisoDeuda] = useState(null);    // { guias:[], monto } alerta en Nuevo pedido
  const [cobExpand, setCobExpand] = useState({});        // cliente_id -> grupo expandido en Cobranzas

  // Mantenedor de productos (admin)
  const [productosAll, setProductosAll] = useState([]);
  const [cargandoProd, setCargandoProd] = useState(false);
  const [errorProd, setErrorProd] = useState("");
  const [buscarProd, setBuscarProd] = useState("");
  const [prodEdit, setProdEdit] = useState(null); // producto en edición (con _nuevo:true si es alta)
  const [guardandoProd, setGuardandoProd] = useState(false);
  const [okProd, setOkProd] = useState("");

  // Mantenedor de perfiles (admin)
  const [perfiles, setPerfiles] = useState([]);
  const [cargandoPerf, setCargandoPerf] = useState(false);
  const [errorPerf, setErrorPerf] = useState("");
  const [perfEdit, setPerfEdit] = useState(null); // perfil en edición
  const [guardandoPerf, setGuardandoPerf] = useState(false);
  const [okPerf, setOkPerf] = useState("");

  // ── Bloque 5: repetir última compra ────────────────────────
  const [repitiendo, setRepitiendo] = useState(false);
  const [avisoRepetir, setAvisoRepetir] = useState("");

  // ── Carga inicial de catálogos ─────────────────────────────
  useEffect(() => {
    if (!credsListas) {
      setCargando(false);
      return;
    }
    if (!session) {
      // Con RLS activo, los datos se leen autenticado: esperamos al login.
      setCargando(false);
      return;
    }
    setCargando(true);
    (async () => {
      try {
        // Supabase devuelve máximo 1000 filas por consulta. clientes y
        // domicilios superan eso, así que los traemos paginando en bloques.
        const traerTodo = async (tabla, columnas) => {
          const PAGE = 1000;
          let desde = 0;
          let acumulado = [];
          for (;;) {
            const { data, error } = await supabase
              .from(tabla)
              .select(columnas)
              .range(desde, desde + PAGE - 1);
            if (error) throw error;
            acumulado = acumulado.concat(data || []);
            if (!data || data.length < PAGE) break;
            desde += PAGE;
          }
          return acumulado;
        };

        const [cli, dom, p, t] = await Promise.all([
          traerTodo("clientes", "*"),
          traerTodo("domicilios", "id,cliente_id,identificador_dt,etiqueta,direccion,comuna,es_principal"),
          supabase.from("productos").select("*").eq("activo", true).order("nombre"),
          supabase.from("precio_tramos").select("*"),
        ]);
        if (p.error) throw p.error;
        if (t.error) throw t.error;
        cli.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
        setClientes(cli);
        setProductos(p.data || []);
        setTramos(t.data || []);
        setTodosDomicilios(dom);
      } catch (e) {
        setErrorCarga(e.message || "No se pudieron cargar los catálogos.");
      } finally {
        setCargando(false);
      }
    })();
  }, [credsListas, session]);

  // ── Dashboard: pedidos del mes calendario seleccionado ─────
  async function cargarDashboard(per) {
    if (!credsListas || !session) return;
    setCargandoDash(true);
    setErrorDash("");
    try {
      const [y, m] = per.split("-").map(Number);
      const desde = new Date(y, m - 1, 1).toISOString();
      const hasta = new Date(y, m, 1).toISOString();
      const { data, error } = await supabase
        .from("pedidos")
        .select("*")
        .gte("created_at", desde)
        .lt("created_at", hasta)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const peds = data || [];
      setPedidosMes(peds);
      // Entregas DT del período (para el popup y el estado de cobro en el listado)
      const guias = peds.map((p) => p.numero_guia).filter(Boolean);
      if (guias.length) {
        const mapa = {};
        const CH = 200;
        for (let i = 0; i < guias.length; i += CH) {
          const lote = guias.slice(i, i + CH);
          const { data: ents } = await supabase.from("dt_entregas").select("*").in("guide", lote);
          (ents || []).forEach((e) => { if (e.guide) mapa[e.guide] = e; });
        }
        setEntregasMap(mapa);
      } else {
        setEntregasMap({});
      }
    } catch (e) {
      setErrorDash(e.message || "No se pudo cargar el período.");
      setPedidosMes([]);
    } finally {
      setCargandoDash(false);
    }
  }
  useEffect(() => {
    if (vista === "inicio") cargarDashboard(periodo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, periodo, credsListas, session]);

  // ── Carga del dashboard gerencial (últimos 6 meses) ────────
  async function cargarGerencial() {
    if (!credsListas || !session) return;
    setCargandoGer(true);
    setErrorGer("");
    try {
      const ahora = new Date();
      const ini = new Date(ahora.getFullYear(), ahora.getMonth() - 5, 1);
      const desde = ini.toISOString();

      const { data: peds, error: ePed } = await supabase
        .from("pedidos")
        .select("id, created_at, monto_total, por_cobrar, domicilio_id")
        .gte("created_at", desde)
        .order("created_at", { ascending: true });
      if (ePed) throw ePed;
      const pedidos = peds || [];

      // Ítems de esos pedidos (para el mix de productos)
      let itemsMix = [];
      const ids = pedidos.map((p) => p.id);
      if (ids.length) {
        const CHUNK = 200;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const lote = ids.slice(i, i + CHUNK);
          const { data: it, error: eIt } = await supabase
            .from("pedido_items")
            .select("nombre, codigo, cantidad, subtotal, pedido_id")
            .in("pedido_id", lote);
          if (eIt) throw eIt;
          itemsMix = itemsMix.concat(it || []);
        }
      }

      // 1) Evolución mensual: últimos 6 meses
      const meses = [];
      for (let k = 5; k >= 0; k--) {
        const d = new Date(ahora.getFullYear(), ahora.getMonth() - k, 1);
        const key = d.toISOString().slice(0, 7);
        const lab = d.toLocaleDateString("es-CL", { month: "short" });
        meses.push({ key, label: lab.charAt(0).toUpperCase() + lab.slice(1, 3), count: 0, monto: 0 });
      }
      const idxMes = Object.fromEntries(meses.map((m, i) => [m.key, i]));
      pedidos.forEach((p) => {
        const key = (p.created_at || "").slice(0, 7);
        if (key in idxMes) {
          meses[idxMes[key]].count += 1;
          meses[idxMes[key]].monto += Number(p.monto_total) || 0;
        }
      });

      // 2) Mix de productos (por cantidad y valor)
      const mapProd = {};
      itemsMix.forEach((it) => {
        const nom = it.nombre || it.codigo || "—";
        if (!mapProd[nom]) mapProd[nom] = { nombre: nom, cantidad: 0, valor: 0 };
        mapProd[nom].cantidad += Number(it.cantidad) || 0;
        mapProd[nom].valor += Number(it.subtotal) || 0;
      });
      const mix = Object.values(mapProd).sort((a, b) => b.cantidad - a.cantidad).slice(0, 7);

      // 3) Pedidos por comuna (vía domicilio → comuna)
      const mapCom = {};
      pedidos.forEach((p) => {
        const dom = domPorId[p.domicilio_id];
        const com = (dom && dom.comuna) ? dom.comuna : "Sin comuna";
        mapCom[com] = (mapCom[com] || 0) + 1;
      });
      const comunas = Object.entries(mapCom)
        .map(([comuna, count]) => ({ comuna, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      // KPIs del mes actual
      const mesActual = meses[meses.length - 1] || { count: 0, monto: 0 };
      const porCobrarMes = pedidos
        .filter((p) => (p.created_at || "").slice(0, 7) === hoyPeriodo() && p.por_cobrar)
        .reduce((s, p) => s + (Number(p.monto_total) || 0), 0);
      const ticket = mesActual.count ? Math.round(mesActual.monto / mesActual.count) : 0;

      // Deuda vencida +30 días (histórico): entregas Pago=No no cobradas, gestionadas hace +30 días
      let venc30 = { monto: 0, count: 0 };
      try {
        const { data: ents } = await supabase
          .from("dt_entregas").select("*")
          .not("gestionado_en", "is", null)
          .order("gestionado_en", { ascending: false })
          .limit(1000);
        const pagoNo = (ents || []).filter((e) => esPagoNo(e));
        const guias = [...new Set(pagoNo.map((e) => e.guide).filter(Boolean))];
        const entByGuide = {};
        pagoNo.forEach((e) => { if (e.guide) entByGuide[e.guide] = e; });
        let pp = [];
        for (let i = 0; i < guias.length; i += 200) {
          const lote = guias.slice(i, i + 200);
          if (!lote.length) break;
          const { data } = await supabase.from("pedidos").select("numero_guia, monto_total, cobro_cobrado").in("numero_guia", lote);
          pp = pp.concat(data || []);
        }
        const ahora = Date.now();
        pp.forEach((p) => {
          if (p.cobro_cobrado) return;
          const e = entByGuide[p.numero_guia];
          const g = e?.gestionado_en ? new Date(e.gestionado_en).getTime() : null;
          if (g && (ahora - g) > 30 * 86400000) { venc30.monto += Number(p.monto_total) || 0; venc30.count += 1; }
        });
      } catch { /* si falla, dejamos venc30 en cero */ }

      setGer({ meses, mix, comunas, mesActual, porCobrarMes, ticket, venc30 });
    } catch (e) {
      setErrorGer(e.message || "No se pudo cargar el panel gerencial.");
      setGer(null);
    } finally {
      setCargandoGer(false);
    }
  }
  useEffect(() => {
    if (rol === "gerencial" && vista === "inicio") cargarGerencial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rol, vista, session, todosDomicilios]);

  // ── Bloque 4: cargar datos del mantenedor según sub-pestaña ─
  useEffect(() => {
    if (vista !== "mantenedor" || !session) return;
    if (mantTab === "productos" && rol === "admin") cargarProductosAll();
    if (mantTab === "perfiles" && rol === "admin") cargarPerfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, mantTab, rol, session]);

  // El operador no tiene mantenedores de productos ni perfiles.
  useEffect(() => {
    if (rol !== "admin" && (mantTab === "productos" || mantTab === "perfiles")) setMantTab("clientes");
  }, [rol, mantTab]);

  // ── Sesión: detectar login, cargar rol del perfil ──────────
  useEffect(() => {
    if (!credsListas) { setAuthReady(true); return; }
    let activo = true;
    async function cargarPerfil(sess) {
      if (!sess) { setRol(null); setPerfilNombre(""); return; }
      const { data } = await supabase
        .from("perfiles")
        .select("rol, nombre, activo")
        .eq("id", sess.user.id)
        .maybeSingle();
      if (!activo) return;
      if (data && data.activo) {
        setRol(data.rol);
        setPerfilNombre(data.nombre || sess.user.email);
        setVista("inicio");
      } else {
        setRol(null);
      }
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setSession(data.session);
      cargarPerfil(data.session).finally(() => activo && setAuthReady(true));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess);
      cargarPerfil(sess);
    });
    return () => { activo = false; sub.subscription.unsubscribe(); };
  }, [credsListas]);

  async function iniciarSesion() {
    setLoginError("");
    setLogueando(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPass,
      });
      if (error) setLoginError("Email o contraseña incorrectos.");
      else setLoginPass("");
    } catch (e) {
      setLoginError(e.message || "No se pudo iniciar sesión.");
    } finally {
      setLogueando(false);
    }
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
    setRol(null);
    setPerfilNombre("");
    setVista("inicio");
  }

  // El perfil gerencial no opera pedidos ni mantiene clientes.
  useEffect(() => {
    if (rol === "gerencial" && (vista === "nuevo" || vista === "mantenedor" || vista === "cobranzas")) {
      setVista("inicio");
    }
  }, [rol, vista]);

  // Mantener emailNuevo sincronizado con el cliente elegido
  useEffect(() => {
    setEmailNuevo(cliente?.email || "");
  }, [cliente]);

  // Guardar email que el operador agrega a un cliente sin correo
  async function guardarEmailCliente() {
    if (!cliente) return;
    const e = emailNuevo.trim();
    if (!emailValido(e)) return;
    setGuardandoEmail(true);
    try {
      const { error } = await supabase
        .from("clientes")
        .update({ email: e, email_status: "ok", email_original: cliente.email_original || null })
        .eq("id", cliente.id);
      if (error) throw error;
      const actualizado = { ...cliente, email: e, email_status: "ok" };
      setCliente(actualizado);
      setClientes((prev) => prev.map((c) => (c.id === cliente.id ? actualizado : c)));
    } catch (err) {
      setResultado({ ok: false, msg: "No se pudo guardar el email: " + (err.message || err) });
    } finally {
      setGuardandoEmail(false);
    }
  }

  // ── Mantenedor de bloqueo ──────────────────────────────────
  // Busca igual que el formulario: por cliente (nombre/RUT/código) y por
  // domicilio (identificador_dt como 0004-1, o dirección), resolviendo al cliente dueño.
  const resultadosMant = useMemo(() => {
    const q = buscarMant.trim().toLowerCase();
    if (!q) return [];
    const porCliente = clientes
      .filter(
        (c) =>
          (c.nombre || "").toLowerCase().includes(q) ||
          (c.rut || "").toLowerCase().includes(q) ||
          (c.codigo_cliente || "").toLowerCase().includes(q)
      )
      .map((c) => ({ cliente: c, dom: null }));

    const porDomicilio = todosDomicilios
      .filter(
        (d) =>
          (d.identificador_dt || "").toLowerCase().includes(q) ||
          (d.direccion || "").toLowerCase().includes(q) ||
          (d.etiqueta || "").toLowerCase().includes(q)
      )
      .map((d) => ({ cliente: clientes.find((c) => c.id === d.cliente_id), dom: d }))
      .filter((r) => r.cliente);

    const vistos = new Set();
    return [...porDomicilio, ...porCliente]
      .filter((r) => {
        const k = r.cliente.id + "|" + (r.dom?.id || "");
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      })
      .slice(0, 8);
  }, [buscarMant, clientes, todosDomicilios]);

  function elegirMant(r) {
    setClienteMant(r.cliente);
    setDomMant(r.dom || null);
    setBuscarMant("");
    setBloqMant(!!r.cliente.bloqueado);
    setMotivoMant(r.cliente.motivo_bloqueo || "");
    setOkMant("");
  }

  async function guardarBloqueo() {
    if (!clienteMant) return;
    setGuardandoMant(true);
    setOkMant("");
    try {
      const patch = {
        bloqueado: bloqMant,
        motivo_bloqueo: bloqMant ? motivoMant.trim() || "Bloqueado (sin motivo)" : null,
        bloqueado_por: bloqMant ? operadorMant.trim() || null : null,
        bloqueado_at: bloqMant ? new Date().toISOString() : null,
      };
      const { error } = await supabase.from("clientes").update(patch).eq("id", clienteMant.id);
      if (error) throw error;
      const actualizado = { ...clienteMant, ...patch };
      setClienteMant(actualizado);
      setClientes((prev) => prev.map((c) => (c.id === clienteMant.id ? actualizado : c)));
      if (cliente && cliente.id === clienteMant.id) setCliente(actualizado);
      setOkMant(bloqMant ? "Cliente bloqueado." : "Cliente desbloqueado.");
    } catch (err) {
      setOkMant("Error: " + (err.message || err));
    } finally {
      setGuardandoMant(false);
    }
  }

  // ── Bloque 4: recargar el catálogo activo (Nuevo pedido) ───
  // Tras pausar/activar/editar productos refrescamos lo que ve Nuevo pedido.
  async function recargarProductosActivos() {
    const { data } = await supabase.from("productos").select("*").eq("activo", true).order("nombre");
    setProductos(data || []);
  }

  // ── Mantenedor de clientes: alta / edición ─────────────────
  // Código de cliente correlativo: NNNN-1 (el "-1" es fijo). Arranca en 2212-1.
  function siguienteCodigoCliente() {
    let max = 2211; // de modo que el primero generado sea 2212
    clientes.forEach((c) => {
      const m = String(c.codigo_cliente || "").match(/^0*(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    });
    return String(max + 1) + "-1";
  }

  function nuevoCliente() {
    setOkCli("");
    setHistPedidos(null);
    setHistAbierto(null);
    setCliEdit({
      _nuevo: true,
      nombre: "", rut: "", codigo_cliente: siguienteCodigoCliente(), telefono: "", email: "",
      es_empresa: false, razon_social: "", giro: "", marca: "", notas: "",
      activo: true, bloqueado: false, motivo_bloqueo: "",
    });
  }
  function editarCliente(c) {
    setOkCli("");
    setHistPedidos(null);
    setHistAbierto(null);
    setHistItems({});
    setHistEntregas({});
    setSemaforoCli(null);
    setDomEdit(null);
    setOkDom("");
    setErrDom("");
    setCliEdit({ ...c, _nuevo: false });
    calcSemaforo(c);
  }

  // Semáforo de pago: solo si el cliente alguna vez entró en no-pago (Pago = No).
  // Color por la antigüedad de su deuda actual sin cobrar (días desde la entrega).
  async function calcSemaforo(c) {
    try {
      const { data: pp } = await supabase
        .from("pedidos")
        .select("numero_guia, cobro_cobrado, cobro_at")
        .eq("cliente_id", c.id);
      const guias = (pp || []).map((x) => x.numero_guia).filter(Boolean);
      if (!guias.length) return;
      const { data: ents } = await supabase.from("dt_entregas").select("*").in("guide", guias);
      const pagoNoMap = {};
      (ents || []).forEach((e) => { if (e.guide && esPagoNo(e)) pagoNoMap[e.guide] = e; });
      const conNoPago = (pp || []).filter((x) => pagoNoMap[x.numero_guia]);
      if (!conNoPago.length) return; // nunca entró en no-pago → sin semáforo
      // Días que tardó/lleva en pagar: si está cobrado, entrega→cobro; si no, entrega→hoy.
      let diasMax = 0, hayDeuda = false;
      conNoPago.forEach((x) => {
        const e = pagoNoMap[x.numero_guia];
        const g = e?.gestionado_en ? new Date(e.gestionado_en).getTime() : null;
        if (!g) return;
        let d;
        if (x.cobro_cobrado) {
          const fin = x.cobro_at ? new Date(x.cobro_at).getTime() : g;
          d = Math.max(0, Math.floor((fin - g) / 86400000));
        } else {
          hayDeuda = true;
          d = Math.floor((Date.now() - g) / 86400000);
        }
        if (d > diasMax) diasMax = d;
      });
      let cls;
      if (diasMax >= 16) cls = "rojo"; else if (diasMax >= 6) cls = "amarillo"; else cls = "verde";
      let label;
      if (hayDeuda) {
        label = cls === "rojo" ? `Moroso · ${diasMax} días sin pagar`
              : cls === "amarillo" ? `Pago lento · ${diasMax} días sin pagar`
              : `Al día · ${diasMax} días`;
      } else {
        label = cls === "rojo" ? `Historial moroso · pagó hasta en ${diasMax} días`
              : cls === "amarillo" ? `Pago lento · pagó hasta en ${diasMax} días`
              : `Buen pagador · pagó en ${diasMax} día(s)`;
      }
      setSemaforoCli({ cls, dias: diasMax, label, moroso: cls === "rojo", hayDeuda });
    } catch { /* sin semáforo si falla */ }
  }

  // Historial de pedidos del cliente en edición
  async function verHistorial(c) {
    if (!c) return;
    setCargandoHist(true);
    setErrorHist("");
    setHistAbierto(null);
    setHistEntregas({});
    try {
      const { data, error } = await supabase
        .from("pedidos")
        .select("*")
        .eq("cliente_id", c.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const peds = data || [];
      setHistPedidos(peds);

      // Retorno de DispatchTrack: cruzamos dt_entregas por guide = numero_guia
      const guias = peds.map((p) => p.numero_guia).filter(Boolean);
      if (guias.length) {
        const { data: ents, error: eEnt } = await supabase
          .from("dt_entregas")
          .select("*")
          .in("guide", guias);
        if (!eEnt && ents) {
          const mapa = {};
          ents.forEach((e) => { if (e.guide) mapa[e.guide] = e; });
          setHistEntregas(mapa);
        }
        // Si eEnt existe (p.ej. RLS), no rompemos el historial: solo no se muestra el estado de entrega.
      }
    } catch (e) {
      setErrorHist(e.message || "No se pudo cargar el historial.");
      setHistPedidos([]);
    } finally {
      setCargandoHist(false);
    }
  }
  async function toggleHistItems(pedidoId) {
    if (histAbierto === pedidoId) { setHistAbierto(null); return; }
    setHistAbierto(pedidoId);
    if (!histItems[pedidoId]) {
      const { data } = await supabase.from("pedido_items").select("*").eq("pedido_id", pedidoId);
      setHistItems((prev) => ({ ...prev, [pedidoId]: data || [] }));
    }
  }
  // ── Cobranza / gestión de cobro ────────────────────────────
  function abrirPedidoModal(p) {
    setPedidoModal({ pedido: p, entrega: p.numero_guia ? entregasMap[p.numero_guia] : null });
  }

  async function abrirCobranzas() {
    setVista("cobranzas");
    setCargandoCob(true);
    setErrorCob("");
    setOkCob("");
    try {
      // Entregas gestionadas (traen formulario) → filtramos las de Pago = No
      const { data: ents, error: eEnt } = await supabase
        .from("dt_entregas")
        .select("*")
        .not("gestionado_en", "is", null)
        .order("gestionado_en", { ascending: false })
        .limit(1000);
      if (eEnt) throw eEnt;
      const pagoNo = (ents || []).filter((e) => esPagoNo(e));
      const guias = [...new Set(pagoNo.map((e) => e.guide).filter(Boolean))];
      let peds = [];
      if (guias.length) {
        const CH = 200;
        for (let i = 0; i < guias.length; i += CH) {
          const lote = guias.slice(i, i + CH);
          const { data: pp } = await supabase.from("pedidos").select("*").in("numero_guia", lote);
          peds = peds.concat(pp || []);
        }
      }
      const mapEnt = {};
      pagoNo.forEach((e) => { if (e.guide) mapEnt[e.guide] = e; });
      const lista = peds
        .map((p) => ({ pedido: p, entrega: mapEnt[p.numero_guia] || null }))
        .sort((a, b) => new Date(b.entrega?.gestionado_en || 0) - new Date(a.entrega?.gestionado_en || 0));
      setCobranzas(lista);
    } catch (e) {
      setErrorCob(e.message || "No se pudo cargar la gestión de cobro.");
      setCobranzas([]);
    } finally {
      setCargandoCob(false);
    }
  }

  function actualizarCobranzaLocal(id, patch) {
    setCobranzas((prev) => (prev ? prev.map((x) => (x.pedido.id === id ? { ...x, pedido: { ...x.pedido, ...patch } } : x)) : prev));
    setPedidosMes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setPedidoModal((prev) => (prev && prev.pedido.id === id ? { ...prev, pedido: { ...prev.pedido, ...patch } } : prev));
  }

  // Marca/desmarca Cobrado o Recuperado (estados independientes).
  async function marcarCobroCampo(pedido, campo) {
    setGuardandoCob(pedido.id);
    setErrorCob("");
    setOkCob("");
    try {
      const nuevo = !pedido[campo];
      const patch = { [campo]: nuevo, cobro_at: new Date().toISOString(), cobro_por: perfilNombre || null };
      const { error } = await supabase.from("pedidos").update(patch).eq("id", pedido.id);
      if (error) throw error;
      actualizarCobranzaLocal(pedido.id, patch);
      setOkCob(`${pedido.numero_guia || ""}: ${campo === "cobro_cobrado" ? "Cobrado" : "Recuperado"} ${nuevo ? "marcado" : "desmarcado"}.`);
    } catch (e) {
      setErrorCob(e.message || "No se pudo actualizar.");
    } finally {
      setGuardandoCob("");
    }
  }

  // Registra un intento de cobro. Más de 3 intentos sin cobrar → bloquea al cliente.
  async function registrarIntento(pedido) {
    setGuardandoCob(pedido.id);
    setErrorCob("");
    setOkCob("");
    try {
      const intentos = (Number(pedido.cobro_intentos) || 0) + 1;
      const patch = { cobro_intentos: intentos, cobro_at: new Date().toISOString(), cobro_por: perfilNombre || null };
      const { error } = await supabase.from("pedidos").update(patch).eq("id", pedido.id);
      if (error) throw error;
      actualizarCobranzaLocal(pedido.id, patch);
      setOkCob(`${pedido.numero_guia || ""}: intento de cobro registrado (${intentos}).`);

      if (intentos > 3 && !pedido.cobro_cobrado) {
        const cli = clientePorId[pedido.cliente_id];
        if (cli && !cli.bloqueado) {
          const motivo = `Deuda pendiente: ${intentos} intentos de cobro sin éxito (guía ${pedido.numero_guia || ""})`;
          const bpatch = { bloqueado: true, motivo_bloqueo: motivo, bloqueado_por: perfilNombre || null, bloqueado_at: new Date().toISOString() };
          const { error: eCli } = await supabase.from("clientes").update(bpatch).eq("id", cli.id);
          if (!eCli) {
            setClientes((prev) => prev.map((c) => (c.id === cli.id ? { ...c, ...bpatch } : c)));
            setOkCob(`⚠ ${cli.nombre} fue bloqueado automáticamente por ${intentos} intentos de cobro sin éxito.`);
          }
        }
      }
    } catch (e) {
      setErrorCob(e.message || "No se pudo registrar el intento.");
    } finally {
      setGuardandoCob("");
    }
  }

  // Bloque de detalle de entrega (reutilizado en popup). Devuelve JSX o null.
  function renderEntregaDT(entrega) {
    if (!entrega) return <p className="aq-muted">Este pedido aún no tiene retorno de DispatchTrack (no gestionado).</p>;
    const answers = answersFromRaw(entrega);
    const ent = estadoEntregaDT(entrega, null);
    return (
      <div className="aq-hist-pod" style={{ marginTop: 0 }}>
        <strong>Entrega (DispatchTrack)</strong>
        <div>Estado: {ent.label}</div>
        {entrega.gestionado_en && <div>Gestionado: {new Date(entrega.gestionado_en).toLocaleString("es-CL")}</div>}
        {entrega.contact_name && <div>Recibe / domicilio: {entrega.contact_name}</div>}
        {(entrega.bidon_pendiente !== null && entrega.bidon_pendiente !== undefined) && <div>Bidón pendiente: {entrega.bidon_pendiente}</div>}
        {entrega.ruta && <div>Ruta: {entrega.ruta}</div>}
        {(entrega.latitude && entrega.longitude) && (
          <div><a className="aq-link" href={`https://maps.google.com/?q=${entrega.latitude},${entrega.longitude}`} target="_blank" rel="noreferrer">Ver ubicación de entrega</a></div>
        )}
        {answers.length > 0 && (
          <div className="aq-hist-form">
            {answers.map((a, idx) => (
              <div key={idx}><em>{a.name}:</em> {/^https?:\/\//.test(a.val) ? <a className="aq-link" href={a.val} target="_blank" rel="noreferrer">ver archivo</a> : a.val}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function guardarDomicilio() {
    if (!domEdit) return;
    setGuardandoDom(true); setErrDom(""); setOkDom("");
    try {
      const payload = {
        cliente_id:      cliEdit.id,
        identificador_dt: (domEdit.identificador_dt || "").trim() || null,
        etiqueta:        (domEdit.etiqueta || "").trim() || null,
        direccion:       (domEdit.direccion || "").trim() || null,
        comuna:          (domEdit.comuna || "").trim() || null,
        es_principal:    !!domEdit.es_principal,
      };
      if (!payload.identificador_dt) { setErrDom("El identificador (ej: 0215-2) es obligatorio."); return; }
      if (!payload.direccion)        { setErrDom("La dirección es obligatoria."); return; }
      if (domEdit._nuevo) {
        const { error } = await supabase.from("domicilios").insert(payload);
        if (error) throw error;
        setOkDom("Domicilio agregado.");
      } else {
        const { error } = await supabase.from("domicilios").update(payload).eq("id", domEdit.id);
        if (error) throw error;
        setOkDom("Domicilio actualizado.");
      }
      // Refresca índice global de domicilios
      const { data: nuevos } = await supabase.from("domicilios").select("*").eq("cliente_id", cliEdit.id);
      setTodosDomicilios((prev) => {
        const sinEste = prev.filter((d) => d.cliente_id !== cliEdit.id);
        return [...sinEste, ...(nuevos || [])];
      });
      setDomEdit(null);
    } catch (e) {
      setErrDom(e.message || "No se pudo guardar el domicilio.");
    } finally {
      setGuardandoDom(false);
    }
  }

  async function guardarCliente() {
    if (!cliEdit) return;
    const nombre = (cliEdit.nombre || "").trim();
    if (!nombre) { setOkCli("Error: el nombre es obligatorio."); return; }
    const email = (cliEdit.email || "").trim();
    if (email && !emailValido(email)) { setOkCli("Error: el email no tiene un formato válido."); return; }
    setGuardandoCli(true);
    setOkCli("");
    try {
      const patch = {
        nombre,
        rut: (cliEdit.rut || "").trim() || null,
        codigo_cliente: (cliEdit.codigo_cliente || "").trim() || null,
        telefono: (cliEdit.telefono || "").trim() || null,
        email: email || null,
        email_status: email ? "ok" : (cliEdit.email_status || null),
        es_empresa: !!cliEdit.es_empresa,
        razon_social: cliEdit.es_empresa ? ((cliEdit.razon_social || "").trim() || null) : null,
        giro: cliEdit.es_empresa ? ((cliEdit.giro || "").trim() || null) : null,
        marca: (cliEdit.marca || "").trim() || null,
        notas: (cliEdit.notas || "").trim() || null,
        bloqueado: !!cliEdit.bloqueado,
        motivo_bloqueo: cliEdit.bloqueado ? ((cliEdit.motivo_bloqueo || "").trim() || "Bloqueado (sin motivo)") : null,
        bloqueado_por: cliEdit.bloqueado ? ((cliEdit.bloqueado_por || perfilNombre || "").trim() || null) : null,
        bloqueado_at: cliEdit.bloqueado ? (cliEdit.bloqueado_at || new Date().toISOString()) : null,
      };

      let guardado;
      if (cliEdit._nuevo) {
        const { data, error } = await supabase
          .from("clientes")
          .insert({ ...patch, activo: true })
          .select()
          .single();
        if (error) throw error;
        guardado = data;
        setClientes((prev) => [...prev, guardado].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "")));
      } else {
        const { error } = await supabase.from("clientes").update(patch).eq("id", cliEdit.id);
        if (error) throw error;
        guardado = { ...cliEdit, ...patch };
        delete guardado._nuevo;
        setClientes((prev) => prev.map((c) => (c.id === guardado.id ? guardado : c)));
        if (cliente && cliente.id === guardado.id) setCliente(guardado);
      }
      setCliEdit(null);
      setOkCli(cliEdit._nuevo ? "Cliente creado." : "Cambios guardados.");
    } catch (err) {
      setOkCli("Error: " + (err.message || err));
    } finally {
      setGuardandoCli(false);
    }
  }
  // Desactivar = baja lógica (no borrado físico, para no romper pedidos/domicilios).
  async function desactivarCliente(c) {
    if (!c) return;
    if (!window.confirm(`¿Desactivar a "${c.nombre}"? Dejará de aparecer en búsquedas de Nuevo pedido. Sus pedidos históricos se conservan.`)) return;
    try {
      const { error } = await supabase.from("clientes").update({ activo: false }).eq("id", c.id);
      if (error) throw error;
      const actualizado = { ...c, activo: false };
      setClientes((prev) => prev.map((x) => (x.id === c.id ? actualizado : x)));
      setCliEdit(null);
      setOkCli("Cliente desactivado.");
    } catch (err) {
      setOkCli("Error: " + (err.message || err));
    }
  }

  // ── Mantenedor de productos (admin) ────────────────────────
  async function cargarProductosAll() {
    setCargandoProd(true);
    setErrorProd("");
    try {
      const { data, error } = await supabase.from("productos").select("*").order("nombre");
      if (error) throw error;
      setProductosAll(data || []);
    } catch (e) {
      setErrorProd(e.message || "No se pudieron cargar los productos.");
    } finally {
      setCargandoProd(false);
    }
  }
  function nuevoProducto() {
    setOkProd("");
    setProdEdit({
      _nuevo: true,
      codigo: "", nombre: "", familia: "", descripcion: "",
      precio_lista: 0, activo: true, precio_variable: false, requiere_factura: false,
      modo_descuento_volumen: "ninguno", desc_volumen_umbral: null, desc_volumen_pct: null,
    });
  }
  function editarProducto(p) {
    setOkProd("");
    setProdEdit({ ...p, _nuevo: false });
  }
  async function guardarProducto() {
    if (!prodEdit) return;
    const nombre = (prodEdit.nombre || "").trim();
    const codigo = (prodEdit.codigo || "").trim();
    if (!nombre) { setOkProd("Error: el nombre es obligatorio."); return; }
    if (!codigo) { setOkProd("Error: el código (SKU) es obligatorio."); return; }
    setGuardandoProd(true);
    setOkProd("");
    try {
      const modo = prodEdit.modo_descuento_volumen || "ninguno";
      const patch = {
        codigo,
        nombre,
        familia: (prodEdit.familia || "").trim() || null,
        descripcion: (prodEdit.descripcion || "").trim() || null,
        precio_lista: Number(prodEdit.precio_lista) || 0,
        activo: !!prodEdit.activo,
        precio_variable: !!prodEdit.precio_variable,
        requiere_factura: !!prodEdit.requiere_factura,
        modo_descuento_volumen: modo,
        desc_volumen_umbral: modo === "porcentaje" ? (Number(prodEdit.desc_volumen_umbral) || null) : null,
        desc_volumen_pct: modo === "porcentaje" ? (Number(prodEdit.desc_volumen_pct) || null) : null,
      };
      if (prodEdit._nuevo) {
        const { error } = await supabase.from("productos").insert(patch);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("productos").update(patch).eq("id", prodEdit.id);
        if (error) throw error;
      }
      await cargarProductosAll();
      await recargarProductosActivos();
      setProdEdit(null);
      setOkProd(prodEdit._nuevo ? "Producto creado." : "Cambios guardados.");
    } catch (err) {
      setOkProd("Error: " + (err.message || err));
    } finally {
      setGuardandoProd(false);
    }
  }
  // Pausar / activar SKU: pausado (activo=false) deja de aparecer en Nuevo pedido.
  async function togglePausaProducto(p) {
    setOkProd("");
    try {
      const nuevo = !p.activo;
      const { error } = await supabase.from("productos").update({ activo: nuevo }).eq("id", p.id);
      if (error) throw error;
      setProductosAll((prev) => prev.map((x) => (x.id === p.id ? { ...x, activo: nuevo } : x)));
      await recargarProductosActivos();
      setOkProd(nuevo ? `"${p.nombre}" reactivado.` : `"${p.nombre}" pausado (no aparece en Nuevo pedido).`);
    } catch (err) {
      setOkProd("Error: " + (err.message || err));
    }
  }

  // ── Mantenedor de perfiles (admin) ─────────────────────────
  async function cargarPerfiles() {
    setCargandoPerf(true);
    setErrorPerf("");
    try {
      const { data, error } = await supabase.from("perfiles").select("*").order("nombre");
      if (error) throw error;
      setPerfiles(data || []);
    } catch (e) {
      setErrorPerf(e.message || "No se pudieron cargar los perfiles.");
    } finally {
      setCargandoPerf(false);
    }
  }
  function editarPerfil(p) {
    setOkPerf("");
    setPerfEdit({ ...p });
  }
  async function guardarPerfil() {
    if (!perfEdit) return;
    const esYo = session && perfEdit.id === session.user.id;
    // Salvaguarda: no permitir que el admin se quite a sí mismo el rol o se desactive (evita quedar sin acceso).
    if (esYo && (perfEdit.rol !== "admin" || !perfEdit.activo)) {
      setOkPerf("Error: no puedes quitarte tu propio rol admin ni desactivarte (evita bloqueo de acceso).");
      return;
    }
    setGuardandoPerf(true);
    setOkPerf("");
    try {
      const patch = {
        nombre: (perfEdit.nombre || "").trim() || null,
        rol: perfEdit.rol,
        activo: !!perfEdit.activo,
      };
      const { error } = await supabase.from("perfiles").update(patch).eq("id", perfEdit.id);
      if (error) throw error;
      setPerfiles((prev) => prev.map((x) => (x.id === perfEdit.id ? { ...x, ...patch } : x)));
      setPerfEdit(null);
      setOkPerf("Perfil actualizado.");
    } catch (err) {
      setOkPerf("Error: " + (err.message || err));
    } finally {
      setGuardandoPerf(false);
    }
  }

  // ── Al elegir cliente: domicilios + plan + descuentos ──────
  async function elegirCliente(c, domPreseleccionarId) {
    setCliente(c);
    setBuscarCliente("");
    setDomicilioId("");
    setPlanPrepago(null);
    setConsumePlan(false);
    setAvisoRepetir("");
    setAvisoDeuda(null);
    setSemaforoCli(null);
    setMarca(c.marca || "");
    setRutFactura(c.rut || "");
    setTipoDocumento(c.es_empresa ? "factura" : "boleta");

    const [dom, plan, dc] = await Promise.all([
      supabase.from("domicilios").select("*").eq("cliente_id", c.id).order("es_principal", { ascending: false }),
      supabase.from("planes_contratados").select("*").eq("cliente_id", c.id).eq("tipo", "prepago").eq("estado", "activo"),
      supabase.from("descuentos_cliente").select("*").eq("cliente_id", c.id).eq("activo", true),
    ]);

    const doms = dom.data || [];
    setDomicilios(doms);
    // Si se buscó por un identificador de domicilio (215-1), preseleccionar ese;
    // si no, el principal o el primero.
    const elegido =
      (domPreseleccionarId && doms.find((d) => d.id === domPreseleccionarId)) ||
      doms.find((d) => d.es_principal) ||
      doms[0];
    if (elegido) setDomicilioId(elegido.id);

    // Plan prepago con saldo disponible
    const conSaldo = (plan.data || []).find((p) => (p.unidades_saldo ?? 0) > 0);
    setPlanPrepago(conSaldo || null);

    setDescCliente(dc.data || []);

    // Alerta de deuda: entregas con Pago=No que aún no están cobradas
    try {
      const { data: pp } = await supabase
        .from("pedidos")
        .select("numero_guia, monto_total, cobro_cobrado")
        .eq("cliente_id", c.id);
      const guias = (pp || []).filter((x) => x.numero_guia && !x.cobro_cobrado).map((x) => x.numero_guia);
      if (guias.length) {
        const { data: ents } = await supabase.from("dt_entregas").select("*").in("guide", guias);
        const deudaGuias = (ents || []).filter((e) => esPagoNo(e)).map((e) => e.guide);
        if (deudaGuias.length) {
          const monto = (pp || [])
            .filter((x) => deudaGuias.includes(x.numero_guia))
            .reduce((s, x) => s + (Number(x.monto_total) || 0), 0);
          setAvisoDeuda({ guias: deudaGuias, monto });
        }
      }
    } catch { /* si falla (RLS), no bloqueamos el flujo */ }

    calcSemaforo(c);
  }

  // ── Bloque 5: repetir última compra ────────────────────────
  // Precarga productos, cantidades, domicilio y forma de pago del último
  // pedido del cliente. El operador revisa y confirma. Los precios se
  // recalculan a la lista vigente (un pedido nuevo se cobra a precio de hoy).
  async function repetirUltimaCompra() {
    if (!cliente) return;
    setRepitiendo(true);
    setAvisoRepetir("");
    setResultado(null);
    try {
      const { data: peds, error: ePed } = await supabase
        .from("pedidos")
        .select("*")
        .eq("cliente_id", cliente.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (ePed) throw ePed;
      const ult = (peds || [])[0];
      if (!ult) { setAvisoRepetir("Este cliente no tiene pedidos anteriores."); return; }

      const { data: lineas, error: eIt } = await supabase
        .from("pedido_items")
        .select("*")
        .eq("pedido_id", ult.id);
      if (eIt) throw eIt;

      // Mapear líneas a productos ACTIVOS. Los pausados/eliminados se omiten.
      const nuevas = [];
      const omitidos = [];
      (lineas || []).forEach((l) => {
        const prod = productos.find((p) => p.id === l.producto_id);
        if (!prod) {
          omitidos.push(l.nombre || l.codigo || "producto");
          return;
        }
        const cantidad = Number(l.cantidad) || 1;
        nuevas.push({
          key: crypto.randomUUID(),
          producto_id: prod.id,
          cantidad,
          precio_unit: precioSugerido(prod, cantidad, tramos),
          precio_editado: false,
        });
      });

      if (nuevas.length === 0) {
        setAvisoRepetir("La última compra no tiene productos disponibles hoy (todos pausados o eliminados).");
        return;
      }

      setItems(nuevas);
      setDescuentos([]); // los descuentos no se arrastran: se re-evalúan en el pedido nuevo

      // Domicilio del último pedido, si todavía existe entre los del cliente
      if (ult.domicilio_id && domicilios.some((d) => d.id === ult.domicilio_id)) {
        setDomicilioId(ult.domicilio_id);
      }
      // Documento y forma de pago del último pedido
      if (ult.tipo_documento && TIPOS_DOC.includes(ult.tipo_documento)) setTipoDocumento(ult.tipo_documento);
      if (ult.tipo_pago && TIPOS_PAGO.includes(ult.tipo_pago) && ult.tipo_pago !== "Plan PrePago") {
        setTipoPago(ult.tipo_pago);
      }

      const fecha = ult.created_at ? new Date(ult.created_at).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "";
      let msg = `Cargada la última compra${ult.numero_guia ? " (guía " + ult.numero_guia + ")" : ""}${fecha ? " del " + fecha : ""}: ${nuevas.length} línea(s). Precios actualizados a lista vigente. Revisa y confirma.`;
      if (omitidos.length) msg += ` ⚠ No se cargaron (pausados/sin stock): ${omitidos.join(", ")}.`;
      setAvisoRepetir(msg);
    } catch (e) {
      setAvisoRepetir("Error al repetir la compra: " + (e.message || e));
    } finally {
      setRepitiendo(false);
    }
  }

  // Resultados de búsqueda: por datos del cliente (nombre/RUT/código) y
  // también por el identificador del domicilio (ej. 215-1).
  const resultadosBusqueda = useMemo(() => {
    const q = buscarCliente.trim().toLowerCase();
    if (!q) return [];
    const porCliente = clientes
      .filter(
        (c) =>
          c.activo !== false &&
          ((c.nombre || "").toLowerCase().includes(q) ||
          (c.rut || "").toLowerCase().includes(q) ||
          (c.codigo_cliente || "").toLowerCase().includes(q))
      )
      .map((c) => ({ cliente: c, dom: null }));

    // Coincidencias por identificador_dt del domicilio (215-1)
    const porDomicilio = todosDomicilios
      .filter((d) => (d.identificador_dt || "").toLowerCase().includes(q))
      .map((d) => ({ cliente: clientes.find((c) => c.id === d.cliente_id), dom: d }))
      .filter((r) => r.cliente && r.cliente.activo !== false);

    // Unir evitando duplicar el mismo par cliente+domicilio
    const vistos = new Set();
    const todo = [...porDomicilio, ...porCliente].filter((r) => {
      const k = r.cliente.id + "|" + (r.dom?.id || "");
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    return todo.slice(0, 8);
  }, [buscarCliente, clientes, todosDomicilios]);

  // ── Líneas de producto ─────────────────────────────────────
  function agregarItem() {
    const prod = productos[0];
    if (!prod) return;
    const cantidad = 1;
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        producto_id: prod.id,
        cantidad,
        precio_unit: precioSugerido(prod, cantidad, tramos),
        precio_editado: false,
      },
    ]);
  }

  function cambiarProducto(key, producto_id) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        const prod = productos.find((p) => p.id === producto_id);
        return {
          ...it,
          producto_id,
          precio_editado: false,
          precio_unit: precioSugerido(prod, it.cantidad, tramos),
        };
      })
    );
  }

  function cambiarCantidad(key, cantidad) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        const prod = productos.find((p) => p.id === it.producto_id);
        return {
          ...it,
          cantidad,
          precio_unit: it.precio_editado ? it.precio_unit : precioSugerido(prod, cantidad, tramos),
        };
      })
    );
  }

  function cambiarPrecio(key, precio_unit) {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, precio_unit, precio_editado: true } : it))
    );
  }

  function quitarItem(key) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  // ── Descuentos ─────────────────────────────────────────────
  function agregarDescuento(base) {
    setDescuentos((prev) => [
      ...prev,
      { key: crypto.randomUUID(), origen: base?.origen || "manual", descripcion: base?.descripcion || "", monto: base?.monto || 0 },
    ]);
  }
  function cambiarDescuento(key, campo, valor) {
    setDescuentos((prev) => prev.map((d) => (d.key === key ? { ...d, [campo]: valor } : d)));
  }
  function quitarDescuento(key) {
    setDescuentos((prev) => prev.filter((d) => d.key !== key));
  }

  // ── Totales ────────────────────────────────────────────────
  const subtotal = items.reduce((s, it) => s + Math.round((Number(it.cantidad) || 0) * (Number(it.precio_unit) || 0)), 0);
  const totalDesc = descuentos.reduce((s, d) => s + (Number(d.monto) || 0), 0);
  const montoTotal = Math.max(0, subtotal - totalDesc);

  // Unidades que consume el plan prepago = recargas R20 del pedido.
  const unidadesPlan = items.reduce((s, it) => {
    const prod = productos.find((p) => p.id === it.producto_id);
    return prod && prod.codigo === "R20" ? s + (Number(it.cantidad) || 0) : s;
  }, 0);

  // Si consume plan, el medio de pago es Plan PrePago.
  useEffect(() => {
    if (consumePlan) setTipoPago("Plan PrePago");
  }, [consumePlan]);

  // ── Validación ─────────────────────────────────────────────
  function validar() {
    if (!cliente) return "Elige un cliente.";
    if (cliente.bloqueado)
      return "Cliente bloqueado" + (cliente.motivo_bloqueo ? ": " + cliente.motivo_bloqueo : "") + ". No se puede generar el pedido.";
    if (!domicilioId) return "Elige un domicilio de entrega.";
    if (items.length === 0) return "Agrega al menos un producto.";
    if (items.some((it) => !it.producto_id || Number(it.cantidad) <= 0)) return "Revisa cantidades y productos de las líneas.";
    if (tipoDocumento === "factura" && !rutFactura.trim()) return "Para factura necesitas el RUT de facturación.";
    if (consumePlan && planPrepago && unidadesPlan > (planPrepago.unidades_saldo ?? 0))
      return `El plan tiene ${planPrepago.unidades_saldo} recargas de saldo y el pedido consume ${unidadesPlan}.`;
    return "";
  }
  const errorValidacion = validar();

  // ── Guardar pedido ─────────────────────────────────────────
  async function guardarPedido() {
    const err = validar();
    if (err) {
      setResultado({ ok: false, msg: err });
      return;
    }
    setGuardando(true);
    setResultado(null);

    try {
      // 1) Cabecera. numero_guia lo genera la función siguiente_numero_aq().
      const cabecera = {
        cliente_id: cliente.id,
        domicilio_id: domicilioId,
        fecha_min_entrega: fechaMin ? new Date(fechaMin).toISOString() : null,
        fecha_max_entrega: fechaMax ? new Date(fechaMax).toISOString() : null,
        marca: marca || null,
        tipo_pago: tipoPago,
        por_cobrar: tipoPago === "Por Cobrar",
        tipo_documento: tipoDocumento,
        rut_factura: tipoDocumento === "factura" ? rutFactura.trim() : null,
        monto_total: montoTotal,
        origen: "formulario",
        observacion: observacion.trim() || null,
        estado_sync: "pendiente",
        creado_por: creadoPor.trim() || null,
        plan_contratado_id: consumePlan && planPrepago ? planPrepago.id : null,
        consume_plan: consumePlan && !!planPrepago,
      };

      const { data: pedido, error: ePed } = await supabase
        .from("pedidos")
        .insert(cabecera)
        .select()
        .single();
      if (ePed) throw ePed;

      // 2) Líneas
      const lineas = items.map((it) => {
        const prod = productos.find((p) => p.id === it.producto_id);
        const cant = Number(it.cantidad) || 0;
        const pu = Number(it.precio_unit) || 0;
        return {
          pedido_id: pedido.id,
          producto_id: it.producto_id,
          nombre: prod ? prod.nombre : "",
          codigo: prod ? prod.codigo : null,
          cantidad: cant,
          precio_unit: pu,
          // 'subtotal' es columna generada en la base (cantidad * precio_unit);
          // Postgres la calcula sola, por eso no la enviamos.
        };
      });
      const { error: eItems } = await supabase.from("pedido_items").insert(lineas);
      if (eItems) throw eItems;

      // 3) Descuentos
      if (descuentos.length) {
        const ds = descuentos
          .filter((d) => Number(d.monto) > 0)
          .map((d) => ({
            pedido_id: pedido.id,
            origen: d.origen || "manual",
            descripcion: d.descripcion || null,
            monto: Number(d.monto) || 0,
            aplicado_por: creadoPor.trim() || null,
          }));
        if (ds.length) {
          const { error: eDesc } = await supabase.from("pedido_descuentos").insert(ds);
          if (eDesc) throw eDesc;
        }
      }

      // 4) Consumo de saldo del plan prepago
      let avisoPlan = "";
      if (cabecera.consume_plan && unidadesPlan > 0) {
        const nuevoConsumo = (planPrepago.unidades_consumidas || 0) + unidadesPlan;
        const { error: ePlan } = await supabase
          .from("planes_contratados")
          .update({ unidades_consumidas: nuevoConsumo })
          .eq("id", planPrepago.id);
        if (ePlan) avisoPlan = " (no se pudo descontar el saldo del plan: revisar permisos)";
      }

      // 5) Envío a DispatchTrack vía el puente (best-effort).
      let sync = "pendiente";
      let avisoSync = "Envío a DispatchTrack pendiente.";
      try {
        const r = await fetch(`${PUENTE_URL}/api/dispatches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pedido, items: lineas }),
        });
        if (r.ok) {
          const data = await r.json();
          const dispatchId = data?.dispatchtrack?.dispatch_id || null;
          await supabase
            .from("pedidos")
            .update({
              estado_sync: "enviado_dt",
              dt_dispatch_id: dispatchId,
              enviado_at: new Date().toISOString(),
            })
            .eq("id", pedido.id);
          sync = "enviado_dt";
          avisoSync = "Enviado a DispatchTrack.";
        }
      } catch {
        /* el puente puede no tener aún el mapeo; el pedido queda guardado igual */
      }

      // 6) Mensaje de confirmación + correo al cliente (best-effort)
      const guia = pedido.numero_guia;
      const mensaje = mensajeConfirmacion(guia, cliente?.nombre);
      const emailDestino = emailValido(cliente?.email) ? cliente.email.trim() : null;

      const detalle = lineas
        .map((l) => `${l.cantidad} x ${l.nombre}${l.codigo ? " (" + l.codigo + ")" : ""} — ${CLP((Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0))}`)
        .join("\n");

      let emailEnviado = false;
      if (emailDestino) {
        try {
          const re = await fetch(`${PUENTE_URL}/api/notificar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: emailDestino,
              cliente: cliente?.nombre || "",
              guia,
              mensaje,
              detalle,
              total: montoTotal,
            }),
          });
          emailEnviado = re.ok;
        } catch {
          /* el endpoint de correo puede no estar aún en el puente */
        }
      }

      setConfirma({ guia, mensaje, emailEnviado, emailDestino, sync });
      setVista("confirmacion");

      // Reset completo: volvemos al inicio en una pantalla limpia.
      setItems([]);
      setDescuentos([]);
      setObservacion("");
      setCliente(null);
      setDomicilioId("");
      setPlanPrepago(null);
      setConsumePlan(false);
      setResultado(null);
    } catch (e) {
      setResultado({ ok: false, msg: "No se pudo guardar: " + (e.message || e) });
    } finally {
      setGuardando(false);
    }
  }

  // ── Métricas del dashboard (mes seleccionado) ──────────────
  // Mapas para resolver cliente y domicilio sin consultas nuevas.
  const clientePorId = useMemo(() => {
    const m = {};
    clientes.forEach((c) => { m[c.id] = c; });
    return m;
  }, [clientes]);
  const domPorId = useMemo(() => {
    const m = {};
    todosDomicilios.forEach((d) => { m[d.id] = d; });
    return m;
  }, [todosDomicilios]);

  const infoPedido = (p) => {
    const c = clientePorId[p.cliente_id];
    const d = domPorId[p.domicilio_id];
    return {
      nombre: c?.nombre || "Cliente",
      comuna: d?.comuna || d?.direccion || "",
      ident: d?.identificador_dt || c?.codigo_cliente || "",
    };
  };

  const dash = (() => {
    const ped = pedidosMes;
    const est = (p) => String(p.estado_entrega || p.estado || "").toLowerCase();
    const hoy = new Date().toISOString().slice(0, 10);
    // Cobro: deuda real = entrega con Pago=No y aún no cobrado (en el período)
    const conDeuda = ped.filter((p) => {
      const e = p.numero_guia ? entregasMap[p.numero_guia] : null;
      return e && esPagoNo(e) && !p.cobro_cobrado;
    });
    return {
      ingresados: ped.length,
      enviados: ped.filter((p) => p.estado_sync === "enviado_dt").length,
      pendientes: ped.filter((p) => p.estado_sync !== "enviado_dt").length,
      entregados: ped.filter((p) => est(p).includes("entreg")).length,
      paraHoy: ped.filter((p) => (p.fecha_min_entrega || "").slice(0, 10) === hoy).length,
      monto: ped.reduce((s, p) => s + (Number(p.monto_total) || 0), 0),
      porCobrar: ped.filter((p) => p.por_cobrar).reduce((s, p) => s + (Number(p.monto_total) || 0), 0),
      tieneEstado: ped.some((p) => p.estado_entrega != null || p.estado != null),
      // Gestión de cobro
      deudaCount: conDeuda.length,
      deudaMonto: conDeuda.reduce((s, p) => s + (Number(p.monto_total) || 0), 0),
      cobrados: ped.filter((p) => p.cobro_cobrado).length,
      recuperados: ped.filter((p) => p.cobro_recuperado).length,
      // Compra Proveedor (Aguas Altas) y Rendición Efectivo
      compraProveedor: ped.reduce((s, p) => {
        const e = p.numero_guia ? entregasMap[p.numero_guia] : null;
        return s + (esCompraProveedor(e) ? montoCompraProveedor(e) : 0);
      }, 0),
      rendicionEfectivo: ped.reduce((s, p) => {
        const e = p.numero_guia ? entregasMap[p.numero_guia] : null;
        return s + (esRendicionEfectivo(e) ? montoRendicion(e) : 0);
      }, 0),
    };
  })();

  // Estado de cobro de un pedido (para badge en el listado).
  const cobroDePedido = (p) => {
    const e = p.numero_guia ? entregasMap[p.numero_guia] : null;
    if (!e || !esPagoNo(e)) return null;
    if (p.cobro_cobrado) return { label: "Cobrado", cls: "ok" };
    return { label: "Deuda", cls: "bad" };
  };

  // Resumen e índices de la ventana Cobranzas (histórico completo).
  const DIA_MS = 86400000;
  const montoCob = (o) => Number(o.pedido.monto_total) || montoEntrega(o.entrega) || 0;
  const diasDesdeEntrega = (o) => {
    const g = o.entrega?.gestionado_en ? new Date(o.entrega.gestionado_en).getTime() : null;
    return g ? Math.floor((Date.now() - g) / DIA_MS) : null;
  };

  const cobResumen = useMemo(() => {
    const items = cobranzas || [];
    let generada = 0, cobrado = 0, pend = 0, pendCount = 0, venc = 0, vencCount = 0, recCount = 0;
    items.forEach((o) => {
      const m = montoCob(o);
      generada += m;
      if (o.pedido.cobro_cobrado) cobrado += m;
      else {
        pend += m; pendCount++;
        const d = diasDesdeEntrega(o);
        if (d != null && d > 30) { venc += m; vencCount++; }
      }
      if (o.pedido.cobro_recuperado) recCount++;
    });
    return { generada, cobrado, pend, pendCount, venc, vencCount, recCount, total: items.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobranzas]);

  const cobGrupos = useMemo(() => {
    const items = (cobranzas || []).filter((x) => {
      if (filtroCob === "pendientes") return !x.pedido.cobro_cobrado;
      if (filtroCob === "gestionados") return !!x.pedido.cobro_cobrado;
      return true;
    });
    const map = {};
    items.forEach((o) => {
      const cid = o.pedido.cliente_id || "—";
      if (!map[cid]) map[cid] = { clienteId: cid, orders: [] };
      map[cid].orders.push(o);
    });
    return Object.values(map)
      .map((g) => {
        const deuda = g.orders.filter((o) => !o.pedido.cobro_cobrado).reduce((s, o) => s + montoCob(o), 0);
        const diasMax = g.orders.filter((o) => !o.pedido.cobro_cobrado).reduce((mx, o) => { const d = diasDesdeEntrega(o); return d != null && d > mx ? d : mx; }, 0);
        return { ...g, deuda, count: g.orders.length, diasMax };
      })
      .sort((a, b) => b.deuda - a.deuda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobranzas, filtroCob]);

  const pedidosFiltrados = useMemo(() => {
    const q = buscarPedido.trim().toLowerCase();
    const hoyStr = new Date().toISOString().slice(0, 10);
    return pedidosMes.filter((p) => {
      if (filtroEstado === "enviados" && p.estado_sync !== "enviado_dt") return false;
      if (filtroEstado === "pendientes" && p.estado_sync === "enviado_dt") return false;
      if (filtroEstado === "hoy" && (p.fecha_min_entrega || "").slice(0, 10) !== hoyStr) return false;
      if (!q) return true;
      const i = infoPedido(p);
      return (
        (p.numero_guia || "").toLowerCase().includes(q) ||
        i.nombre.toLowerCase().includes(q) ||
        i.comuna.toLowerCase().includes(q) ||
        i.ident.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidosMes, filtroEstado, buscarPedido, clientePorId, domPorId]);

  const periodoLabel = (() => {
    const [y, m] = periodo.split("-").map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();
  function cambiarPeriodo(delta) {
    const [y, m] = periodo.split("-").map(Number);
    setPeriodo(new Date(y, m - 1 + delta, 1).toISOString().slice(0, 7));
  }

  // ── Render ─────────────────────────────────────────────────
  // Pantalla de login (si hay credenciales de Supabase pero no hay sesión válida)
  if (credsListas && !authReady) {
    return (
      <div className="aq aq-login-wrap">
        <style>{css}</style>
        <div className="aq-card">Cargando…</div>
      </div>
    );
  }
  if (credsListas && (!session || !rol)) {
    return (
      <div className="aq aq-login-wrap">
        <style>{css}</style>
        <div className="aq-login">
          <img src="/logo-aquatrisq.png" className="aq-logo-big" alt="Aquatrisq" />
          <h1>Aquatrisq</h1>
          <p className="aq-login-sub">Gestión de pedidos</p>
          {session && !rol && (
            <div className="aq-result bad" style={{ marginBottom: 12 }}>
              Tu usuario no tiene un perfil asignado o está inactivo. Contacta al administrador.
            </div>
          )}
          <label className="aq-full">
            Email
            <input
              type="email"
              value={loginEmail}
              autoComplete="username"
              onChange={(e) => setLoginEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && iniciarSesion()}
            />
          </label>
          <label className="aq-full">
            Contraseña
            <input
              type="password"
              value={loginPass}
              autoComplete="current-password"
              onChange={(e) => setLoginPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && iniciarSesion()}
            />
          </label>
          {loginError && <div className="aq-result bad">{loginError}</div>}
          <button className="aq-btn" disabled={logueando || !loginEmail || !loginPass} onClick={iniciarSesion}>
            {logueando ? "Entrando…" : "Entrar"}
          </button>
          {session && !rol && (
            <button className="aq-link" style={{ marginTop: 12 }} onClick={cerrarSesion}>Cerrar sesión</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="aq">
      <style>{css}</style>

      <header className="aq-header">
        <div className="aq-brand">
          <img src="/logo-aquatrisq.png" className="aq-logo" alt="Aquatrisq" />
          <div>
            <h1>Aquatrisq</h1>
            <p>Gestión de pedidos</p>
          </div>
        </div>
        {credsListas && rol && (
          <nav className="aq-nav">
            <button className={vista === "inicio" ? "on" : ""} onClick={() => setVista("inicio")}>Inicio</button>
            {rol !== "gerencial" && (
              <button className={vista === "nuevo" ? "on" : ""} onClick={() => setVista("nuevo")}>Nuevo pedido</button>
            )}
            {rol !== "gerencial" && (
              <button className={vista === "mantenedor" ? "on" : ""} onClick={() => setVista("mantenedor")}>{rol === "admin" ? "Mantenedores" : "Clientes"}</button>
            )}
            {rol !== "gerencial" && (
              <button className={vista === "cobranzas" ? "on" : ""} onClick={abrirCobranzas}>Cobranzas</button>
            )}
            <span className="aq-user" title={rol}>
              {perfilNombre} · {rol}
              <button className="aq-logout" onClick={cerrarSesion} aria-label="Cerrar sesión">Salir</button>
            </span>
          </nav>
        )}
      </header>

      <main className="aq-main">
        {!credsListas && (
          <div className="aq-card aq-warn">
            Falta conectar la base de datos. Pega tu URL y anon key de Supabase en <code>src/config.js</code> o
            configúralas como variables <code>VITE_</code> en Vercel.
          </div>
        )}

        {credsListas && cargando && <div className="aq-card">Cargando catálogos…</div>}
        {errorCarga && <div className="aq-card aq-error">No se pudieron cargar los datos: {errorCarga}</div>}

        {/* ===================== INICIO / DASHBOARD ===================== */}
        {credsListas && vista === "inicio" && rol !== "gerencial" && (
          <>
            <section className="aq-card aq-period">
              <button className="aq-per-nav" onClick={() => cambiarPeriodo(-1)} aria-label="Mes anterior">‹</button>
              <div className="aq-per-label">
                <span>Período</span>
                <strong>{periodoLabel}</strong>
              </div>
              <button
                className="aq-per-nav"
                onClick={() => cambiarPeriodo(1)}
                aria-label="Mes siguiente"
                disabled={periodo >= hoyPeriodo()}
              >›</button>
            </section>

            {errorDash && <div className="aq-card aq-error">No se pudo cargar el período: {errorDash}</div>}
            {cargandoDash ? (
              <div className="aq-card">Cargando período…</div>
            ) : (
              <>
                <div className="aq-kpis">
                  <button
                    className={"aq-kpi aq-kpi-btn" + (filtroEstado === "todos" ? " on" : "")}
                    onClick={() => setFiltroEstado("todos")}
                  >
                    <span>Ingresados</span><strong>{dash.ingresados}</strong>
                  </button>
                  <button
                    className={"aq-kpi aq-kpi-btn" + (filtroEstado === "enviados" ? " on" : "")}
                    onClick={() => setFiltroEstado("enviados")}
                  >
                    <span>Enviados a DT</span><strong>{dash.enviados}</strong>
                  </button>
                  <button
                    className={"aq-kpi aq-kpi-btn" + (filtroEstado === "pendientes" ? " on" : "")}
                    onClick={() => setFiltroEstado("pendientes")}
                  >
                    <span>Pendientes</span><strong>{dash.pendientes}</strong>
                  </button>
                  <button
                    className={"aq-kpi aq-kpi-btn" + (filtroEstado === "hoy" ? " on" : "")}
                    onClick={() => setFiltroEstado(filtroEstado === "hoy" ? "todos" : "hoy")}
                  >
                    <span>Para hoy</span><strong>{dash.paraHoy}</strong>
                  </button>
                </div>

                <div className="aq-money">
                  <div className="aq-money-card navy">
                    <span>Monto del mes</span>
                    <strong>{CLP(dash.monto)}</strong>
                  </div>
                  <button className="aq-money-card deuda" onClick={abrirCobranzas} title="Abrir gestión de cobro">
                    <span>Deuda por cobrar del mes</span>
                    <strong>{CLP(dash.deudaMonto)}</strong>
                    <em className="aq-money-sub">{dash.deudaCount} pedido(s) · cobrados {dash.cobrados} · recuperados {dash.recuperados} · histórico en Cobranzas</em>
                  </button>
                  <div className="aq-money-card proveedor">
                    <span>Compra Proveedor</span>
                    <strong>{CLP(dash.compraProveedor)}</strong>
                  </div>
                  <div className="aq-money-card rendicion">
                    <span>Rendición Efectivo</span>
                    <strong>{CLP(dash.rendicionEfectivo)}</strong>
                  </div>
                </div>

                <section className="aq-card">
                  <div className="aq-row-head">
                    <h2>Pedidos del período</h2>
                    <button className="aq-btn-sec" onClick={() => setVista("nuevo")}>+ Nuevo pedido</button>
                  </div>

                  <input
                    className="aq-buscar-ped"
                    placeholder="Buscar por guía, cliente o comuna…"
                    value={buscarPedido}
                    onChange={(e) => setBuscarPedido(e.target.value)}
                  />

                  {pedidosFiltrados.length === 0 ? (
                    <p className="aq-muted">
                      {pedidosMes.length === 0
                        ? `Sin pedidos en ${periodoLabel}.`
                        : "Ningún pedido coincide con el filtro."}
                    </p>
                  ) : (
                    <div className="aq-tabla">
                      {pedidosFiltrados.slice(0, 80).map((p) => {
                        const i = infoPedido(p);
                        const cobro = cobroDePedido(p);
                        return (
                          <div className="aq-tr aq-tr-click" key={p.id} onClick={() => abrirPedidoModal(p)} title="Ver detalle de entrega">
                            <div className="aq-tr-main">
                              <strong>{i.nombre}</strong>
                              <span className="aq-tr-sub">
                                {p.numero_guia || "—"}{i.comuna ? " · " + i.comuna : ""}
                              </span>
                            </div>
                            <span className="aq-tr-fecha">
                              {p.fecha_min_entrega
                                ? new Date(p.fecha_min_entrega).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })
                                : p.created_at
                                ? new Date(p.created_at).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })
                                : ""}
                            </span>
                            <span className="aq-tr-monto">
                              {CLP(p.monto_total)}
                              {p.por_cobrar && <em className="aq-pc" onClick={(e) => { e.stopPropagation(); abrirPedidoModal(p); }} title="Ver formulario de entrega / cobro">PC</em>}
                            </span>
                            {cobro
                              ? <span className={"aq-badge " + cobro.cls}>{cobro.label}</span>
                              : <span className={"aq-badge " + (p.estado_sync === "enviado_dt" ? "ok" : "warn")}>{p.estado_sync === "enviado_dt" ? "En DT" : "Pend."}</span>}
                          </div>
                        );
                      })}
                      {pedidosFiltrados.length > 80 && (
                        <p className="aq-muted" style={{ marginTop: 10 }}>
                          Mostrando 80 de {pedidosFiltrados.length}. Usa el buscador para acotar.
                        </p>
                      )}
                    </div>
                  )}
                </section>

                {!dash.tieneEstado && (
                  <p className="aq-muted">
                    El estado “Entregado” se activará cuando conectemos el retorno de DispatchTrack.
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* ===================== DASHBOARD GERENCIAL ===================== */}
        {credsListas && vista === "inicio" && rol === "gerencial" && (
          <>
            {errorGer && <div className="aq-card aq-error">No se pudo cargar el panel: {errorGer}</div>}
            {cargandoGer && !ger ? (
              <div className="aq-card">Cargando panel…</div>
            ) : ger ? (
              <>
                <div className="aq-kpis">
                  <div className="aq-kpi">
                    <span>Ingresos del mes</span><strong>{CLP(ger.mesActual.monto)}</strong>
                  </div>
                  <div className="aq-kpi">
                    <span>Pedidos del mes</span><strong>{ger.mesActual.count}</strong>
                  </div>
                  <div className="aq-kpi">
                    <span>Ticket promedio</span><strong>{CLP(ger.ticket)}</strong>
                  </div>
                  <div className={"aq-kpi" + (ger.venc30 && ger.venc30.monto > 0 ? " aq-kpi-venc" : "")}>
                    <span>Deuda +30 días</span><strong>{CLP(ger.venc30 ? ger.venc30.monto : 0)}</strong>
                  </div>
                </div>

                {/* Evolución mensual */}
                <section className="aq-card">
                  <h2>Evolución (últimos 6 meses)</h2>
                  {(() => {
                    const maxM = Math.max(1, ...ger.meses.map((m) => m.monto));
                    return (
                      <div className="aq-bars">
                        {ger.meses.map((m) => (
                          <div className="aq-bar-col" key={m.key}>
                            <div className="aq-bar-val">{m.monto ? CLP(m.monto) : ""}</div>
                            <div className="aq-bar-track">
                              <div className="aq-bar-fill" style={{ height: Math.round((m.monto / maxM) * 100) + "%" }} />
                            </div>
                            <div className="aq-bar-lab">{m.label}</div>
                            <div className="aq-bar-sub">{m.count} ped.</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </section>

                {/* Mejor mes como meta */}
                {(() => {
                  const todosM = ger.meses;
                  const mejor = todosM.reduce((mx, m) => m.monto > mx.monto ? m : mx, { monto: 0, label: "—" });
                  const actual = ger.mesActual;
                  const meta = mejor.monto;
                  const pct = meta > 0 ? Math.min(100, Math.round((actual.monto / meta) * 100)) : 0;
                  const superada = actual.monto >= meta && meta > 0;
                  return (
                    <section className="aq-card aq-meta-card">
                      <div className="aq-meta-head">
                        <div>
                          <h2>Meta del año</h2>
                          <p className="aq-muted" style={{ margin: "2px 0 0" }}>Mejor mes histórico como referencia: <strong>{mejor.label}</strong> · {CLP(meta)}</p>
                        </div>
                        <div className="aq-meta-badge" style={{ background: superada ? "#e7f6ee" : "#fff7e6", color: superada ? "#1a7a45" : "#8a6400", border: "1px solid " + (superada ? "#9bd5b4" : "#f0d8a0") }}>
                          {superada ? "🏆 Meta superada" : pct + "% de la meta"}
                        </div>
                      </div>
                      <div className="aq-meta-row">
                        <span className="aq-meta-label">Este mes</span>
                        <span className="aq-meta-val">{CLP(actual.monto)}</span>
                        <span className="aq-meta-label">Meta</span>
                        <span className="aq-meta-val">{CLP(meta)}</span>
                        <span className="aq-meta-label">Diferencia</span>
                        <span className="aq-meta-val" style={{ color: superada ? "#1a7a45" : "#b42318" }}>
                          {superada ? "+" : ""}{CLP(actual.monto - meta)}
                        </span>
                      </div>
                      {/* Bullet chart */}
                      <div className="aq-bullet">
                        <div className="aq-bullet-track">
                          <div className="aq-bullet-fill" style={{ width: pct + "%", background: superada ? "#1a9a52" : pct >= 75 ? "#00aeef" : pct >= 50 ? "#e0a400" : "#d92d20" }} />
                          <div className="aq-bullet-goal" title={"Meta: " + CLP(meta)} />
                        </div>
                        <div className="aq-bullet-labels">
                          <span>$0</span>
                          <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>{CLP(meta / 2)}</span>
                          <span>{CLP(meta)}</span>
                        </div>
                      </div>
                      <p className="aq-mini" style={{ marginTop: 6, color: "var(--muted)" }}>
                        La meta se actualiza automáticamente con el mes de mayor ingreso registrado. {superada ? "¡Nuevo récord este mes!" : `Faltan ${CLP(meta - actual.monto)} para superarla.`}
                      </p>
                    </section>
                  );
                })()}

                <div className="aq-grid2">
                  {/* Mix de productos */}
                  <section className="aq-card">
                    <h2>Mix de productos</h2>
                    {ger.mix.length === 0 ? (
                      <p className="aq-muted">Sin ventas en el período.</p>
                    ) : (() => {
                      const maxC = Math.max(1, ...ger.mix.map((p) => p.cantidad));
                      return (
                        <div className="aq-hbars">
                          {ger.mix.map((p) => (
                            <div className="aq-hbar" key={p.nombre}>
                              <div className="aq-hbar-head">
                                <span className="aq-hbar-name">{p.nombre}</span>
                                <span className="aq-hbar-num">{p.cantidad} un · {CLP(p.valor)}</span>
                              </div>
                              <div className="aq-hbar-track">
                                <div className="aq-hbar-fill" style={{ width: Math.round((p.cantidad / maxC) * 100) + "%" }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </section>

                  {/* Pedidos por comuna */}
                  <section className="aq-card">
                    <h2>Pedidos por comuna</h2>
                    {ger.comunas.length === 0 ? (
                      <p className="aq-muted">Sin pedidos en el período.</p>
                    ) : (() => {
                      const maxK = Math.max(1, ...ger.comunas.map((c) => c.count));
                      return (
                        <div className="aq-hbars">
                          {ger.comunas.map((c) => (
                            <div className="aq-hbar" key={c.comuna}>
                              <div className="aq-hbar-head">
                                <span className="aq-hbar-name">{c.comuna}</span>
                                <span className="aq-hbar-num">{c.count}</span>
                              </div>
                              <div className="aq-hbar-track">
                                <div className="aq-hbar-fill alt" style={{ width: Math.round((c.count / maxK) * 100) + "%" }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </section>
                </div>

                <p className="aq-muted">
                  Datos de los últimos 6 meses. Cumplimiento de entrega y cobranza por antigüedad se sumarán al conectar el retorno de DispatchTrack.
                </p>
              </>
            ) : (
              <div className="aq-card aq-muted">Sin datos para mostrar todavía.</div>
            )}
          </>
        )}

        {/* ===================== CONFIRMACIÓN ===================== */}
        {credsListas && vista === "confirmacion" && confirma && (
          <section className="aq-card aq-confirm">
            <div className="aq-confirm-head">
              <span className="aq-check-ico" aria-hidden>✓</span>
              <h2>Pedido {confirma.guia} ingresado</h2>
            </div>
            <pre className="aq-confirm-msg">{confirma.mensaje}</pre>
            <div className={"aq-email-line " + (confirma.emailEnviado ? "ok" : confirma.emailDestino ? "warn" : "muted")}>
              {confirma.emailEnviado
                ? `Correo enviado a ${confirma.emailDestino}.`
                : confirma.emailDestino
                ? `No se pudo enviar el correo a ${confirma.emailDestino} (revisar el puente). El pedido quedó guardado igual.`
                : "El cliente no tiene email registrado, no se envió correo."}
            </div>
            {confirma.sync !== "enviado_dt" && (
              <p className="aq-muted">Envío a DispatchTrack pendiente; el pedido quedó guardado.</p>
            )}
            <div className="aq-confirm-acts">
              <button className="aq-btn" onClick={() => { setConfirma(null); setVista("inicio"); }}>Volver al inicio</button>
              <button className="aq-btn-sec" onClick={() => { setConfirma(null); setVista("nuevo"); }}>Otro pedido</button>
            </div>
          </section>
        )}

        {/* ===================== MANTENEDORES (Bloque 4) ===================== */}
        {credsListas && !cargando && !errorCarga && vista === "mantenedor" && (
          <>
            {/* Sub-pestañas */}
            <div className="aq-subtabs">
              <button className={mantTab === "clientes" ? "on" : ""} onClick={() => { setMantTab("clientes"); setCliEdit(null); setOkCli(""); }}>Clientes</button>
              {rol === "admin" && (
                <button className={mantTab === "productos" ? "on" : ""} onClick={() => { setMantTab("productos"); setProdEdit(null); setOkProd(""); }}>Productos</button>
              )}
              {rol === "admin" && (
                <button className={mantTab === "perfiles" ? "on" : ""} onClick={() => { setMantTab("perfiles"); setPerfEdit(null); setOkPerf(""); }}>Perfiles</button>
              )}
            </div>

            {/* ---------- CLIENTES (operador agrega/edita · admin full) ---------- */}
            {mantTab === "clientes" && (
              <section className="aq-card">
                {!cliEdit ? (
                  <>
                    <div className="aq-row-head">
                      <h2>Clientes</h2>
                      <button className="aq-btn-sec" onClick={nuevoCliente}>+ Nuevo cliente</button>
                    </div>
                    <div className="aq-search">
                      <input
                        placeholder="Buscar por nombre, RUT, código o domicilio (0004-1)"
                        value={buscarMant}
                        onChange={(e) => setBuscarMant(e.target.value)}
                        autoFocus
                      />
                      {resultadosMant.length > 0 && (
                        <ul className="aq-results">
                          {resultadosMant.map((r) => (
                            <li
                              key={r.cliente.id + "|" + (r.dom?.id || "")}
                              onClick={() => { editarCliente(r.cliente); setBuscarMant(""); }}
                              className={r.cliente.bloqueado ? "aq-li-alerta" : ""}
                            >
                              <strong>{r.cliente.bloqueado ? "⚠ " : ""}{r.dom?.etiqueta || r.cliente.nombre}{r.cliente.activo === false ? " · inactivo" : ""}</strong>
                              <span>
                                {r.dom?.identificador_dt
                                  ? r.dom.identificador_dt + " · " + (r.dom.direccion || "") + (r.dom.etiqueta ? " · titular: " + r.cliente.nombre : "")
                                  : (r.cliente.codigo_cliente || r.cliente.rut || "")}
                                {r.cliente.bloqueado ? " · bloqueado" : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {okCli && <div className={"aq-result " + (okCli.startsWith("Error") ? "bad" : "ok")}>{okCli}</div>}
                    <p className="aq-muted">
                      Busca un cliente para editarlo o crea uno nuevo.
                      {rol === "operador" ? " Como operador puedes crear y editar; la baja la realiza un administrador." : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="aq-row-head">
                      <h2>{cliEdit._nuevo ? "Nuevo cliente" : "Editar cliente"}</h2>
                      <button className="aq-link" onClick={() => { setCliEdit(null); setOkCli(""); }}>Volver</button>
                    </div>
                    {!cliEdit._nuevo && semaforoCli && (
                      <div className={"aq-semaforo " + semaforoCli.cls}>
                        <span className="aq-sem-dot" />
                        Comportamiento de pago: {semaforoCli.label}
                      </div>
                    )}
                    {!cliEdit._nuevo && semaforoCli && semaforoCli.moroso && (
                      <p className="aq-mini" style={{ color: "#b42318", fontWeight: 600, margin: "-6px 0 10px" }}>
                        Cliente moroso: exigir pago anticipado en próximos pedidos.
                      </p>
                    )}
                    {!cliEdit._nuevo && (() => {
                      const doms = todosDomicilios.filter((d) => d.cliente_id === cliEdit.id);
                      return (
                        <div className="aq-contactos">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <strong>Domicilios ({doms.length})</strong>
                            {!domEdit && (
                              <button className="aq-link" onClick={() => { setDomEdit({ _nuevo: true, cliente_id: cliEdit.id, identificador_dt: "", etiqueta: "", direccion: "", comuna: "", es_principal: false }); setOkDom(""); setErrDom(""); }}>
                                + Agregar domicilio
                              </button>
                            )}
                          </div>

                          {/* Editor de domicilio */}
                          {domEdit && (
                            <div className="aq-dom-edit">
                              <strong style={{ display: "block", marginBottom: 8, color: "var(--navy)" }}>{domEdit._nuevo ? "Nuevo domicilio" : "Editar domicilio"}</strong>
                              <div className="aq-grid" style={{ gap: 8 }}>
                                <label>
                                  Identificador (NNNN-N) *
                                  <input value={domEdit.identificador_dt || ""} readOnly={!domEdit._nuevo} onChange={(e) => setDomEdit({ ...domEdit, identificador_dt: e.target.value })} placeholder="Ej: 0215-2" />
                                  {domEdit._nuevo && <span className="aq-mini">Debe ser único (ej: 0215-2, 0215-3…)</span>}
                                </label>
                                <label>
                                  Nombre contacto
                                  <input value={domEdit.etiqueta || ""} onChange={(e) => setDomEdit({ ...domEdit, etiqueta: e.target.value })} placeholder="Ej: Juan Pérez / Dpto 5" />
                                </label>
                                <label className="aq-full">
                                  Dirección *
                                  <input value={domEdit.direccion || ""} onChange={(e) => setDomEdit({ ...domEdit, direccion: e.target.value })} placeholder="Ej: Av. Providencia 1234, Dpto 5" />
                                </label>
                                <label>
                                  Comuna
                                  <input value={domEdit.comuna || ""} onChange={(e) => setDomEdit({ ...domEdit, comuna: e.target.value })} placeholder="Ej: Providencia" />
                                </label>
                              </div>
                              <label className="aq-check" style={{ marginTop: 10 }}>
                                <input type="checkbox" checked={!!domEdit.es_principal} onChange={(e) => setDomEdit({ ...domEdit, es_principal: e.target.checked })} />
                                Domicilio principal
                              </label>
                              {errDom && <div className="aq-result bad" style={{ marginTop: 8 }}>{errDom}</div>}
                              {okDom && <div className="aq-result ok" style={{ marginTop: 8 }}>{okDom}</div>}
                              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                <button className="aq-btn" style={{ flex: 1 }} disabled={guardandoDom} onClick={guardarDomicilio}>
                                  {guardandoDom ? "Guardando…" : (domEdit._nuevo ? "Agregar" : "Guardar cambios")}
                                </button>
                                <button className="aq-btn-sec" onClick={() => { setDomEdit(null); setErrDom(""); setOkDom(""); }}>Cancelar</button>
                              </div>
                            </div>
                          )}

                          {/* Lista de domicilios */}
                          {!domEdit && (
                            <ul>
                              {doms.length === 0 && <li><span className="aq-muted">Sin domicilios registrados.</span></li>}
                              {doms.map((d) => (
                                <li key={d.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                                  <div>
                                    <span className="aq-cont-nom">{d.etiqueta || "(sin nombre)"}{d.es_principal ? " · principal" : ""}</span>
                                    <span className="aq-cont-sub">{d.identificador_dt}{d.direccion ? " · " + d.direccion : ""}{d.comuna ? ", " + d.comuna : ""}</span>
                                  </div>
                                  <button className="aq-link" style={{ whiteSpace: "nowrap", fontSize: 12, marginTop: 2 }} onClick={() => { setDomEdit({ ...d, _nuevo: false }); setOkDom(""); setErrDom(""); }}>
                                    Editar
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}

                          {okDom && !domEdit && <div className="aq-result ok" style={{ marginTop: 8 }}>{okDom}</div>}
                          {doms.length > 0 && !domEdit && <span className="aq-mini" style={{ marginTop: 6, display: "block" }}>En Nuevo pedido puedes elegir a qué domicilio va el despacho.</span>}
                        </div>
                      );
                    })()}
                    <div className="aq-grid">
                      <label>Nombre<input value={cliEdit.nombre || ""} readOnly={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, nombre: e.target.value })} /></label>
                      <label>RUT<input value={cliEdit.rut || ""} readOnly={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, rut: e.target.value })} placeholder="12.345.678-9" /></label>
                      <label>Código cliente
                        <input value={cliEdit.codigo_cliente || ""} disabled readOnly title="Código correlativo, no editable" />
                        <span className="aq-mini">{cliEdit._nuevo ? "Se genera automático (formato 2212-1)" : "Correlativo, no editable"}</span>
                      </label>
                      <label>Teléfono<input value={cliEdit.telefono || ""} readOnly={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, telefono: e.target.value })} /></label>
                      <label>Email<input type="email" value={cliEdit.email || ""} readOnly={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, email: e.target.value })} placeholder="correo@cliente.cl" /></label>
                      <label>Marca
                        <select value={cliEdit.marca || ""} disabled={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, marca: e.target.value })}>
                          <option value="">—</option>
                          {MARCAS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="aq-check" style={{ marginTop: 14 }}>
                      <input type="checkbox" checked={!!cliEdit.es_empresa} disabled={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, es_empresa: e.target.checked })} />
                      Es empresa (factura)
                    </label>
                    {cliEdit.es_empresa && (
                      <div className="aq-grid" style={{ marginTop: 10 }}>
                        <label>Razón social<input value={cliEdit.razon_social || ""} readOnly={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, razon_social: e.target.value })} /></label>
                        <label>Giro<input value={cliEdit.giro || ""} readOnly={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, giro: e.target.value })} /></label>
                      </div>
                    )}
                    <label className="aq-full">Notas<textarea rows="2" readOnly={rol !== "admin"} value={cliEdit.notas || ""} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, notas: e.target.value })} /></label>
                    <label className="aq-check" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={!!cliEdit.bloqueado} onChange={(e) => setCliEdit({ ...cliEdit, bloqueado: e.target.checked })} />
                      Cliente bloqueado para comprar
                    </label>
                    {cliEdit.bloqueado && (
                      <label className="aq-full">Motivo del bloqueo
                        <textarea rows="2" value={cliEdit.motivo_bloqueo || ""} readOnly={rol !== "admin"} onChange={(e) => rol === "admin" && setCliEdit({ ...cliEdit, motivo_bloqueo: e.target.value })} placeholder="Ej: Bloqueo por no pago" />
                      </label>
                    )}
                    {rol !== "admin" && !cliEdit._nuevo && (
                      <p className="aq-mini" style={{ color: "var(--muted)", marginTop: 8 }}>Solo el administrador puede editar los datos del cliente.</p>
                    )}
                    <div className="aq-mant-acts">
                      {rol === "admin" && (
                        <button className="aq-btn" disabled={guardandoCli} onClick={guardarCliente}>
                          {guardandoCli ? "Guardando…" : (cliEdit._nuevo ? "Crear cliente" : "Guardar cambios")}
                        </button>
                      )}
                      {!cliEdit._nuevo && (
                        <button className="aq-btn-sec" disabled={cargandoHist} onClick={() => verHistorial(cliEdit)}>
                          {cargandoHist ? "Cargando…" : "Ver pedidos"}
                        </button>
                      )}
                      {rol === "admin" && !cliEdit._nuevo && cliEdit.activo !== false && (
                        <button className="aq-btn-danger" onClick={() => desactivarCliente(cliEdit)}>Desactivar</button>
                      )}
                    </div>
                    {okCli && <div className={"aq-result " + (okCli.startsWith("Error") ? "bad" : "ok")}>{okCli}</div>}

                    {/* Historial de pedidos del cliente */}
                    {errorHist && <div className="aq-result bad" style={{ marginTop: 12 }}>{errorHist}</div>}
                    {histPedidos !== null && (
                      <div className="aq-hist">
                        <div className="aq-hist-head">
                          <h3>Historial de pedidos {histPedidos.length ? `(${histPedidos.length})` : ""}</h3>
                          <button className="aq-link" onClick={() => { setHistPedidos(null); setHistAbierto(null); }}>Ocultar</button>
                        </div>
                        {histPedidos.length === 0 ? (
                          <p className="aq-muted">Este cliente no tiene pedidos registrados.</p>
                        ) : (
                          <div className="aq-tabla">
                            {histPedidos.map((p) => {
                              const entrega = p.numero_guia ? histEntregas[p.numero_guia] : null;
                              const ent = estadoEntregaDT(entrega, p);
                              const dom = domPorId[p.domicilio_id];
                              const abierto = histAbierto === p.id;
                              const its = histItems[p.id] || [];
                              const answers = answersFromRaw(entrega);
                              return (
                                <div key={p.id} className="aq-hist-ped">
                                  <div className="aq-hist-row" onClick={() => toggleHistItems(p.id)}>
                                    <div className="aq-hist-main">
                                      <strong>{p.numero_guia || "—"}</strong>
                                      <span className="aq-tr-sub">
                                        {(p.created_at ? new Date(p.created_at).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "2-digit" }) : "")}
                                        {dom?.comuna ? " · " + dom.comuna : ""}
                                        {p.tipo_pago ? " · " + p.tipo_pago : ""}
                                      </span>
                                    </div>
                                    <span className="aq-tr-monto">{CLP(p.monto_total)}{p.por_cobrar && <em className="aq-pc">PC</em>}</span>
                                    <span className={"aq-badge " + ent.cls}>{ent.label}</span>
                                    <span className="aq-hist-caret">{abierto ? "▾" : "▸"}</span>
                                  </div>
                                  {abierto && (
                                    <div className="aq-hist-det">
                                      {its.length === 0 ? (
                                        <p className="aq-muted">Cargando detalle…</p>
                                      ) : (
                                        <ul className="aq-hist-items">
                                          {its.map((l) => (
                                            <li key={l.id}>
                                              <span>{l.cantidad} × {l.nombre}{l.codigo ? " (" + l.codigo + ")" : ""}</span>
                                              <span>{CLP((Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0))}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      {/* Retorno de DispatchTrack (entrega del chofer) */}
                                      {entrega && (
                                        <div className="aq-hist-pod">
                                          <strong>Entrega (DispatchTrack)</strong>
                                          {entrega.gestionado_en && <div>Gestionado: {new Date(entrega.gestionado_en).toLocaleString("es-CL")}</div>}
                                          {entrega.contact_name && <div>Recibe / domicilio: {entrega.contact_name}</div>}
                                          {entrega.substatus && <div>Resultado: {entrega.substatus}</div>}
                                          {(entrega.bidon_pendiente !== null && entrega.bidon_pendiente !== undefined) && <div>Bidón pendiente: {entrega.bidon_pendiente}</div>}
                                          {entrega.chofer && <div>Chofer: {entrega.chofer}</div>}
                                          {entrega.ruta && <div>Ruta: {entrega.ruta}</div>}
                                          {(entrega.latitude && entrega.longitude) && (
                                            <div><a className="aq-link" href={`https://maps.google.com/?q=${entrega.latitude},${entrega.longitude}`} target="_blank" rel="noreferrer">Ver ubicación de entrega</a></div>
                                          )}
                                          {answers.length > 0 && (
                                            <div className="aq-hist-form">
                                              {answers.map((a, idx) => (
                                                <div key={idx}><em>{a.name}:</em> {/^https?:\/\//.test(a.val) ? <a className="aq-link" href={a.val} target="_blank" rel="noreferrer">ver archivo</a> : a.val}</div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {(p.cobro_cobrado || p.cobro_recuperado || (Number(p.cobro_intentos) || 0) > 0 || esPagoNo(entrega)) && (
                                        <div className="aq-hist-pago">
                                          <strong>Cobro</strong>
                                          {p.cobro_cobrado ? (
                                            <div>✓ Pagado{p.cobro_at ? " el " + new Date(p.cobro_at).toLocaleDateString("es-CL") : ""}{p.cobro_por ? " · " + p.cobro_por : ""} · {CLP(p.monto_total)}</div>
                                          ) : esPagoNo(entrega) ? (
                                            <div>Pendiente de cobro · {CLP(p.monto_total)}</div>
                                          ) : null}
                                          {p.cobro_recuperado && <div>✓ Bidón recuperado</div>}
                                          {(Number(p.cobro_intentos) || 0) > 0 && <div>Intentos de cobro: {p.cobro_intentos}</div>}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {/* ---------- PRODUCTOS (admin · pausar SKU) ---------- */}
            {mantTab === "productos" && rol === "admin" && (
              <section className="aq-card">
                {!prodEdit ? (
                  <>
                    <div className="aq-row-head">
                      <h2>Productos</h2>
                      <button className="aq-btn-sec" onClick={nuevoProducto}>+ Nuevo producto</button>
                    </div>
                    <input
                      className="aq-buscar-ped"
                      placeholder="Buscar por nombre o código (SKU)"
                      value={buscarProd}
                      onChange={(e) => setBuscarProd(e.target.value)}
                    />
                    {errorProd && <div className="aq-result bad">{errorProd}</div>}
                    {okProd && <div className={"aq-result " + (okProd.startsWith("Error") ? "bad" : "ok")}>{okProd}</div>}
                    {cargandoProd ? (
                      <p className="aq-muted">Cargando productos…</p>
                    ) : (
                      <div className="aq-list">
                        {productosAll
                          .filter((p) => {
                            const q = buscarProd.trim().toLowerCase();
                            return !q || (p.nombre || "").toLowerCase().includes(q) || (p.codigo || "").toLowerCase().includes(q);
                          })
                          .map((p) => (
                            <div className={"aq-list-row" + (p.activo ? "" : " off")} key={p.id}>
                              <div className="aq-list-main">
                                <strong>{p.nombre}</strong>
                                <span>{p.codigo}{p.familia ? " · " + p.familia : ""} · {CLP(p.precio_lista)}{p.precio_variable ? " · variable" : ""}</span>
                              </div>
                              <span className={"aq-badge " + (p.activo ? "ok" : "warn")}>{p.activo ? "Activo" : "Pausado"}</span>
                              <button className="aq-btn-sec" onClick={() => togglePausaProducto(p)}>{p.activo ? "Pausar" : "Activar"}</button>
                              <button className="aq-btn-sec" onClick={() => editarProducto(p)}>Editar</button>
                            </div>
                          ))}
                        {productosAll.length === 0 && <p className="aq-muted">Sin productos.</p>}
                      </div>
                    )}
                    <p className="aq-muted">Pausar un SKU lo deja fuera de “Nuevo pedido” sin borrarlo. Reactívalo cuando vuelva a haber stock.</p>
                  </>
                ) : (
                  <>
                    <div className="aq-row-head">
                      <h2>{prodEdit._nuevo ? "Nuevo producto" : "Editar producto"}</h2>
                      <button className="aq-link" onClick={() => { setProdEdit(null); setOkProd(""); }}>Volver</button>
                    </div>
                    <div className="aq-grid">
                      <label>Código (SKU)<input value={prodEdit.codigo || ""} onChange={(e) => setProdEdit({ ...prodEdit, codigo: e.target.value })} /></label>
                      <label>Nombre<input value={prodEdit.nombre || ""} onChange={(e) => setProdEdit({ ...prodEdit, nombre: e.target.value })} /></label>
                      <label>Familia<input value={prodEdit.familia || ""} onChange={(e) => setProdEdit({ ...prodEdit, familia: e.target.value })} /></label>
                      <label>Precio lista<input type="number" min="0" value={prodEdit.precio_lista ?? 0} onChange={(e) => setProdEdit({ ...prodEdit, precio_lista: Number(e.target.value) })} /></label>
                    </div>
                    <label className="aq-full">Descripción<textarea rows="2" value={prodEdit.descripcion || ""} onChange={(e) => setProdEdit({ ...prodEdit, descripcion: e.target.value })} /></label>
                    <div className="aq-checks">
                      <label className="aq-check"><input type="checkbox" checked={!!prodEdit.activo} onChange={(e) => setProdEdit({ ...prodEdit, activo: e.target.checked })} /> Activo (aparece en Nuevo pedido)</label>
                      <label className="aq-check"><input type="checkbox" checked={!!prodEdit.precio_variable} onChange={(e) => setProdEdit({ ...prodEdit, precio_variable: e.target.checked })} /> Precio variable</label>
                      <label className="aq-check"><input type="checkbox" checked={!!prodEdit.requiere_factura} onChange={(e) => setProdEdit({ ...prodEdit, requiere_factura: e.target.checked })} /> Requiere factura</label>
                    </div>
                    <div className="aq-grid" style={{ marginTop: 10 }}>
                      <label>Descuento por volumen
                        <select value={prodEdit.modo_descuento_volumen || "ninguno"} onChange={(e) => setProdEdit({ ...prodEdit, modo_descuento_volumen: e.target.value })}>
                          <option value="ninguno">Ninguno</option>
                          <option value="porcentaje">Porcentaje</option>
                          <option value="tramos">Tramos (se gestionan aparte)</option>
                        </select>
                      </label>
                      {prodEdit.modo_descuento_volumen === "porcentaje" && (
                        <>
                          <label>Umbral (cant.)<input type="number" min="0" value={prodEdit.desc_volumen_umbral ?? ""} onChange={(e) => setProdEdit({ ...prodEdit, desc_volumen_umbral: e.target.value })} /></label>
                          <label>% descuento<input type="number" min="0" max="100" value={prodEdit.desc_volumen_pct ?? ""} onChange={(e) => setProdEdit({ ...prodEdit, desc_volumen_pct: e.target.value })} /></label>
                        </>
                      )}
                    </div>
                    {prodEdit.modo_descuento_volumen === "tramos" && (
                      <p className="aq-muted">Los tramos de precio se cargan en la tabla <code>precio_tramos</code> (no editable en este mantenedor todavía).</p>
                    )}
                    <button className="aq-btn" disabled={guardandoProd} onClick={guardarProducto}>
                      {guardandoProd ? "Guardando…" : (prodEdit._nuevo ? "Crear producto" : "Guardar cambios")}
                    </button>
                    {okProd && <div className={"aq-result " + (okProd.startsWith("Error") ? "bad" : "ok")}>{okProd}</div>}
                  </>
                )}
              </section>
            )}

            {/* ---------- PERFILES (admin) ---------- */}
            {mantTab === "perfiles" && rol === "admin" && (
              <section className="aq-card">
                {!perfEdit ? (
                  <>
                    <div className="aq-row-head"><h2>Perfiles de acceso</h2></div>
                    {errorPerf && <div className="aq-result bad">{errorPerf}</div>}
                    {okPerf && <div className={"aq-result " + (okPerf.startsWith("Error") ? "bad" : "ok")}>{okPerf}</div>}
                    {cargandoPerf ? (
                      <p className="aq-muted">Cargando perfiles…</p>
                    ) : (
                      <div className="aq-list">
                        {perfiles.map((p) => (
                          <div className={"aq-list-row" + (p.activo ? "" : " off")} key={p.id}>
                            <div className="aq-list-main">
                              <strong>{p.nombre || "(sin nombre)"}{session && p.id === session.user.id ? " · tú" : ""}</strong>
                              <span>rol: {p.rol}{p.activo ? "" : " · inactivo"}</span>
                            </div>
                            <span className={"aq-badge " + (p.activo ? "ok" : "warn")}>{p.activo ? "Activo" : "Inactivo"}</span>
                            <button className="aq-btn-sec" onClick={() => editarPerfil(p)}>Editar</button>
                          </div>
                        ))}
                        {perfiles.length === 0 && (
                          <p className="aq-muted">No se ven perfiles. Si esperabas ver más, falta la política RLS de lectura de admin en <code>perfiles</code> (te dejo el SQL en el chat).</p>
                        )}
                      </div>
                    )}
                    <p className="aq-muted">
                      Para <strong>crear</strong> un acceso nuevo: primero crea el usuario en Supabase (Authentication → Add user) y luego asígnale rol aquí. La creación de logins no se hace desde la app por seguridad.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="aq-row-head">
                      <h2>Editar perfil</h2>
                      <button className="aq-link" onClick={() => { setPerfEdit(null); setOkPerf(""); }}>Volver</button>
                    </div>
                    <div className="aq-grid">
                      <label>Nombre<input value={perfEdit.nombre || ""} onChange={(e) => setPerfEdit({ ...perfEdit, nombre: e.target.value })} /></label>
                      <label>Rol
                        <select value={perfEdit.rol} onChange={(e) => setPerfEdit({ ...perfEdit, rol: e.target.value })}>
                          <option value="admin">admin</option>
                          <option value="operador">operador</option>
                          <option value="gerencial">gerencial</option>
                        </select>
                      </label>
                    </div>
                    <label className="aq-check" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={!!perfEdit.activo} onChange={(e) => setPerfEdit({ ...perfEdit, activo: e.target.checked })} />
                      Perfil activo
                    </label>
                    {session && perfEdit.id === session.user.id && (
                      <p className="aq-muted">Es tu propio usuario: no puedes quitarte el rol admin ni desactivarte.</p>
                    )}
                    <button className="aq-btn" disabled={guardandoPerf} onClick={guardarPerfil}>
                      {guardandoPerf ? "Guardando…" : "Guardar cambios"}
                    </button>
                    {okPerf && <div className={"aq-result " + (okPerf.startsWith("Error") ? "bad" : "ok")}>{okPerf}</div>}
                  </>
                )}
              </section>
            )}
          </>
        )}

        {/* ===================== COBRANZAS (gestión de cobro) ===================== */}
        {credsListas && vista === "cobranzas" && rol !== "gerencial" && (
          <section className="aq-card">
            <div className="aq-row-head">
              <h2>Gestión de cobro</h2>
              <button className="aq-link" onClick={() => setVista("inicio")}>Volver</button>
            </div>
            <p className="aq-muted">Pedidos entregados con <strong>Pago = No</strong> en el formulario del chofer. Marca Cobrado y/o Recuperado, o registra un intento. Más de 3 intentos sin cobrar bloquea al cliente.</p>

            <div className="aq-subtabs" style={{ marginTop: 4 }}>
              <button className={filtroCob === "pendientes" ? "on" : ""} onClick={() => setFiltroCob("pendientes")}>Pendientes</button>
              <button className={filtroCob === "gestionados" ? "on" : ""} onClick={() => setFiltroCob("gestionados")}>Cobrados</button>
              <button className={filtroCob === "todos" ? "on" : ""} onClick={() => setFiltroCob("todos")}>Todos</button>
            </div>

            {errorCob && <div className="aq-result bad" style={{ marginTop: 10 }}>{errorCob}</div>}
            {okCob && <div className="aq-result ok" style={{ marginTop: 10 }}>{okCob}</div>}

            {!cargandoCob && (cobranzas || []).length > 0 && (
              <div className="aq-cob-resumen">
                <div className="aq-cob-rcard">
                  <span>Deuda generada</span>
                  <strong>{CLP(cobResumen.generada)}</strong>
                  <em>{cobResumen.total} pedido(s) impagos</em>
                </div>
                <div className="aq-cob-rcard ok">
                  <span>Recuperado (cobrado)</span>
                  <strong>{CLP(cobResumen.cobrado)}</strong>
                  <em>{cobResumen.recCount} con bidón recuperado</em>
                </div>
                <div className="aq-cob-rcard pend">
                  <span>Pendiente</span>
                  <strong>{CLP(cobResumen.pend)}</strong>
                  <em>{cobResumen.pendCount} pedido(s)</em>
                </div>
                <div className={"aq-cob-rcard" + (cobResumen.venc > 0 ? " venc" : "")}>
                  <span>Deuda +30 días</span>
                  <strong>{CLP(cobResumen.venc)}</strong>
                  <em>{cobResumen.vencCount} pedido(s) vencidos</em>
                </div>
              </div>
            )}

            {cargandoCob ? (
              <p className="aq-muted" style={{ marginTop: 12 }}>Cargando…</p>
            ) : (cobranzas || []).length === 0 ? (
              <p className="aq-muted" style={{ marginTop: 12 }}>No hay entregas con Pago = No.</p>
            ) : cobGrupos.length === 0 ? (
              <p className="aq-muted" style={{ marginTop: 12 }}>Nada en este filtro.</p>
            ) : (
              <div className="aq-tabla" style={{ marginTop: 6 }}>
                {cobGrupos.map((g) => {
                  const cli = clientePorId[g.clienteId];
                  const abierto = !!cobExpand[g.clienteId];
                  const vencido = g.diasMax > 30;
                  return (
                    <div className="aq-cob-grupo" key={g.clienteId}>
                      <div className="aq-cob-grow" onClick={() => setCobExpand((prev) => ({ ...prev, [g.clienteId]: !prev[g.clienteId] }))}>
                        <div className="aq-cob-main">
                          <strong>{cli?.nombre || "Cliente"}{cli?.bloqueado ? " · ⚠ bloqueado" : ""}</strong>
                          <span className="aq-tr-sub">
                            {g.count} pedido(s) impago(s)
                            {g.diasMax > 0 ? " · más antiguo " + g.diasMax + " días" : ""}
                          </span>
                        </div>
                        <span className="aq-tr-monto">{CLP(g.deuda)}</span>
                        {vencido && <span className="aq-badge bad">+30 días</span>}
                        <span className="aq-hist-caret">{abierto ? "▾" : "▸"}</span>
                      </div>
                      {abierto && (
                        <div className="aq-cob-orders">
                          {g.orders.map(({ pedido: p, entrega: e }) => {
                            const dom = domPorId[p.domicilio_id];
                            const intentos = Number(p.cobro_intentos) || 0;
                            const enProceso = guardandoCob === p.id;
                            const dias = e?.gestionado_en ? Math.floor((Date.now() - new Date(e.gestionado_en).getTime()) / 86400000) : null;
                            return (
                              <div className="aq-cob" key={p.id}>
                                <div className="aq-cob-head">
                                  <div className="aq-cob-main">
                                    <strong>{p.numero_guia || "—"}</strong>
                                    <span className="aq-tr-sub">
                                      {(dom?.comuna || e?.contact_name) ? (dom?.comuna || e?.contact_name) : ""}
                                      {e?.gestionado_en ? " · " + new Date(e.gestionado_en).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : ""}
                                      {dias != null ? " · " + dias + " días" : ""}
                                    </span>
                                  </div>
                                  <span className="aq-tr-monto">{CLP(p.monto_total || montoEntrega(e))}</span>
                                </div>
                                <div className="aq-cob-badges">
                                  <span className={"aq-badge " + (p.cobro_cobrado ? "ok" : "warn")}>{p.cobro_cobrado ? "Cobrado" : "No cobrado"}</span>
                                  <span className={"aq-badge " + (p.cobro_recuperado ? "ok" : "warn")}>{p.cobro_recuperado ? "Recuperado" : "No recuperado"}</span>
                                  <span className={"aq-badge " + (intentos > 3 ? "bad" : "")}>Intentos: {intentos}</span>
                                </div>
                                <div className="aq-cob-acts">
                                  <button className={"aq-btn-sec" + (p.cobro_cobrado ? " on" : "")} disabled={enProceso} onClick={() => marcarCobroCampo(p, "cobro_cobrado")}>
                                    {p.cobro_cobrado ? "✓ Cobrado" : "Marcar cobrado"}
                                  </button>
                                  <button className={"aq-btn-sec" + (p.cobro_recuperado ? " on" : "")} disabled={enProceso} onClick={() => marcarCobroCampo(p, "cobro_recuperado")}>
                                    {p.cobro_recuperado ? "✓ Recuperado" : "Marcar recuperado"}
                                  </button>
                                  <button className="aq-btn-sec" disabled={enProceso || p.cobro_cobrado} onClick={() => registrarIntento(p)}>
                                    + Intento de cobro
                                  </button>
                                  <button className="aq-link" onClick={() => abrirPedidoModal(p)}>Ver detalle</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ===================== NUEVO PEDIDO ===================== */}
        {credsListas && !cargando && !errorCarga && vista === "nuevo" && (
          <>
            {/* Cliente */}
            <section className="aq-card">
              <h2>Cliente</h2>
              {!cliente ? (
                <div className="aq-search">
                  <input
                    placeholder="Buscar por nombre, RUT o código"
                    value={buscarCliente}
                    onChange={(e) => setBuscarCliente(e.target.value)}
                    autoFocus
                  />
                  {resultadosBusqueda.length > 0 && (
                    <ul className="aq-results">
                      {resultadosBusqueda.map((r) => (
                        <li
                          key={r.cliente.id + "|" + (r.dom?.id || "")}
                          onClick={() => elegirCliente(r.cliente, r.dom?.id)}
                          className={r.cliente.bloqueado ? "aq-li-alerta" : ""}
                        >
                          <strong>{r.cliente.bloqueado ? "⚠ " : ""}{r.dom?.etiqueta || r.cliente.nombre}</strong>
                          <span>
                            {r.dom?.identificador_dt
                              ? r.dom.identificador_dt + " · " + (r.dom.direccion || "") + (r.dom.etiqueta ? " · titular: " + r.cliente.nombre : "")
                              : (r.cliente.rut || r.cliente.codigo_cliente)}
                            {r.cliente.es_empresa ? " · empresa" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <>
                  <div className="aq-chosen">
                    <div>
                      <strong>{cliente.nombre}</strong>
                      <span>{cliente.rut || cliente.codigo_cliente}{cliente.es_empresa ? " · empresa" : ""}</span>
                    </div>
                    <button className="aq-link" onClick={() => { setCliente(null); setItems([]); setDescuentos([]); setAvisoRepetir(""); setAvisoDeuda(null); setSemaforoCli(null); }}>
                      Cambiar
                    </button>
                  </div>
                  {!emailValido(cliente.email) && (
                    <div className="aq-email-alert">
                      <strong>⚠ Sin email registrado</strong>
                      <p>Agrega un correo para enviarle la confirmación del pedido.</p>
                      <div className="aq-email-add">
                        <input
                          type="email"
                          placeholder="correo@cliente.cl"
                          value={emailNuevo}
                          onChange={(e) => setEmailNuevo(e.target.value)}
                        />
                        <button className="aq-btn-sec" disabled={!emailValido(emailNuevo) || guardandoEmail} onClick={guardarEmailCliente}>
                          {guardandoEmail ? "…" : "Guardar email"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {cliente && cliente.bloqueado && (
              <div className="aq-alerta-cliente">
                <strong>⚠ Cliente con alerta</strong>
                <p>{cliente.motivo_bloqueo || "Cliente marcado para revisión."}</p>
                <span>Revisa antes de continuar con el pedido.</span>
              </div>
            )}

            {cliente && !cliente.bloqueado && avisoDeuda && (
              <div className="aq-alerta-deuda">
                <strong>⚠ Deuda pendiente</strong>
                <p>Este cliente tiene {avisoDeuda.guias.length} entrega(s) sin pagar por {CLP(avisoDeuda.monto)} (guía(s): {avisoDeuda.guias.join(", ")}).</p>
                <span>Puedes continuar, pero conviene gestionarlo en Cobranzas.</span>
              </div>
            )}

            {cliente && semaforoCli && (
              <div className={"aq-semaforo " + semaforoCli.cls} style={{ marginBottom: 14 }}>
                <span className="aq-sem-dot" />
                Comportamiento de pago: {semaforoCli.label}
              </div>
            )}

            {cliente && semaforoCli && semaforoCli.moroso && (
              <div className="aq-alerta-cliente" style={{ marginTop: -4 }}>
                <strong>⚠ Cliente moroso — exigir pago anticipado</strong>
                <p>Este cliente tiene historial de mora (más de 15 días en pagar). Se recomienda cobrar por adelantado antes de despachar.</p>
              </div>
            )}

            {cliente && (
              <>
                {/* Repetir última compra (Bloque 5) */}
                <section className="aq-card aq-repetir">
                  <div className="aq-repetir-row">
                    <div>
                      <strong>Repetir última compra</strong>
                      <p className="aq-muted">Carga productos, cantidades, domicilio y forma de pago del último pedido de este cliente.</p>
                    </div>
                    <button className="aq-btn-sec" disabled={repitiendo} onClick={repetirUltimaCompra}>
                      {repitiendo ? "Cargando…" : "↻ Repetir"}
                    </button>
                  </div>
                  {avisoRepetir && (
                    <div className={"aq-result " + (avisoRepetir.startsWith("Error") ? "bad" : "ok")} style={{ marginTop: 10 }}>
                      {avisoRepetir}
                    </div>
                  )}
                </section>

                {/* Domicilio */}
                <section className="aq-card">
                  <h2>Domicilio de entrega</h2>
                  {domicilios.length === 0 ? (
                    <p className="aq-muted">Este cliente no tiene domicilios cargados.</p>
                  ) : (
                    <select value={domicilioId} onChange={(e) => setDomicilioId(e.target.value)}>
                      {domicilios.map((d) => (
                        <option key={d.id} value={d.id}>
                          {(d.etiqueta ? d.etiqueta + " · " : "") + (d.identificador_dt ? d.identificador_dt + " · " : "") + d.direccion + (d.comuna ? ", " + d.comuna : "")}
                          {d.es_principal ? " (principal)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </section>

                {/* Plan prepago */}
                {planPrepago && (
                  <section className="aq-card aq-plan">
                    <h2>Plan prepago activo</h2>
                    <p>
                      Saldo disponible: <strong>{planPrepago.unidades_saldo} recargas</strong>
                      {planPrepago.fecha_vencimiento ? ` · vence ${planPrepago.fecha_vencimiento}` : ""}
                    </p>
                    <label className="aq-check">
                      <input type="checkbox" checked={consumePlan} onChange={(e) => setConsumePlan(e.target.checked)} />
                      Consumir saldo del plan en este pedido
                    </label>
                    {consumePlan && (
                      <p className="aq-muted">
                        Este pedido descuenta <strong>{unidadesPlan}</strong> recarga(s) R20 del saldo.
                      </p>
                    )}
                  </section>
                )}

                {/* Productos */}
                <section className="aq-card">
                  <div className="aq-row-head">
                    <h2>Productos</h2>
                    <button className="aq-btn-sec" onClick={agregarItem}>+ Agregar línea</button>
                  </div>
                  {items.length === 0 ? (
                    <p className="aq-muted">Agrega los productos del pedido.</p>
                  ) : (
                    <div className="aq-items">
                      {items.map((it) => {
                        const prod = productos.find((p) => p.id === it.producto_id);
                        const variable = prod?.precio_variable;
                        return (
                          <div className="aq-item" key={it.key}>
                            <select value={it.producto_id} onChange={(e) => cambiarProducto(it.key, e.target.value)}>
                              {productos.map((p) => (
                                <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>
                              ))}
                            </select>
                            <input
                              className="aq-num"
                              type="number"
                              min="0"
                              step="1"
                              value={it.cantidad}
                              onChange={(e) => cambiarCantidad(it.key, Number(e.target.value))}
                              aria-label="Cantidad"
                            />
                            <input
                              className="aq-num"
                              type="number"
                              min="0"
                              value={it.precio_unit}
                              onChange={(e) => cambiarPrecio(it.key, Number(e.target.value))}
                              aria-label="Precio unitario"
                              title={variable ? "Precio editable" : "Precio sugerido (editable)"}
                            />
                            <span className="aq-sub">{CLP(Math.round((it.cantidad || 0) * (it.precio_unit || 0)))}</span>
                            <button className="aq-x" onClick={() => quitarItem(it.key)} aria-label="Quitar">×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Descuentos */}
                <section className="aq-card">
                  <div className="aq-row-head">
                    <h2>Descuentos</h2>
                    <button className="aq-btn-sec" onClick={() => agregarDescuento()}>+ Agregar</button>
                  </div>
                  {descCliente.length > 0 && (
                    <div className="aq-suggest">
                      <span className="aq-muted">Sugeridos del cliente:</span>
                      {descCliente.map((d) => (
                        <button
                          key={d.id}
                          className="aq-chip"
                          onClick={() => agregarDescuento({ origen: "cliente", descripcion: d.motivo || d.tipo, monto: d.valor })}
                        >
                          {(d.motivo || d.tipo)} · {CLP(d.valor)}
                        </button>
                      ))}
                    </div>
                  )}
                  {descuentos.map((d) => (
                    <div className="aq-desc" key={d.key}>
                      <select value={d.origen} onChange={(e) => cambiarDescuento(d.key, "origen", e.target.value)}>
                        {ORIGENES_DESC.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input
                        placeholder="Descripción"
                        value={d.descripcion}
                        onChange={(e) => cambiarDescuento(d.key, "descripcion", e.target.value)}
                      />
                      <input
                        className="aq-num"
                        type="number"
                        min="0"
                        value={d.monto}
                        onChange={(e) => cambiarDescuento(d.key, "monto", Number(e.target.value))}
                        aria-label="Monto"
                      />
                      <button className="aq-x" onClick={() => quitarDescuento(d.key)} aria-label="Quitar">×</button>
                    </div>
                  ))}
                </section>

                {/* Documento y pago */}
                <section className="aq-card">
                  <h2>Documento y pago</h2>
                  <div className="aq-grid">
                    <label>
                      Documento
                      <select value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
                        {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label>
                      Forma de pago
                      <select value={tipoPago} onChange={(e) => setTipoPago(e.target.value)} disabled={consumePlan}>
                        {TIPOS_PAGO.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    {tipoDocumento === "factura" && (
                      <label>
                        RUT facturación
                        <input value={rutFactura} onChange={(e) => setRutFactura(e.target.value)} placeholder="76.123.456-7" />
                      </label>
                    )}
                    <label>
                      Marca
                      <select value={marca} onChange={(e) => setMarca(e.target.value)}>
                        <option value="">—</option>
                        {MARCAS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                  </div>
                </section>

                {/* Entrega y notas */}
                <section className="aq-card">
                  <h2>Entrega</h2>
                  <div className="aq-grid">
                    <label>
                      Desde
                      <input type="datetime-local" value={fechaMin} onChange={(e) => setFechaMin(e.target.value)} />
                    </label>
                    <label>
                      Hasta
                      <input type="datetime-local" value={fechaMax} onChange={(e) => setFechaMax(e.target.value)} />
                    </label>
                    <label>
                      Operador
                      <input value={creadoPor} onChange={(e) => setCreadoPor(e.target.value)} placeholder="Tu nombre" />
                    </label>
                  </div>
                  <label className="aq-full">
                    Observación
                    <textarea rows="2" value={observacion} onChange={(e) => setObservacion(e.target.value)} />
                  </label>
                </section>

                {/* Resumen */}
                <section className="aq-card aq-resumen">
                  <div className="aq-tot">
                    <span>Subtotal</span><span>{CLP(subtotal)}</span>
                  </div>
                  {totalDesc > 0 && (
                    <div className="aq-tot aq-tot-desc">
                      <span>Descuentos</span><span>−{CLP(totalDesc)}</span>
                    </div>
                  )}
                  <div className="aq-tot aq-tot-total">
                    <span>Total</span><span>{CLP(montoTotal)}</span>
                  </div>

                  {errorValidacion && <p className="aq-hint">{errorValidacion}</p>}

                  <button className="aq-btn" disabled={!!errorValidacion || guardando} onClick={guardarPedido}>
                    {guardando ? "Guardando…" : "Guardar pedido"}
                  </button>

                  {resultado && (
                    <div className={"aq-result " + (resultado.ok ? "ok" : "bad")}>
                      {resultado.msg}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
        {/* ===================== POPUP DETALLE DE ENTREGA ===================== */}
        {pedidoModal && (
          <div className="aq-modal-ov" onClick={() => setPedidoModal(null)}>
            <div className="aq-modal" onClick={(e) => e.stopPropagation()}>
              <div className="aq-modal-head">
                <div>
                  <strong>{pedidoModal.pedido.numero_guia || "Pedido"}</strong>
                  <span className="aq-tr-sub">
                    {(clientePorId[pedidoModal.pedido.cliente_id]?.nombre || "")}
                    {" · "}{CLP(pedidoModal.pedido.monto_total)}
                    {pedidoModal.pedido.por_cobrar ? " · Por cobrar" : ""}
                  </span>
                </div>
                <button className="aq-link" onClick={() => setPedidoModal(null)}>Cerrar ✕</button>
              </div>

              {renderEntregaDT(pedidoModal.entrega)}

              {esPagoNo(pedidoModal.entrega) && (
                <div className="aq-modal-cobro">
                  <strong>{pedidoModal.pedido.cobro_cobrado ? "✓ Deuda cobrada" : "⚠ Entregado sin pago — por cobrar"}</strong>
                  <div className="aq-cob-badges" style={{ marginTop: 6 }}>
                    <span className={"aq-badge " + (pedidoModal.pedido.cobro_cobrado ? "ok" : "warn")}>{pedidoModal.pedido.cobro_cobrado ? "Cobrado" : "No cobrado"}</span>
                    <span className={"aq-badge " + (pedidoModal.pedido.cobro_recuperado ? "ok" : "warn")}>{pedidoModal.pedido.cobro_recuperado ? "Recuperado" : "No recuperado"}</span>
                    <span className="aq-badge">Intentos: {Number(pedidoModal.pedido.cobro_intentos) || 0}</span>
                  </div>
                  <button className="aq-btn-sec" style={{ marginTop: 10 }} onClick={() => { setPedidoModal(null); abrirCobranzas(); }}>
                    Ir a gestión de cobro →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap');
* { box-sizing: border-box; }
.aq { --navy:#1B2F6E; --blue:#5B8DB8; --ink:#1d2433; --muted:#6b7686; --line:#e3e8f0; --bg:#f4f6fb; --ok:#1f7a4d; --bad:#b3261e;
  font-family:'Hanken Grotesk',system-ui,sans-serif; color:var(--ink); background:var(--bg); min-height:100vh; }
.aq-header { background:var(--navy); color:#fff; padding:18px 20px; }
.aq-brand { display:flex; align-items:center; gap:14px; }
.aq-mark { font-size:30px; color:var(--blue); line-height:1; }
.aq-header h1 { font-family:'Fraunces',serif; font-weight:600; font-size:22px; margin:0; letter-spacing:.2px; }
.aq-header p { margin:0; font-size:13px; color:#c5d2e8; }
.aq-main { max-width:1200px; margin:0 auto; padding:18px 24px 60px; display:flex; flex-direction:column; gap:14px; }
.aq-card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px 18px; }
.aq-card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--navy); margin:0 0 12px; font-weight:700; }
.aq-row-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
.aq-row-head h2 { margin:0; }
.aq-muted { color:var(--muted); font-size:14px; margin:4px 0 0; }
input, select, textarea { font-family:inherit; font-size:15px; width:100%; padding:10px 12px; border:1px solid var(--line);
  border-radius:9px; background:#fff; color:var(--ink); }
input:focus, select:focus, textarea:focus { outline:2px solid var(--blue); outline-offset:0; border-color:var(--blue); }
.aq-search { position:relative; }
.aq-results { list-style:none; margin:6px 0 0; padding:6px; border:1px solid var(--line); border-radius:10px; background:#fff;
  position:absolute; left:0; right:0; z-index:5; box-shadow:0 8px 24px rgba(27,47,110,.12); }
.aq-results li { padding:9px 10px; border-radius:7px; cursor:pointer; display:flex; flex-direction:column; }
.aq-results li:hover { background:var(--bg); }
.aq-results li span { font-size:12px; color:var(--muted); }
.aq-li-alerta strong { color:var(--bad); }
.aq-alerta-cliente { background:#fdecea; border:1px solid #f3b4ad; border-left:4px solid var(--bad); border-radius:12px; padding:14px 16px; }
.aq-alerta-cliente strong { color:var(--bad); display:block; font-size:14px; }
.aq-alerta-cliente p { margin:6px 0 4px; color:var(--ink); font-size:15px; font-weight:600; }
.aq-alerta-cliente span { font-size:13px; color:var(--muted); }
.aq-chosen { display:flex; justify-content:space-between; align-items:center; }
.aq-chosen strong { display:block; }
.aq-chosen span { font-size:13px; color:var(--muted); }
.aq-link { background:none; border:none; color:var(--blue); font:inherit; cursor:pointer; text-decoration:underline; }
.aq-plan { border-color:var(--blue); background:#f3f8fc; }
.aq-plan p { margin:0 0 10px; font-size:14px; }
.aq-check { display:flex; align-items:center; gap:8px; font-size:14px; cursor:pointer; }
.aq-check input { width:auto; }
.aq-items { display:flex; flex-direction:column; gap:8px; }
.aq-item { display:grid; grid-template-columns: 1fr 70px 92px 84px 28px; gap:8px; align-items:center; }
.aq-num { text-align:right; }
.aq-sub { font-size:14px; font-weight:600; text-align:right; }
.aq-x { width:28px; height:28px; border-radius:7px; border:1px solid var(--line); background:#fff; color:var(--bad);
  font-size:18px; line-height:1; cursor:pointer; padding:0; }
.aq-x:hover { background:#fdecea; }
.aq-btn-sec { background:#fff; border:1px solid var(--blue); color:var(--navy); font:inherit; font-weight:600; font-size:13px;
  padding:7px 12px; border-radius:9px; cursor:pointer; }
.aq-btn-sec:hover { background:#eef4fa; }
.aq-suggest { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
.aq-chip { border:1px dashed var(--blue); background:#f3f8fc; color:var(--navy); font:inherit; font-size:12px; padding:5px 10px;
  border-radius:20px; cursor:pointer; }
.aq-desc { display:grid; grid-template-columns: 120px 1fr 100px 28px; gap:8px; align-items:center; margin-top:8px; }
.aq-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.aq-grid label, .aq-full { display:flex; flex-direction:column; gap:5px; font-size:13px; color:var(--muted); font-weight:500; }
.aq-full { margin-top:12px; }
.aq-resumen { position:sticky; bottom:0; }
.aq-tot { display:flex; justify-content:space-between; font-size:15px; padding:4px 0; }
.aq-tot-desc { color:var(--bad); }
.aq-tot-total { font-size:19px; font-weight:700; color:var(--navy); border-top:1px solid var(--line); margin-top:6px; padding-top:10px; }
.aq-hint { color:var(--bad); font-size:13px; margin:8px 0 0; }
.aq-btn { width:100%; margin-top:14px; background:var(--navy); color:#fff; border:none; font:inherit; font-weight:700; font-size:16px;
  padding:14px; border-radius:11px; cursor:pointer; }
.aq-btn:hover:not(:disabled) { background:#16265a; }
.aq-btn:disabled { opacity:.5; cursor:not-allowed; }
.aq-result { margin-top:12px; padding:11px 13px; border-radius:9px; font-size:14px; }
.aq-result.ok { background:#e8f5ee; color:var(--ok); }
.aq-result.bad { background:#fdecea; color:var(--bad); }
.aq-warn { background:#fff7e6; border-color:#f0d8a0; color:#7a5a00; }
.aq-error { background:#fdecea; border-color:#f3c4bf; color:var(--bad); }
code { background:#eef1f7; padding:1px 5px; border-radius:5px; font-size:13px; }

/* Logo + navegación */
.aq-logo { width:42px; height:42px; border-radius:10px; background:#fff; object-fit:contain; padding:3px; }
.aq-header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:14px 24px; }
.aq-nav { display:flex; gap:6px; max-width:760px; }
.aq-nav button { background:rgba(255,255,255,.12); color:#dce6f6; border:none; font:inherit; font-weight:600; font-size:13px;
  padding:7px 13px; border-radius:9px; cursor:pointer; }
.aq-nav button:hover { background:rgba(255,255,255,.2); }
.aq-nav button.on { background:#fff; color:var(--navy); }
.aq-user { display:flex; align-items:center; gap:8px; color:#c5d2e8; font-size:12px; margin-left:6px; }
.aq-logout { background:rgba(255,255,255,.12); color:#fff; border:none; font:inherit; font-size:12px; font-weight:600;
  padding:6px 11px; border-radius:8px; cursor:pointer; }
.aq-logout:hover { background:rgba(255,255,255,.24); }

/* Login */
.aq-login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
.aq-login { background:#fff; border:1px solid var(--line); border-radius:16px; padding:28px 26px; width:100%; max-width:360px;
  display:flex; flex-direction:column; text-align:center; }
.aq-logo-big { width:84px; height:84px; object-fit:contain; margin:0 auto 8px; }
.aq-login h1 { font-family:'Fraunces',serif; font-weight:600; font-size:24px; color:var(--navy); margin:0; }
.aq-login-sub { color:var(--muted); font-size:14px; margin:2px 0 18px; }
.aq-login label { text-align:left; margin-top:0; margin-bottom:12px; }
.aq-login .aq-btn { margin-top:4px; }

/* Período */
.aq-period { display:flex; align-items:center; justify-content:space-between; }
.aq-per-nav { width:38px; height:38px; border-radius:9px; border:1px solid var(--line); background:#fff; color:var(--navy);
  font-size:22px; line-height:1; cursor:pointer; }
.aq-per-nav:disabled { opacity:.4; cursor:not-allowed; }
.aq-per-label { text-align:center; }
.aq-per-label span { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
.aq-per-label strong { font-family:'Fraunces',serif; font-size:20px; color:var(--navy); }

/* KPIs (clicables = filtro) */
.aq-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
.aq-kpi { background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px; text-align:left; }
.aq-kpi span { display:block; font-size:12px; color:var(--muted); margin-bottom:2px; }
.aq-kpi strong { font-family:'Fraunces',serif; font-size:26px; color:var(--navy); line-height:1; }
.aq-kpi-btn { cursor:pointer; font:inherit; transition:border-color .12s, box-shadow .12s; }
.aq-kpi-btn:hover { border-color:var(--blue); }
.aq-kpi-btn.on { border-color:var(--navy); box-shadow:inset 0 0 0 1px var(--navy); }
.aq-kpi-btn.on::after { content:""; display:block; height:3px; width:24px; background:var(--navy); border-radius:2px; margin-top:8px; }

/* Tarjetas de monto */
.aq-money { display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:10px; }
.aq-money-card { border-radius:14px; padding:16px 18px; }
.aq-money-card span { display:block; font-size:12px; margin-bottom:2px; }
.aq-money-card strong { font-family:'Fraunces',serif; font-size:28px; line-height:1; }
.aq-money-card.navy { background:var(--navy); }
.aq-money-card.navy span { color:#c5d2e8; }
.aq-money-card.navy strong { color:#fff; }
.aq-money-card.cobrar { background:#fff7e6; border:1px solid #f0d8a0; }
.aq-money-card.cobrar span { color:#7a5a00; }
.aq-money-card.cobrar strong { color:#8a6400; }

/* Dashboard gerencial: grilla y gráficos de barras */
.aq-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.aq-bars { display:flex; align-items:flex-end; gap:10px; height:200px; padding-top:8px; }
.aq-bar-col { flex:1; display:flex; flex-direction:column; align-items:center; height:100%; }
.aq-bar-val { font-size:11px; color:var(--muted); height:16px; white-space:nowrap; }
.aq-bar-track { flex:1; width:100%; display:flex; align-items:flex-end; }
.aq-bar-fill { width:100%; background:var(--navy); border-radius:7px 7px 0 0; min-height:3px; transition:height .3s; }
.aq-bar-lab { font-size:12px; font-weight:600; color:var(--ink); margin-top:6px; }
.aq-bar-sub { font-size:11px; color:var(--muted); }
.aq-hbars { display:flex; flex-direction:column; gap:11px; }
.aq-hbar-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:4px; }
.aq-hbar-name { font-size:13px; color:var(--ink); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.aq-hbar-num { font-size:12px; color:var(--muted); white-space:nowrap; }
.aq-hbar-track { background:var(--bg); border-radius:6px; height:12px; overflow:hidden; }
.aq-hbar-fill { height:100%; background:var(--blue); border-radius:6px; min-width:3px; transition:width .3s; }
.aq-hbar-fill.alt { background:#5dbf9e; }
@media (max-width:700px) { .aq-grid2 { grid-template-columns:1fr; } }

/* Buscador de pedidos */
.aq-buscar-ped { margin-bottom:10px; }

/* Tabla de pedidos */
.aq-tabla { display:flex; flex-direction:column; }
.aq-tr { display:grid; grid-template-columns:1fr auto 110px 70px; gap:10px; align-items:center; padding:11px 4px;
  border-bottom:1px solid var(--line); font-size:14px; }
.aq-tr:last-child { border-bottom:none; }
.aq-tr:hover { background:var(--bg); }
.aq-tr-main { min-width:0; }
.aq-tr-main strong { display:block; color:var(--ink); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.aq-tr-sub { font-size:12px; color:var(--muted); }
.aq-tr-fecha { font-size:13px; color:var(--muted); white-space:nowrap; }
.aq-tr-monto { font-weight:600; text-align:right; white-space:nowrap; }
.aq-pc { font-style:normal; font-size:10px; font-weight:700; color:#8a6400; background:#fff7e6; border:1px solid #f0d8a0;
  padding:1px 4px; border-radius:5px; margin-left:5px; }
.aq-badge { font-size:11px; font-weight:700; text-align:center; padding:3px 8px; border-radius:20px; }
.aq-badge.ok { background:#e8f5ee; color:var(--ok); }
.aq-badge.warn { background:#fff7e6; color:#7a5a00; }

/* Confirmación */
.aq-confirm-head { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
.aq-check-ico { width:34px; height:34px; border-radius:50%; background:var(--ok); color:#fff; display:flex; align-items:center;
  justify-content:center; font-size:18px; font-weight:700; }
.aq-confirm h2 { margin:0; color:var(--navy); font-size:18px; text-transform:none; letter-spacing:0; }
.aq-confirm-msg { font-family:inherit; font-size:14px; line-height:1.5; white-space:pre-wrap; background:#f3f8fc;
  border:1px solid var(--line); border-radius:11px; padding:14px; color:var(--ink); margin:0; }
.aq-email-line { margin-top:12px; font-size:14px; padding:9px 12px; border-radius:9px; }
.aq-email-line.ok { background:#e8f5ee; color:var(--ok); }
.aq-email-line.warn { background:#fff7e6; color:#7a5a00; }
.aq-email-line.muted { background:var(--bg); color:var(--muted); }
.aq-confirm-acts { display:flex; gap:10px; margin-top:16px; }
.aq-confirm-acts .aq-btn { width:auto; flex:1; margin-top:0; }
.aq-confirm-acts .aq-btn-sec { flex:1; }

/* Alerta de email faltante */
.aq-email-alert { margin-top:12px; background:#fff7e6; border:1px solid #f0d8a0; border-left:4px solid #e0a300; border-radius:11px; padding:12px 14px; }
.aq-email-alert strong { color:#7a5a00; display:block; font-size:14px; }
.aq-email-alert p { margin:4px 0 10px; font-size:13px; color:#7a5a00; }
.aq-email-add { display:flex; gap:8px; }
.aq-email-add input { flex:1; }
.aq-email-add .aq-btn-sec { white-space:nowrap; }

@media (max-width:560px) {
  .aq-grid { grid-template-columns:1fr; }
  .aq-item { grid-template-columns: 1fr 56px 80px 28px; }
  .aq-item .aq-sub { display:none; }
  .aq-desc { grid-template-columns: 1fr 80px 28px; }
  .aq-desc select { grid-column:1 / -1; }
  .aq-kpis { grid-template-columns:repeat(2,1fr); }
  .aq-money { grid-template-columns:1fr; }
  .aq-tr { grid-template-columns:1fr 70px 60px; row-gap:2px; }
  .aq-tr-fecha { display:none; }
  .aq-tr-monto { grid-column:2 / 3; }
}
/* Mantenedores (Bloque 4) */
.aq-subtabs { display:flex; gap:6px; flex-wrap:wrap; }
.aq-subtabs button { background:#fff; border:1px solid var(--line); color:var(--muted); font:inherit; font-weight:600; font-size:13px;
  padding:8px 16px; border-radius:10px; cursor:pointer; }
.aq-subtabs button:hover { border-color:var(--blue); color:var(--navy); }
.aq-subtabs button.on { background:var(--navy); color:#fff; border-color:var(--navy); }
.aq-list { display:flex; flex-direction:column; margin-top:4px; }
.aq-list-row { display:grid; grid-template-columns:1fr auto auto auto; gap:10px; align-items:center; padding:11px 4px;
  border-bottom:1px solid var(--line); }
.aq-list-row:last-child { border-bottom:none; }
.aq-list-row.off { opacity:.62; }
.aq-list-main { min-width:0; }
.aq-list-main strong { display:block; color:var(--ink); font-weight:600; }
.aq-list-main span { font-size:12px; color:var(--muted); }
.aq-list-row .aq-btn-sec { padding:6px 11px; }
.aq-mant-acts { display:flex; gap:10px; align-items:center; margin-top:14px; flex-wrap:wrap; }
.aq-mant-acts .aq-btn { width:auto; flex:1; min-width:180px; margin-top:0; }
.aq-btn-danger { background:#fff; border:1px solid #f3b4ad; color:var(--bad); font:inherit; font-weight:600; font-size:14px;
  padding:13px 18px; border-radius:11px; cursor:pointer; }
.aq-btn-danger:hover { background:#fdecea; }
.aq-checks { display:flex; flex-wrap:wrap; gap:18px; margin-top:12px; }

/* Repetir última compra (Bloque 5) */
.aq-repetir { border-color:var(--blue); background:#f3f8fc; }
.aq-repetir-row { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.aq-repetir-row strong { color:var(--navy); }
.aq-repetir-row p { margin:2px 0 0; }
.aq-repetir-row .aq-btn-sec { white-space:nowrap; }

@media (max-width:560px) {
  .aq-list-row { grid-template-columns:1fr auto; row-gap:8px; }
  .aq-list-row .aq-badge { grid-column:2; }
  .aq-list-row .aq-btn-sec { grid-column:span 1; }
  .aq-repetir-row { flex-direction:column; align-items:stretch; }
}
.aq-mini { font-size:11px; color:var(--muted); font-weight:500; margin-top:3px; }
.aq-badge.bad { background:#fdecea; color:var(--bad); }
input:disabled { background:#f1f3f8; color:var(--muted); cursor:not-allowed; }

/* Historial de pedidos del cliente */
.aq-hist { margin-top:16px; border-top:1px solid var(--line); padding-top:14px; }
.aq-hist-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.aq-hist-head h3 { margin:0; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--navy); font-weight:700; }
.aq-hist-ped { border-bottom:1px solid var(--line); }
.aq-hist-ped:last-child { border-bottom:none; }
.aq-hist-row { display:grid; grid-template-columns:1fr auto 92px 18px; gap:10px; align-items:center; padding:11px 4px; cursor:pointer; }
.aq-hist-row:hover { background:var(--bg); }
.aq-hist-main { min-width:0; }
.aq-hist-main strong { display:block; color:var(--ink); }
.aq-hist-caret { color:var(--muted); font-size:12px; text-align:center; }
.aq-hist-det { padding:4px 6px 14px; }
.aq-hist-items { list-style:none; margin:0 0 8px; padding:0; }
.aq-hist-items li { display:flex; justify-content:space-between; gap:10px; font-size:14px; padding:4px 0; border-bottom:1px dashed var(--line); }
.aq-hist-items li:last-child { border-bottom:none; }
.aq-hist-pod { background:#f3f8fc; border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:13px; color:var(--ink); }
.aq-hist-pod strong { display:block; color:var(--navy); margin-bottom:4px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
.aq-hist-pod > div { margin:2px 0; }
.aq-hist-form { margin-top:6px; }
.aq-hist-form em { color:var(--muted); font-style:normal; }
@media (max-width:560px) { .aq-hist-row { grid-template-columns:1fr auto 18px; } .aq-hist-row .aq-badge { display:none; } }

/* Cobranza / gestión de cobro */
.aq-money-card.deuda { background:#fff7e6; border:1px solid #f0d8a0; color:#8a6400; text-align:left; cursor:pointer; font:inherit; display:flex; flex-direction:column; gap:2px; }
.aq-money-card.deuda:hover { background:#fdeecb; }
.aq-money-card.deuda strong { color:#8a6400; }
.aq-money-sub { font-style:normal; font-size:11px; color:#a07a2a; font-weight:500; }
.aq-tr-click { cursor:pointer; }
.aq-tr-click:hover { background:var(--bg); }
.aq-pc { cursor:pointer; }
.aq-cob { border-bottom:1px solid var(--line); padding:12px 4px; }
.aq-cob:last-child { border-bottom:none; }
.aq-cob-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
.aq-cob-main strong { display:block; color:var(--ink); }
.aq-cob-badges { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.aq-cob-acts { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center; }
.aq-cob-acts .aq-btn-sec { padding:7px 12px; font-size:13px; }
.aq-btn-sec.on { background:#e7f6ee; border-color:#9bd5b4; color:#1a7a45; }

/* Alerta de deuda en Nuevo pedido */
.aq-alerta-deuda { background:#fff7e6; border:1px solid #f0d8a0; border-radius:12px; padding:14px 16px; margin-bottom:14px; }
.aq-alerta-deuda strong { color:#8a6400; display:block; }
.aq-alerta-deuda p { margin:4px 0; color:var(--ink); }
.aq-alerta-deuda span { font-size:13px; color:#a07a2a; }

/* Popup detalle de entrega */
.aq-modal-ov { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:18px; z-index:50; }
.aq-modal { background:#fff; border-radius:16px; max-width:560px; width:100%; max-height:86vh; overflow:auto; padding:18px 20px; box-shadow:0 18px 50px rgba(0,0,0,.25); }
.aq-modal-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:14px; }
.aq-modal-head strong { display:block; font-size:17px; color:var(--navy); }
.aq-modal-cobro { margin-top:14px; background:#fff7e6; border:1px solid #f0d8a0; border-radius:12px; padding:12px 14px; }
.aq-modal-cobro > strong { color:#8a6400; }

/* Resumen de cobranzas */
.aq-cob-resumen { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:14px 0 8px; }
.aq-cob-rcard { background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:12px 14px; display:flex; flex-direction:column; gap:2px; }
.aq-cob-rcard span { font-size:12px; color:var(--muted); }
.aq-cob-rcard strong { font-size:20px; color:var(--navy); }
.aq-cob-rcard em { font-style:normal; font-size:11px; color:var(--muted); }
.aq-cob-rcard.ok strong { color:#1a7a45; }
.aq-cob-rcard.pend strong { color:#8a6400; }
.aq-cob-rcard.venc { background:#fdecea; border-color:#f3b4ad; }
.aq-cob-rcard.venc strong, .aq-cob-rcard.venc span { color:var(--bad); }

/* Grupos por cliente en cobranzas */
.aq-cob-grupo { border:1px solid var(--line); border-radius:12px; margin-bottom:10px; overflow:hidden; }
.aq-cob-grow { display:grid; grid-template-columns:1fr auto auto auto; gap:10px; align-items:center; padding:12px 14px; cursor:pointer; background:#fff; }
.aq-cob-grow:hover { background:var(--bg); }
.aq-cob-grow .aq-tr-monto { font-size:16px; color:var(--bad); }
.aq-cob-orders { background:var(--bg); padding:4px 12px 8px; }
.aq-cob-orders .aq-cob { border-bottom:1px solid var(--line); }
.aq-cob-orders .aq-cob:last-child { border-bottom:none; }

.aq-kpi-venc { border-color:#f3b4ad !important; background:#fdecea; }
.aq-kpi-venc strong { color:var(--bad); }

/* Semáforo de pago del cliente */
.aq-semaforo { display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:600; padding:7px 12px; border-radius:10px; margin-bottom:12px; border:1px solid; }
.aq-semaforo .aq-sem-dot { width:11px; height:11px; border-radius:50%; flex:none; }
.aq-semaforo.verde { background:#e7f6ee; border-color:#9bd5b4; color:#1a7a45; }
.aq-semaforo.verde .aq-sem-dot { background:#1a9a52; }
.aq-semaforo.amarillo { background:#fff7e6; border-color:#f0d8a0; color:#8a6400; }
.aq-semaforo.amarillo .aq-sem-dot { background:#e0a400; }
.aq-semaforo.rojo { background:#fdecea; border-color:#f3b4ad; color:#b42318; }
.aq-semaforo.rojo .aq-sem-dot { background:#d92d20; }

.aq-hist-pago { margin-top:8px; background:#e7f6ee; border:1px solid #9bd5b4; border-radius:10px; padding:8px 12px; font-size:13px; color:#1a5a36; }
.aq-hist-pago strong { display:block; color:#1a7a45; margin-bottom:3px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
.aq-hist-pago > div { margin:2px 0; }

.aq-contactos { background:#f3f8fc; border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:14px; }
.aq-contactos > strong { display:block; color:var(--navy); font-size:13px; margin-bottom:8px; }
.aq-contactos ul { list-style:none; margin:0 0 6px; padding:0; }
.aq-contactos li { padding:6px 0; border-bottom:1px solid var(--line); }
.aq-contactos li:last-child { border-bottom:none; }
.aq-cont-nom { display:block; font-weight:600; color:var(--ink); }
.aq-cont-sub { display:block; font-size:12px; color:var(--muted); }

.aq-money-card.proveedor { background:#eef6ff; border:1px solid #b3d4f5; color:#1a4a8a; }
.aq-money-card.proveedor strong { color:#1a4a8a; }
.aq-money-card.rendicion { background:#f0fdf4; border:1px solid #9bd5b4; color:#1a5a36; }
.aq-money-card.rendicion strong { color:#1a7a45; }

/* Gráfico de meta (bullet chart) */
.aq-meta-card { }
.aq-meta-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
.aq-meta-head h2 { margin:0; }
.aq-meta-badge { padding:6px 14px; border-radius:20px; font-size:13px; font-weight:700; white-space:nowrap; }
.aq-meta-row { display:grid; grid-template-columns:auto 1fr auto 1fr auto 1fr; gap:4px 10px; align-items:baseline; margin-bottom:14px; }
.aq-meta-label { font-size:12px; color:var(--muted); }
.aq-meta-val { font-size:16px; font-weight:700; color:var(--navy); }
.aq-bullet { margin-bottom:4px; }
.aq-bullet-track { position:relative; height:22px; background:#eef0f5; border-radius:11px; overflow:hidden; }
.aq-bullet-fill { position:absolute; left:0; top:0; height:100%; border-radius:11px; transition:width .6s cubic-bezier(.4,0,.2,1); }
.aq-bullet-goal { position:absolute; right:0; top:0; width:3px; height:100%; background:var(--navy); opacity:.7; }
.aq-bullet-labels { position:relative; display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-top:3px; }

.aq-dom-edit { background:#f0f7ff; border:1px solid #bdd7f5; border-radius:10px; padding:12px 14px; margin-bottom:10px; }
.aq-dom-edit .aq-grid { grid-template-columns:1fr 1fr; }
.aq-dom-edit input { font-size:13px; }

@media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
`;
