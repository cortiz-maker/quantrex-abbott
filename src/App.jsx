import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

const C = {
  navy:"#0D1F3C", navyMid:"#112347", navySurface:"#152A56", border:"#1E3A6E",
  cyan:"#00AEEF", cyanDim:"#0090C5", blue:"#1B3FA0",
  textPrimary:"#F0F6FF", textSecondary:"#8BAFD4", muted:"#4A6FA5",
  success:"#22C55E", warning:"#F59E0B", danger:"#EF4444", info:"#38BDF8",
};

const TYPE_META = {
  entrega:   { label:"Entrega / Despacho",                  icon:"↓", color:"#22C55E" },
  carga_ol:  { label:"Carga Operador Logístico",            icon:"⬆", color:"#00AEEF" },
  li_retiro: { label:"Logística Inversa - Retiro de Carga", icon:"↩", color:"#F59E0B" },
  li_devol:  { label:"Logística Inversa - Devolución",      icon:"↪", color:"#A78BFA" },
};

const STATUS_META = {
  pendiente:       { label:"Pendiente",      color:"#F59E0B" },
  en_proceso:      { label:"En Tránsito",    color:"#00AEEF" },
  completada:      { label:"Completada",     color:"#22C55E" },
  no_entregado:    { label:"No Entregado",   color:"#F97316" },
  devolucion:      { label:"Devolución",     color:"#14B8A6" },
  cancelada:       { label:"Cancelada",      color:"#EF4444" },
};

const PRIORIDAD_DEFAULT = {
  entrega:   "urgente",
  carga_ol:  "urgente",
  li_retiro: "normal",
  li_devol:  "normal",
};

const EMPTY_FORM = {
  tipo:"entrega", titulo:"", descripcion:"", direccion:"",
  fecha: new Date().toISOString().split("T")[0],
  hora: new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false}),
  contacto:"", guia:"", prioridad:"urgente", notas:"",
  solicitante:"", canalSolicitud:"", usuarioDT:"", ppuAsignada:"",
  destino:"", noPresentacion:false, vehiculoNP:"", motivoNP:"", choferAsignado:"", statusLog:[],
};


// ── Supabase Config ────────────────────────────────────────────────────────
const SUPABASE_URL = "https://euvwfbnbmefqpakbbzni.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1dndmYm5ibWVmcXBha2Jiem5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjY0ODksImV4cCI6MjA5NjAwMjQ4OX0.g4MZSgs7yF3fJljIbF-C582g-Bvbn0RSML1lYGGlIaQ";

async function sbFetch(method, table, body=null, query="") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": method==="POST"?"resolution=merge-duplicates,return=representation":"",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) { const e=await res.text(); console.error("Supabase error:",e); return null; }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}


const GOOGLE_MAPS_API_KEY = "AIzaSyA_8neDl2i9IcdIOotSFzryKu0ocaqAzgM";
const ORIGEN_PUDAHUEL = "Av. Los Alerces, Pudahuel, Región Metropolitana, Chile";
const PESO_BASE_KG = 1000; // kg por solicitud (base contractual)

const CLIENTES_DEFAULT = [{"id":"000-2","nombre":"Dhl Atlantis","direccion":"","notas":"Cita XX:XX hrs Andenes 32-33"},{"id":"17004950-0","nombre":"Warner Payamares","direccion":"Marathon 5187, Macul","notas":"Dpto 41, Torre 7"},{"id":"19.684.207-1","nombre":"Felipe Moya Pineda / Dpto 305 / Torre 1","direccion":"Portezuelo de los azules 6975, Puente Alto","notas":""},{"id":"53.125.850-9","nombre":"Comunidad Hospital Del Profesor","direccion":"Avenida Libertador Bernardo O'Higgins 4860, Estación Central, Santiago","notas":"Bodega Hemodinamia Piso 1"},{"id":"60.910.000-1","nombre":"Hospital Clinico U de Chile","direccion":"Santos Dumontt 999, Independencia","notas":""},{"id":"61.101.030-3","nombre":"Hospital Militar De Santiago","direccion":"Av Alcalde Fdo Castillo v 9100, La Reina","notas":"5to Piso, Pabellon Hemodinamia"},{"id":"61.103.007-K","nombre":"Hosp Gral Dr Raul Yazigi","direccion":"Av Las Condes 8631, Las Condes","notas":"Entregar en Hemodinamia Piso 2"},{"id":"61513003-6","nombre":"Dipreca Fondo Hospital","direccion":"Vital Apoquindo 1200, Las condes","notas":"3er Piso Consignacion"},{"id":"61.602.054-4","nombre":"Hospital Carlos Van Buren","direccion":"El Litre 1012, Valparaiso","notas":""},{"id":"61.602.054-4","nombre":"Hospital Carlos Van Buren","direccion":"San Ignacio 725, Valparaiso","notas":""},{"id":"61.602.138-9","nombre":"Hospital Rancagua","direccion":"Av. Libertador Bernardo O'Higgins 3065, Rancagua, O'Higgins","notas":""},{"id":"61.602.189-3","nombre":"Hosp Guillermo Grant Benavente","direccion":"San Martin 1436, Concepcion","notas":"Entregar a Warner Payamares"},{"id":"61606602-1","nombre":"Hosp Dr Gustavo Fricke","direccion":"Alvarez 1532, Viña Del Mar","notas":""},{"id":"61.606.903-9","nombre":"HOSP BASE CURICO","direccion":"Archipielago Juan Fernandez 1890, Curico","notas":""},{"id":"61.608.002-4","nombre":"Hospital San Jose","direccion":"Calle San Jose 1030, Santiago Independencia","notas":"Bodega Central"},{"id":"61608004-0","nombre":"Hospital Roberto del Rio","direccion":"Profesor Zanartu 1085, Independencia","notas":"Bodega Central"},{"id":"61.608.101-2","nombre":"Hosp Barros Luco Trudeau","direccion":"Gran Avenida 3204, San Miguel","notas":"Entrega en Equipos Medicos"},{"id":"61608204-3","nombre":"Hospital San Juan de Dios","direccion":"Huerfanos 3255, Santiago","notas":"1er Piso Pabellon Hemodinamia"},{"id":"61.608.402-K","nombre":"Inst Nacional Del Torax","direccion":"Jose Manuel Infante 717, Providencia","notas":"Bodega General"},{"id":"61.608.408-9","nombre":"Hospital Calvo Mackenna","direccion":"Antonio Varas 248, Providencia","notas":""},{"id":"61608502-6","nombre":"Hospital Sotero del Rio","direccion":"Avenida Concha y Toro 3459, Puente alto","notas":"3er Piso, Pabellon 16"},{"id":"61.608.602-2","nombre":"Hosp Urgencia  Asist Pubica","direccion":"Portugal 125, Santiago","notas":"Pabellon 3,  Angiografía 3er piso"},{"id":"61.608.604-9","nombre":"Hospital San Borja De Arriaran","direccion":"Santa Rosa 1234, Santiago","notas":""},{"id":"61980320-5","nombre":"Hospital del Carmen","direccion":"Camino A Rinconada 1201 &, El Olimpo, Maipú, Región Metropolitana","notas":""},{"id":"71.494.700-1","nombre":"Fundacion Diabetes Juvenil","direccion":"Calle Valparaiso 507, Viña del mar","notas":"Piso 2"},{"id":"71.614.000-8","nombre":"Clinica Univer Los Andes","direccion":"Av Plaza 2501, Las Condes","notas":"2do Piso Hemodinamia"},{"id":"76.044.959-8","nombre":"Arlab S.A","direccion":"Alferez Real 1380, Providencia","notas":"Entrega en Bodega"},{"id":"76242774-5","nombre":"Clinica BUPA Santiago S.A.","direccion":"Av. Departamental 1455, La Florida, Region Metropolitana","notas":"Piso -1 Consignacion"},{"id":"76.336.093-3","nombre":"Clinica Meds La Dehesa Spa","direccion":"Jose Alcalde Delano 10581","notas":""},{"id":"76.363.205-9","nombre":"Clinica Ensenada Spa","direccion":"Av Fermin Vivaceta 957, Independencia","notas":"Bodega General"},{"id":"76.871.990-K","nombre":"Nueva Clinica Cordillera Ph S.A","direccion":"Alejandro Fleming  7885, Las Condes","notas":""},{"id":"77.067.168-K","nombre":"Frimed Spa","direccion":"CAMINO LO BOZA 107, Pudahuel","notas":"BODEGA A-08"},{"id":"77487960-9","nombre":"Importadora Y Exportadora CAMIR SPA","direccion":"Perez Valenzuela 1098, Providencia","notas":""},{"id":"78.040.520-1","nombre":"Clin Avansalud Providencia S.A","direccion":"Av Salvador 130, Providencia","notas":""},{"id":"78.800.870-8","nombre":"M Kaplan Y Cia Ltda","direccion":"Marchant Pereira 174, Providencia","notas":""},{"id":"81.378.300-2","nombre":"Abbott Laboratories De Chile","direccion":"Los Militares 4777, Las Condes","notas":"Piso 7 o 8"},{"id":"81698900-0","nombre":"Pontificia Universidad Catolica","direccion":"Marcoleta 367, Santiago","notas":""},{"id":"90.753.000-0","nombre":"Clinica Santa Maria Spa","direccion":"AV Santa Maria 410, Providencia","notas":"Entrega: 4 piso torre C - Pabellón Hemodinamia."},{"id":"92.051.000-0","nombre":"Inst De Diagnostico S.A","direccion":"AV SANTA MARIA 1810, PROVIDENCIA","notas":"Entrega 5to piso Hemodinamia"},{"id":"92.999.000-5","nombre":"Imp. y Distrib.Arquimed S.A","direccion":"Arturo Prat 828, Santiago","notas":""},{"id":"93930000-7","nombre":"Clinica Las Condes S.A.","direccion":"Estoril 450, Las condes","notas":"Piso -2 Consignacion"},{"id":"96.530.470-3","nombre":"Clinica Davila y Servs Medicos Spa","direccion":"Recoleta 464, Recoleta","notas":""},{"id":"96662450-7","nombre":"Clínica Isamédica","direccion":"Carretera El Cobre Presidente Eduardo Frei Montalva N°884, Rancagua, Región del Libertador Bernardo O´Higgins","notas":""},{"id":"96.770.100-9","nombre":"Clin Alemana De Santiago","direccion":"Vitacura 5951, Viitacura","notas":"Pabellon Hemodinamia 5to Piso"},{"id":"96774580-4","nombre":"Clinica Redsalud Mayor Temuco","direccion":"Avenida Gabriela Mistral N°01955, Temuco","notas":""},{"id":"96.885.930-7","nombre":"Clinica Bicentenario SpA","direccion":"Av. Alameda Libertador Bernardo O'Higgins 4850, Estacion Central","notas":""},{"id":"96.885.950-1","nombre":"Clin Ciudad Del Mar S A","direccion":"13 Norte 672, Viña Del Mar","notas":"Entrega en Equipos Medicos"},{"id":"96898980-4","nombre":"Clinica Vespucio SPA","direccion":"Serafin Zamora 190, La Florida, Region Metropolitana","notas":""},{"id":"99.519.620-4","nombre":"Soc De Diag Invasivo Cardiologia Spa","direccion":"Gran Avenida 3204, San Miguel","notas":"Pabellon Hemodinamia"},{"id":"99573490-7","nombre":"UC Christus Servicios Clinicos SPA","direccion":"Camino El Alba 12351, Las Condes","notas":""},{"id":"71.494.700-1","nombre":"Fundacion Diabetes Juvenil","direccion":"Lota 2344, Providencia","notas":"Bodega Central"},{"id":"99573490-7","nombre":"Uc Christus Servicios Clinicos Spa","direccion":"Marcoleta 367, Santiago","notas":""},{"id":"","nombre":"Cenabast","direccion":"San Eugenio 40, Ñuñoa","notas":"Entregar a Solange Arzola"}];


const CHOFERES = [
  { nombre: "Felipe Hernandez", ppu: "KRYX27", usuarioDT: "Quantrex M1" },
  { nombre: "Italo Loiza",      ppu: "PBGJ33", usuarioDT: "Quantrex M2" },
  { nombre: "Cristian Donoso",  ppu: "PZGH22", usuarioDT: "Quantrex M1" },
];


const USUARIOS = [
  { email:"cortiz@quantrex.cl",     password:"Qx@Admin2026", perfil:"admin",    nombre:"César Ortiz" },
  { email:"jmartinez@quantrex.cl",  password:"Qx@Op2026",    perfil:"operador", nombre:"J. Martínez" },
  { email:"info@transportesbs.cl",  password:"libre2026",    perfil:"cliente",  nombre:"Abbott Chile" },
];


// ── Cálculo de distancia Google Maps ──────────────────────────────────────






// ── Mapa estático Google Maps ──────────────────────────────────────────────
function getMapaTramoUrl(origen, destino) {
  const base = "https://maps.googleapis.com/maps/api/staticmap";
  const params = new URLSearchParams({
    size: "600x200",
    maptype: "roadmap",
    markers: `color:blue|label:A|${origen}`,
    path: `weight:4|color:0x00AEEFff|${origen}|${destino}`,
    key: GOOGLE_MAPS_API_KEY,
    language: "es",
    region: "CL",
  });
  // Agregar marcador destino
  return `${base}?${params.toString()}&markers=color:red|label:B|${encodeURIComponent(destino)}`;
}

async function calcularTramo(origen, destino) {
  try {
    const apiUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origen)}&destinations=${encodeURIComponent(destino)}&mode=driving&language=es&key=${GOOGLE_MAPS_API_KEY}`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const raw = await res.json();
    const data = raw.contents ? JSON.parse(raw.contents) : raw;
    const element = data.rows?.[0]?.elements?.[0];
    if (element?.status === "OK") {
      return {
        km: (element.distance.value / 1000).toFixed(1),
        tiempo: element.duration.text,
        mapaUrl: getMapaTramoUrl(origen, destino),
      };
    }
    return null;
  } catch { return null; }
}


// ── Generador OT automático ────────────────────────────────────────────────
function generarOT(solicitudes) {
  // Contador global correlativo basado en total de solicitudes
  const correlativo = String(solicitudes.length + 1).padStart(3, "0");
  return `QX-${correlativo}`;
}


// ── Cálculo distancia ──────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)*Math.sin(dLon/2);
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 1.3).toFixed(1); // factor 1.3 para estimar ruta real
}

// Coordenadas conocidas de clientes Abbott en Santiago
const COORDS_CONOCIDAS = {
  "marathon": {lat:-33.4912, lon:-70.6234},
  "bicentenario": {lat:-33.4678, lon:-70.6934},
  "san borja": {lat:-33.4531, lon:-70.6598},
  "arriaran": {lat:-33.4531, lon:-70.6598},
  "san jose": {lat:-33.3891, lon:-70.6584},
  "davila": {lat:-33.3856, lon:-70.6621},
  "alemana": {lat:-33.4056, lon:-70.5934},
  "carmen": {lat:-33.5234, lon:-70.7123},
  "santa maria": {lat:-33.4234, lon:-70.6134},
  "christus": {lat:-33.4312, lon:-70.6123},
  "diagnostico": {lat:-33.4456, lon:-70.6534},
  "asist pub": {lat:-33.4534, lon:-70.6698},
  "dipreca": {lat:-33.4123, lon:-70.6234},
  "los andes": {lat:-33.3956, lon:-70.5834},
  "sotero": {lat:-33.5678, lon:-70.6234},
  "atlantis": {lat:-33.4123, lon:-70.7534},
  "barros luco": {lat:-33.5012, lon:-70.6534},
  "trudeau": {lat:-33.5012, lon:-70.6534},
  "estacion central": {lat:-33.4567, lon:-70.6798},
  "alameda": {lat:-33.4567, lon:-70.6798},
  "macul": {lat:-33.4912, lon:-70.6089},
  "providencia": {lat:-33.4234, lon:-70.6134},
  "las condes": {lat:-33.4012, lon:-70.5734},
  "nunoa": {lat:-33.4567, lon:-70.5934},
  "pudahuel": {lat:-33.4372, lon:-70.7558},
  "rancagua": {lat:-34.1703, lon:-70.7403},
  "maipu": {lat:-33.5156, lon:-70.7578},
  "quilicura": {lat:-33.3634, lon:-70.7289},
};

async function geocodificar(direccion) {
  try {
    const dir = direccion.toLowerCase();
    // Buscar en coordenadas conocidas
    for(const [key, coords] of Object.entries(COORDS_CONOCIDAS)) {
      if(dir.includes(key)) return coords;
    }
    // Si no encuentra, intentar con Nominatim como fallback
    const query = encodeURIComponent(direccion + ", Chile");
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=cl`;
    const res = await fetch(url);
    const data = await res.json();
    if(data && data[0]) return {lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon)};
    return null;
  } catch { return null; }
}

// Coordenadas fijas de Pudahuel (Av. Los Alerces)
const PUDAHUEL_COORDS = {lat: -33.4372, lon: -70.7558};

async function calcularKmDesdePudahuel(direccionDestino) {
  try {
    const dest = await geocodificar(direccionDestino);
    if(!dest) return null;
    return parseFloat(haversineKm(PUDAHUEL_COORDS.lat, PUDAHUEL_COORDS.lon, dest.lat, dest.lon));
  } catch { return null; }
}



// ── Tabla SPOT Regional ────────────────────────────────────────────────────
const SPOT_REGIONAL = [
  { region:"RM",   label:"Región Metropolitana", valor:0,      keywords:["santiago","providencia","las condes","vitacura","ñuñoa","maipú","maipu","pudahuel","quilicura","estacion central","estación central","macul","peñalolen","peñalolén","la florida","san miguel","cerrillos","renca","independencia","recoleta","huechuraba","lo barnechea","san ramon","la pintana","el bosque","pedro aguirre","cerro navia","quinta normal","lo espejo","la granja","la cisterna","san joaquin","san joaquín","lo prado"] },
  { region:"IV",   label:"IV Región - Coquimbo",  valor:520000, keywords:["coquimbo","la serena","ovalle","illapel","los vilos","andacollo","vicuña","paihuano","monte patria","combarbalá","combarbala","canela","punitaqui","río hurtado","rio hurtado"] },
  { region:"V",    label:"V Región - Valparaíso", valor:270000, keywords:["valparaíso","valparaiso","viña del mar","vina del mar","quilpué","quilpue","villa alemana","quillota","san antonio","los andes","san felipe","rancagua valparaíso","cartagena","el tabo","el quisco","algarrobo","limache","olmué","olmue","nogales","la calera","hijuelas","la cruz","puchuncaví","puchuncavi","quintero","papudo","zapallar","cabildo","petorca","ligua"] },
  { region:"VI",   label:"VI Región - O'Higgins", valor:260000, keywords:["rancagua","san fernando","rengo","pichilemu","santa cruz","graneros","mostazal","coinco","coltauco","doñihue","doñihue","requinoa","olivar","machalí","machali","malloa","peumo","pichidegua","las cabras","placilla","nancagua","chépica","chepica","palmilla","peralillo","lolol","pumanque","marchihue","paredones","navidad","litueche","la estrella","punitaqui"] },
  { region:"VII",  label:"VII Región - Maule",    valor:410000, keywords:["talca","curicó","curico","linares","constitución","constitucion","cauquenes","parral","san javier","molina","sagrada familia","licantén","licanten","vichuquén","vichuquen","hualañé","hualane","rauco","teno","romeral","curepto","pelarco","río claro","rio claro","pencahue","maule","colbún","colbun","longaví","longavi","retiro","villa alegre","yerbas buenas","chanco","pelluhue"] },
  { region:"VIII", label:"VIII Región - Biobío",  valor:650000, keywords:["concepción","concepcion","biobío","biobio","talcahuano","los ángeles","los angeles","chillán","chillan","coronel","lota","tomé","tome","penco","san pedro de la paz","hualqui","santa juana","florida","quillón","quillon","yumbel","cabrero","tucapel","antuco","quilaco","mulchén","mulchen","negrete","nacimiento","lebu","arauco","curanilahue","los álamos","los alamos","tirúa","tirua","cañete","canete"] },
  { region:"IX",   label:"IX Región - Araucanía", valor:800000, keywords:["temuco","araucanía","araucania","padre las casas","villarrica","pucón","pucon","angol","victoria","collipulli","curacautín","curacautin","lonquimay","ercilla","traiguén","traiguen","lumaco","purén","puren","los sauces","lebu","nueva imperial","carahue","saavedra","teodoro schmidt","freire","pitrufquén","pitrufquen","gorbea","loncoche","vilcún","vilcun","melipeuco","cholchol","galvarino","perquenco","lautaro","cuneo","cunco"] },
];

function detectarRegion(direccion) {
  if (!direccion) return null;
  const dir = direccion.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const r of SPOT_REGIONAL) {
    if (r.region === "RM") continue; // RM se evalúa al final
    for (const kw of r.keywords) {
      const kwNorm = kw.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (dir.includes(kwNorm)) return r;
    }
  }
  // Si no encontró otra región, asume RM
  return SPOT_REGIONAL[0];
}

// ── Período ────────────────────────────────────────────────────────────────
function getPeriodoActual() {
  const hoy = new Date(); const mes = hoy.getMonth();
  return { inicio: new Date(hoy.getFullYear(), mes-1, 26), fin: new Date(hoy.getFullYear(), mes, 25) };
}
function getNombrePeriodo(inicio, fin) {
  const m = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `${m[fin.getMonth()]} ${fin.getFullYear()}`;
}
function fechaEnPeriodo(fechaStr, inicio, fin) {
  if (!fechaStr) return false;
  const f = new Date(fechaStr+"T12:00:00");
  return f >= inicio && f <= fin;
}

// ── Storage ────────────────────────────────────────────────────────────────
async function loadSolicitudes() {
  try {
    const data = await sbFetch("GET","solicitudes","","?order=created_at.desc");
    if(!data) return [];
    return data.map(s=>({
      id:s.id, ot:s.ot, fecha:s.fecha, hora:s.hora, tipo:s.tipo, titulo:s.titulo,
      descripcion:s.descripcion, direccion:s.direccion, contacto:s.contacto, guia:s.guia,
      prioridad:s.prioridad, notas:s.notas, solicitante:s.solicitante,
      canalSolicitud:s.canal_solicitud, usuarioDT:s.usuario_dt, ppuAsignada:s.ppu_asignada,
      destino:s.destino, choferAsignado:s.chofer_asignado, documentos:s.documentos,
      status:s.status, statusLog:s.status_log||[],
      noPresentacion:s.no_presentacion, vehiculoNP:s.vehiculo_np, motivoNP:s.motivo_np,
      geoEntrega:s.geo_entrega, horaEntrega:s.hora_entrega, horaLlegada:s.hora_llegada,
      tiempoEnPunto:s.tiempo_en_punto, coordsEntrega:s.coords_entrega,
      fotoEntrega:s.foto_entrega, firmaReceptor:s.firma_receptor,
      nombreReceptor:s.nombre_receptor, rechazoFirma:s.rechazo_firma,
      canceladoPor:s.cancelado_por, kmDesdePudahuel:s.km_desde_pudahuel,
      updatedAt:s.updated_at, createdAt:s.created_at,
    }));
  } catch(e) { console.error(e); return []; }
}
async function saveSolicitudes(data) {
  // Persiste cada registro mediante el guardado individual (upsert real).
  for (const s of (data||[])) await saveSolicitud(s);
}
async function saveSolicitud(s) {
  try {
    const row = {
      id:s.id, ot:s.ot||null, fecha:s.fecha||null, hora:s.hora||null, tipo:s.tipo||null,
      titulo:s.titulo||null, descripcion:s.descripcion||null, direccion:s.direccion||null,
      contacto:s.contacto||null, guia:s.guia||null, prioridad:s.prioridad||null,
      notas:s.notas||null, solicitante:s.solicitante||null, canal_solicitud:s.canalSolicitud||null,
      usuario_dt:s.usuarioDT||null, ppu_asignada:s.ppuAsignada||null, destino:s.destino||null,
      chofer_asignado:s.choferAsignado||null, documentos:s.documentos||null,
      status:s.status||"pendiente", status_log:s.statusLog||[],
      no_presentacion:s.noPresentacion||false, vehiculo_np:s.vehiculoNP||null,
      motivo_np:s.motivoNP||null, geo_entrega:s.geoEntrega||null,
      hora_entrega:s.horaEntrega||null, hora_llegada:s.horaLlegada||null,
      tiempo_en_punto:s.tiempoEnPunto||null, coords_entrega:s.coordsEntrega||null,
      foto_entrega:s.fotoEntrega||null, firma_receptor:s.firmaReceptor||null,
      nombre_receptor:s.nombreReceptor||null, rechazo_firma:s.rechazoFirma||false,
      cancelado_por:s.canceladoPor||null, km_desde_pudahuel:s.kmDesdePudahuel||null,
      updated_at:new Date().toISOString(),
    };
    // UPSERT - insert o update si ya existe
    const res = await fetch(`${SUPABASE_URL}/rest/v1/solicitudes?on_conflict=id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });
    if(!res.ok) { const e=await res.text(); console.error("saveSolicitud error:",e); }
  } catch(e) { console.error(e); }
}
async function deleteSolicitud(id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/solicitudes?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    });
    if(!res.ok) { const e=await res.text(); console.error("deleteSolicitud error:",e); }
  } catch(e) { console.error(e); }
}
async function loadCierres() {
  try {
    const data = await sbFetch("GET","cierres","","?order=cerrado_en.desc");
    if(!data) return [];
    return data.map(c=>({
      id:c.id, nombre:c.nombre, fechaInicio:c.fecha_inicio, fechaFin:c.fecha_fin,
      total:c.total, completadas:c.completadas, cerradoEn:c.cerrado_en,
      solicitudes:c.solicitudes||[],
    }));
  } catch(e) { return []; }
}
async function saveCierres(data) {
  try {
    for(const c of data) {
      const row = {
        id:c.id, nombre:c.nombre, fecha_inicio:c.fechaInicio, fecha_fin:c.fechaFin,
        total:c.total, completadas:c.completadas, cerrado_en:c.cerradoEn,
        solicitudes:c.solicitudes||[],
      };
      await sbFetch("POST","cierres",row,"?on_conflict=id");
    }
  } catch(e) { console.error(e); }
}
async function loadPeriodo() {
  try {
    const data = await sbFetch("GET","periodo","","?id=eq.activo");
    if(!data||!data.length) return null;
    return {inicio:data[0].inicio, fin:data[0].fin, nombre:data[0].nombre};
  } catch(e) { return null; }
}
async function savePeriodo(data) {
  try {
    if(!data) {
      await sbFetch("DELETE","periodo",null,"?id=eq.activo");
      return;
    }
    const row = {id:"activo", inicio:data.inicio, fin:data.fin, nombre:data.nombre};
    await sbFetch("POST","periodo",row,"?on_conflict=id");
  } catch(e) { console.error(e); }
}
async function loadClientes() {
  try {
    const data = await sbFetch("GET","clientes","","?id=eq.lista");
    if(!data||!data.length) return null;
    return data[0].data||null;
  } catch(e) { return null; }
}
async function saveClientes(data) {
  try {
    await sbFetch("POST","clientes",{id:"lista",data:data},"?on_conflict=id");
  } catch(e) { console.error(e); }
}
function registrarAcceso(email) {
  try {
    const key = "qx:acceso:" + email;
    localStorage.setItem(key, new Date().toISOString());
  } catch {}
}
function getUltimoAcceso(email) {
  try {
    const v = localStorage.getItem("qx:acceso:" + email);
    return v ? new Date(v) : null;
  } catch { return null; }
}
function diasSinAcceso(email) {
  const ua = getUltimoAcceso(email);
  if (!ua) return null;
  return Math.floor((new Date() - ua) / (1000 * 60 * 60 * 24));
}
function debeCambiarPassword(usuario) {
  if (usuario.perfil === "admin") return false;
  const hoy = new Date();
  // Primer día del mes
  if (hoy.getDate() !== 1) return false;
  const key = "qx:pwchange:" + usuario.email;
  const ultimo = localStorage.getItem(key);
  if (!ultimo) return true;
  const ultimaFecha = new Date(ultimo);
  return ultimaFecha.getMonth() !== hoy.getMonth() || ultimaFecha.getFullYear() !== hoy.getFullYear();
}
function marcarPasswordCambiado(email) {
  try { localStorage.setItem("qx:pwchange:" + email, new Date().toISOString()); } catch {}
}
async function loadRutas() {
  try {
    const data = await sbFetch("GET","rutas","","?order=created_at.desc");
    if(!data) return [];
    return data.map(r=>({
      id:r.id, nombre:r.nombre, fecha:r.fecha, vehiculo:r.vehiculo,
      paradas:r.paradas||[], kmTotal:r.km_total||null,
      estado:r.estado||"abierta", cerradaAt:r.cerrada_at||null,
      cerradaPor:r.cerrada_por||null, reaperturas:r.reaperturas||[],
      createdAt:r.created_at,
    }));
  } catch(e) { return []; }
}
async function saveRuta(r) {
  try {
    const row = {
      id:r.id, nombre:r.nombre, fecha:r.fecha, vehiculo:r.vehiculo||null,
      paradas:r.paradas||[], km_total:r.kmTotal||null,
      estado:r.estado||"abierta", cerrada_at:r.cerradaAt||null,
      cerrada_por:r.cerradaPor||null, reaperturas:r.reaperturas||[],
      created_at:r.createdAt||new Date().toISOString(),
      updated_at:new Date().toISOString(),
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rutas?on_conflict=id`, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":SUPABASE_KEY,
        "Authorization":`Bearer ${SUPABASE_KEY}`,
        "Prefer":"resolution=merge-duplicates,return=minimal",
      },
      body:JSON.stringify(row),
    });
    if(!res.ok){ const e=await res.text(); console.error("saveRuta error:",e); }
  } catch(e) { console.error(e); }
}
async function deleteRuta(id) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rutas?id=eq.${id}`, {
      method:"DELETE",
      headers:{"apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`},
    });
  } catch(e) { console.error(e); }
}

// Una ruta se cierra cuando tiene paradas y todas sus solicitudes asignadas
// están en estado terminal (entregadas/completadas, no entregadas o canceladas).
const ESTADOS_TERMINALES = ["completada","no_entregado","devolucion","cancelada"];
function rutaCerrada(ruta, sols) {
  const asignadas = (sols||[]).filter(s => (ruta.paradas||[]).some(p => p.solId===s.id));
  if (asignadas.length === 0) return false;
  return asignadas.every(s => ESTADOS_TERMINALES.includes(s.status));
}

// ── Respaldo (JSON descargable) ─────────────────────────────────────────────
function descargarRespaldo(payload, nombreArchivo) {
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombreArchivo;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (e) { console.error("respaldo error:", e); return false; }
}

// ── Excel ─────────────────────────────────────────────────────────────────
function exportToExcel(solicitudes, nombreArchivo) {
  const PRECIO_SPOT=50000, PRECIO_OVERNIGHT=85000, COBRO_M1=2840000, COBRO_M2=2840000;
  const DESCUENTO_DIA = Math.round(2840000/30);

  function horaAMinutos(h) {
    if (!h) return null; const [hh,mm] = h.split(":").map(Number);
    return isNaN(hh) ? null : hh*60+(mm||0);
  }
  function logSuperaLas17(log) {
    return (log||[]).some(e => { const p=(e.fechaHora||"").split(" "); if(p.length<2)return false; const m=horaAMinutos(p[1]); return m!==null&&m>=17*60; });
  }

  const contD={}, contN={};
  const rows = solicitudes.map((s,i) => {
    const fecha=s.fecha||"sin-fecha";
    const mins=horaAMinutos(s.hora);
    const antes830=s.tipo==="carga_ol"&&mins!==null&&mins<8*60+30;
    const logTarde=logSuperaLas17(s.statusLog);
    const esOH=antes830||logTarde;
    // Carga OL fuera de horario no cuenta para el límite diario de 6
    if(!esOH) contD[fecha]=(contD[fecha]||0)+1;
    else if(!(contD[fecha])) contD[fecha]=contD[fecha]||0;
    const nro=contD[fecha];
    let esSpot=false;
    if(!esOH){contN[fecha]=(contN[fecha]||0)+1; esSpot=contN[fecha]>6;}
    const cSpot=esSpot?PRECIO_SPOT:0, cOH=esOH?PRECIO_OVERNIGHT:0;
    const motivoOH=esOH?[antes830?"Hora antes 08:30":null,logTarde?"Log después 17:00":null].filter(Boolean).join(" / "):"";
    // Tiempo en punto solo para carga_ol, li_retiro, li_devol
    const tipoConTiempo = ["carga_ol","li_retiro","li_devol"].includes(s.tipo);
    const tiempoEnPunto = tipoConTiempo ? (s.tiempoEnPunto||"") : "";
    // SPOT Regional — recargo por destino fuera de la RM (según dirección)
    const regionSol = detectarRegion(s.direccion || s.destino || "");
    const cSpotRegional = regionSol ? (regionSol.valor || 0) : 0;
    const esSpotRegional = cSpotRegional > 0;
    return [i+1,s.ot||"",s.fecha||"",s.hora||"",s.titulo||"",s.titulo==="000-2 - Dhl Atlantis"?(s.destino||""):"",
      TYPE_META[s.tipo]?.label||s.tipo, STATUS_META[s.status]?.label||s.status,
      s.prioridad==="urgente"?"Urgente":"Normal", s.solicitante||"", s.canalSolicitud||"",
      s.usuarioDT||"", s.ppuAsignada||"", nro,
      (s.statusLog||[]).map(e=>(e.fechaHora||"").split(" ")[1]||"").join(" | "),
      esSpot?"Sí":"No", cSpot||"", esOH?"Sí":"No", motivoOH, cOH||"",
      esSpotRegional?(regionSol?.label||""):"", cSpotRegional||"",
      (cSpot+cOH+cSpotRegional)||"",
      s.choferAsignado||"", tiempoEnPunto,
      s.noPresentacion?(s.vehiculoNP||""):"", s.noPresentacion?(s.motivoNP||""):"",
      s.noPresentacion?DESCUENTO_DIA:""];
  });

  const totalSpot=rows.filter(r=>r[15]==="Sí").length;
  const totalOH=rows.filter(r=>r[17]==="Sí").length;
  const totalSpotRegional=rows.reduce((acc,r)=>acc+(Number(r[21])||0),0);
  const cantSpotRegional=rows.filter(r=>(Number(r[21])||0)>0).length;
  const totalCobro=totalSpot*PRECIO_SPOT+totalOH*PRECIO_OVERNIGHT+totalSpotRegional;
  const totalNP=solicitudes.filter(s=>s.noPresentacion).length;
  const totalDescNP=totalNP*DESCUENTO_DIA;
  const granTotal=totalCobro+COBRO_M1+COBRO_M2-totalDescNP;

  const headers=["N°","OT Quantrex","Fecha","Hora","Cliente","Destino","Tipo","Estado","Prioridad",
    "Solicitante","Canal","Usuario DT","PPU","N° día","Hora Cierre Completado",
    "SPOT","Costo SPOT","Overnight","Motivo OH","Costo OH","SPOT Regional","Costo SPOT Regional",
    "Total Cobros","Chofer","Tiempo en Punto","Veh. NP","Motivo NP","Descuento NP"];

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws1["!cols"]=[{wch:5},{wch:12},{wch:12},{wch:8},{wch:35},{wch:20},{wch:28},{wch:13},{wch:10},
    {wch:18},{wch:14},{wch:13},{wch:10},{wch:8},{wch:18},{wch:7},{wch:13},{wch:10},{wch:22},{wch:12},
    {wch:22},{wch:18},{wch:14},{wch:18},{wch:14},{wch:14},{wch:25},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws1, "Detalle Solicitudes");

  const periodoNombre=nombreArchivo.replace("Quantrex_Abbott_","").replace(".xlsx","").replace("_"," ");
  const r2=[
    ["QUANTREX — GESTIÓN LOGÍSTICA"],
    ["Resumen de Facturación — "+periodoNombre],
    ["Orden de Compra: OC-4000255637"],
    [],
    ["COBROS FIJOS MENSUALES"],
    ["Concepto","Detalle","Monto"],
    ["Quantrex M1","Mensual fijo",COBRO_M1],
    ["Quantrex M2","Mensual fijo",COBRO_M2],
    ["SUBTOTAL FIJO","",COBRO_M1+COBRO_M2],
    [],
    ["COBROS VARIABLES"],
    ["Concepto","Cantidad","Monto"],
    ["Pedido SPOT Extra",totalSpot,totalSpot*PRECIO_SPOT],
    ["Servicio Overnight / Fuera Horario",totalOH,totalOH*PRECIO_OVERNIGHT],
    ["SPOT Regional (fuera RM)",cantSpotRegional,totalSpotRegional],
    ["SUBTOTAL VARIABLE","",totalCobro],
    [],
  ];
  if(totalDescNP>0){
    r2.push(["DESCUENTOS"]);
    r2.push(["Concepto","Días","Descuento"]);
    r2.push(["No presentación de vehículo",totalNP,-totalDescNP]);
    r2.push(["SUBTOTAL DESCUENTOS","",-totalDescNP]);
    r2.push([]);
  }
  r2.push(["Total Pre Cierre","",granTotal]);
  r2.push([]);
  const totalKmExcel = solicitudes.reduce((acc,s)=>acc+(parseFloat(s.kmDesdePudahuel)||0),0).toFixed(1);
  const totalKgExcel = solicitudes.length * PESO_BASE_KG;
  const totalCO2Excel = (parseFloat(totalKmExcel)*totalKgExcel).toFixed(0);
  // Calcular tkm y CO2 estimado para el resumen
  const tkmAbbot = parseFloat(totalKmExcel) > 0 ? (parseFloat(totalKmExcel) * parseFloat(totalKgExcel)).toFixed(0) : "Pendiente cálculo";
  const co2Estimado = parseFloat(totalKmExcel) > 0 ? (parseFloat(totalKmExcel) * parseFloat(totalKgExcel) / 1000 * 0.15).toFixed(1) : "Pendiente cálculo";

  r2.push([]);
  r2.push(["── MEDICIÓN CO₂ ──────────────────────────────"]);
  r2.push(["Total solicitudes período:",solicitudes.length]);
  r2.push(["Total km recorridos (período):",parseFloat(totalKmExcel)>0?totalKmExcel+" km":"Pendiente cálculo"]);
  r2.push([]);
  r2.push(["Índice TKM (Abbott) — km × kg:", tkmAbbot]);
  r2.push([]);
  r2.push(["CO₂ Estimado (Estándar Mercado):", co2Estimado+" kg CO₂"]);
  r2.push(["Solicitudes SPOT Extra:",totalSpot]);
  r2.push(["Solicitudes Overnight:",totalOH]);
  const ws2=XLSX.utils.aoa_to_sheet(r2);
  ws2["!cols"]=[{wch:38},{wch:15},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen Ejecutivo");
  XLSX.writeFile(wb, nombreArchivo);
}

// ── App ────────────────────────────────────────────────────────────────────
export default function QuantrexAbbott() {
  const [solicitudes,setSolicitudes]=useState([]);
  const [cierres,setCierres]=useState([]);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState("dashboard");
  const [selectedId,setSelectedId]=useState(null);
  const [cierreDetalle,setCierreDetalle]=useState(null);
  const [filterTipo,setFilterTipo]=useState("todos");
  const [filterStatus,setFilterStatus]=useState("todos");
  const [filterQ,setFilterQ]=useState("");
  const [form,setForm]=useState(EMPTY_FORM);
  const [formError,setFormError]=useState("");
  const [saving,setSaving]=useState(false);
  const [toast,setToast]=useState(null);
  const [rutas,setRutas]=useState([]);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [usuarios,setUsuarios]=useState(()=>{
    try{const u=localStorage.getItem("qx:usuarios");return u?JSON.parse(u):USUARIOS;}catch{return USUARIOS;}
  });
  const [sesion,setSesion]=useState(()=>{
    try{const s=localStorage.getItem("qx:sesion");if(s){const p=JSON.parse(s);if(p&&p.perfil)return p;}return null;}catch{return null;}
  });
  const [clientes,setClientes]=useState(CLIENTES_DEFAULT);
  const [confirmCierre,setConfirmCierre]=useState(false);
  const [perfilChofer,setPerfilChofer]=useState(null); // null = admin, chofer = objeto chofer
  const [selChofer,setSelChofer]=useState("");
  const [periodo,setPeriodo]=useState(null);
  const [abrirPeriodo,setAbrirPeriodo]=useState(false); // Se activa automáticamente post-cierre
  const [nuevaFechaInicio,setNuevaFechaInicio]=useState("");
  const toastRef=useRef();

  useEffect(()=>{Promise.all([loadSolicitudes(),loadCierres(),loadPeriodo(),loadClientes(),loadRutas()]).then(([s,c,p,cl,r])=>{setSolicitudes(s);setCierres(c);setPeriodo(p);if(cl)setClientes(cl);setRutas(r||[]);if(c.length>0&&!p)setAbrirPeriodo(true);setLoading(false);});},[]);

  function showToast(msg,type="success"){
    setToast({msg,type}); clearTimeout(toastRef.current);
    toastRef.current=setTimeout(()=>setToast(null),3500);
  }

  // Definir paleta según perfil y pantalla

  const periodoBase = periodo || (() => {
    const {inicio,fin}=getPeriodoActual();
    return {inicio:inicio.toISOString().split("T")[0], fin:fin.toISOString().split("T")[0], nombre:getNombrePeriodo(inicio,fin)};
  })();
  const inicioPeriodo = new Date(periodoBase.inicio+"T12:00:00");
  const finPeriodo = new Date(periodoBase.fin+"T12:00:00");
  const nombrePeriodo = periodoBase.nombre;
  const solicitudesPeriodo=solicitudes.filter(s=>fechaEnPeriodo(s.fecha,inicioPeriodo,finPeriodo));
  const yaCerrado=cierres.some(c=>c.nombre===nombrePeriodo);

  async function handleCerrarMes(){
    if(yaCerrado){showToast("Este período ya fue cerrado.","danger");return;}
    exportToExcel(solicitudesPeriodo,`Quantrex_Abbott_${nombrePeriodo.replace(" ","_")}.xlsx`);
    const cierre={id:Date.now().toString(),nombre:nombrePeriodo,
      fechaInicio:periodoBase.inicio,fechaFin:periodoBase.fin,
      total:solicitudesPeriodo.length,completadas:solicitudesPeriodo.filter(s=>s.status==="completada").length,
      cerradoEn:new Date().toISOString(),solicitudes:solicitudesPeriodo};
    const upd=[cierre,...cierres]; setCierres(upd); await saveCierres(upd);
    // Respaldo completo descargable (guárdalo en tu carpeta de Google Drive)
    const stamp=new Date().toISOString().split("T")[0];
    const respaldoOk=descargarRespaldo({
      app:"Quantrex-Abbott", version:1, generadoEn:new Date().toISOString(),
      periodoCerrado:nombrePeriodo,
      datos:{ solicitudes, rutas, cierres:upd, clientes, periodo:periodoBase },
    }, `Quantrex_Respaldo_${nombrePeriodo.replace(/\s+/g,"_")}_${stamp}.json`);
    // Limpiar período para que aparezca la opción de abrir uno nuevo
    setPeriodo(null); await savePeriodo(null);
    setConfirmCierre(false);
    setAbrirPeriodo(true); // Mostrar panel de apertura
    showToast(respaldoOk?"✓ Período cerrado. Excel y respaldo descargados. Define el nuevo período.":"✓ Período cerrado. Define el nuevo período.");
  }

  async function handleAbrirPeriodo(){
    if(!nuevaFechaInicio){showToast("Selecciona la fecha de inicio.","danger");return;}
    // Calcular fin = 30 días después como sugerencia (ajustable)
    const ini = new Date(nuevaFechaInicio+"T12:00:00");
    const fin2 = new Date(ini); fin2.setDate(fin2.getDate()+29);
    const nuevo = {
      inicio: nuevaFechaInicio,
      fin: fin2.toISOString().split("T")[0],
      nombre: getNombrePeriodo(ini, fin2),
    };
    setPeriodo(nuevo); await savePeriodo(nuevo);
    setAbrirPeriodo(false); setNuevaFechaInicio("");
    showToast("✓ Nuevo período abierto: "+nuevo.nombre);
  }

  async function handleSave(){
    if(!form.titulo.trim()){setFormError("El cliente es obligatorio.");return;}
    if(!form.fecha){setFormError("La fecha es obligatoria.");return;}
    if(!form.solicitante){setFormError("Debes seleccionar un solicitante.");return;}
    if(!form.canalSolicitud){setFormError("Debes seleccionar un canal de solicitud.");return;}
    setFormError(""); setSaving(true);
    const autoTransito = form.ppuAsignada && form.usuarioDT ? "en_proceso" : "pendiente";
    const otGenerada = generarOT(solicitudes);
    const nueva={...form,id:Date.now().toString(),status:autoTransito,ot:form.ot||otGenerada,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const upd=[nueva,...solicitudes]; setSolicitudes(upd); await saveSolicitud(nueva);
    setSaving(false); setForm({...EMPTY_FORM,
      fecha:new Date().toISOString().split("T")[0],
      hora:new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false})});
    showToast("Solicitud creada correctamente."); setView("lista");
  }

  // Auto-cierra rutas cuyas paradas estén todas finalizadas. NUNCA reabre: una ruta cerrada
  // (manual o automáticamente) solo puede reabrirla el admin con motivo registrado.
  async function sincronizarRutas(solsActuales){
    const cambiadas=[];
    const upd=rutas.map(r=>{
      if((r.estado||"abierta")==="cerrada") return r;
      if(rutaCerrada(r,solsActuales)){
        const nr={...r,estado:"cerrada",cerradaAt:new Date().toISOString(),cerradaPor:"Automático"};
        cambiadas.push(nr);
        return nr;
      }
      return r;
    });
    if(cambiadas.length){
      setRutas(upd);
      for(const r of cambiadas) await saveRuta(r);
      showToast(`Ruta ${cambiadas.map(r=>r.id).join(", ")} cerrada automáticamente: todas sus paradas finalizadas.`);
    }
  }

  async function handleStatusChange(id,newStatus,canceladoPor=null){
    const now=new Date();
    const fechaHora=now.toLocaleDateString("es-CL")+" "+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false});
    const upd=solicitudes.map(s=>{
      if(s.id!==id)return s;
      const entry={de:STATUS_META[s.status]?.label||s.status,a:STATUS_META[newStatus]?.label||newStatus,
        fechaHora,canceladoPor:canceladoPor||null,id:Date.now().toString()};
      return{...s,status:newStatus,updatedAt:now.toISOString(),
        statusLog:[...(s.statusLog||[]),entry],...(canceladoPor?{canceladoPor}:{})};
    });
    const cambiada=upd.find(s=>s.id===id);
    setSolicitudes(upd); if(cambiada) await saveSolicitud(cambiada);
    await sincronizarRutas(upd);
    showToast(newStatus==="cancelada"?`Cancelada por ${canceladoPor}.`:"Estado actualizado.");
  }

  async function handleEdit(updatedSol){
    const sol = solicitudes.find(s=>s.id===updatedSol.id);
    let newStatus = updatedSol.status;
    // Auto En Tránsito si se asigna PPU y usuarioDT
    if(updatedSol.ppuAsignada && updatedSol.usuarioDT && sol.status==="pendiente"){
      newStatus = "en_proceso";
      const now=new Date();
      const fechaHora=now.toLocaleDateString("es-CL")+" "+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false});
      updatedSol = {...updatedSol, status:newStatus,
        statusLog:[...(updatedSol.statusLog||[]),{id:Date.now().toString(),de:"Pendiente",a:"En Tránsito",fechaHora,canceladoPor:null}]};
    }
    const solActualizada={...updatedSol,updatedAt:new Date().toISOString()};
    const upd=solicitudes.map(s=>s.id===updatedSol.id?solActualizada:s);
    setSolicitudes(upd); await saveSolicitud(solActualizada); 
    await sincronizarRutas(upd);
    showToast("Solicitud actualizada.");
  }

  async function handleEditLog(id,updatedLog){
    const upd=solicitudes.map(s=>s.id===id?{...s,statusLog:updatedLog,updatedAt:new Date().toISOString()}:s);
    const cambiada=upd.find(s=>s.id===id);
    setSolicitudes(upd); if(cambiada) await saveSolicitud(cambiada); showToast("Log actualizado.");
  }

  async function handleChoferEstado(id, nuevoEstado, fotoBase64=null, horaLlegada=null, tiempoEnPunto=null, firmaData=null){
    const now = new Date();
    const fechaHora = now.toLocaleDateString("es-CL")+" "+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false});
    // Obtener geolocalización
    let geoStr = "Sin geolocalización";
    try {
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:8000}));
      geoStr = pos.coords.latitude.toFixed(6)+","+pos.coords.longitude.toFixed(6);
    } catch {}
    const statusLabel = nuevoEstado === "completada" ? "Entregado" : "No Entregado";
    const upd = solicitudes.map(s => {
      if(s.id !== id) return s;
      const entry = {id:Date.now().toString(), de:STATUS_META[s.status]?.label||s.status,
        a:statusLabel, fechaHora, canceladoPor:null, geo:geoStr};
      return {...s, status:nuevoEstado, updatedAt:now.toISOString(),
        statusLog:[...(s.statusLog||[]),entry], geoEntrega:geoStr, horaEntrega:fechaHora,
        fotoEntrega:fotoBase64||null, horaLlegada:horaLlegada||null, tiempoEnPunto:tiempoEnPunto||null,
        coordsEntrega:geoStr!=="Sin geolocalización"?geoStr:null,
        firmaReceptor:firmaData?.dataUrl||null, nombreReceptor:firmaData?.nombre||null,
        rechazoFirma:firmaData?.rechazo||false};
    });
    setSolicitudes(upd);
    const solUpd=upd.find(s=>s.id===id);
    if(solUpd) await saveSolicitud(solUpd);
    await sincronizarRutas(upd);
    showToast(statusLabel+" registrado.");
  }

  async function handleDelete(id){
    const upd=solicitudes.filter(s=>s.id!==id); setSolicitudes(upd); await deleteSolicitud(id);
    showToast("Solicitud eliminada.","danger"); setView("lista");
  }

  const filtered=solicitudes.filter(s=>{
    if(filterTipo!=="todos"&&s.tipo!==filterTipo)return false;
    if(filterStatus!=="todos"&&s.status!==filterStatus)return false;
    if(filterQ&&!s.titulo.toLowerCase().includes(filterQ.toLowerCase())&&!s.guia?.toLowerCase().includes(filterQ.toLowerCase()))return false;
    return true;
  });

  const selected=solicitudes.find(s=>s.id===selectedId);
  const stats={total:solicitudesPeriodo.length,
    pendiente:solicitudesPeriodo.filter(s=>s.status==="pendiente").length,
    en_proceso:solicitudesPeriodo.filter(s=>s.status==="en_proceso").length,
    completada:solicitudesPeriodo.filter(s=>s.status==="completada").length,
    no_entregado:solicitudesPeriodo.filter(s=>s.status==="no_entregado").length};

  const excelNombre=`Quantrex_Abbott_${new Date().toISOString().split("T")[0]}.xlsx`;

  const esChofer = !!perfilChofer || sesion?.perfil === "chofer";
  const esEscritorio = typeof window !== "undefined" && window.innerWidth >= 900;

  return (
    <div style={S.root}>
      {toast&&<div style={{...S.toast,background:toast.type==="danger"?C.danger:toast.type==="warning"?C.warning:C.success}}>{toast.msg}</div>}
      {sesion&&<header style={{...S.header,...(esEscritorio?{padding:"0 40px",maxWidth:"100%"}:{})}}>
        {sesion?.perfil==="admin"&&<button style={{background:"transparent",border:"none",color:C.cyan,fontSize:22,cursor:"pointer",padding:"4px 8px",flexShrink:0}} onClick={()=>setSidebarOpen(p=>!p)}>≡</button>}
        <div style={S.logoWrap}>
          <div><div style={S.logoTitle}>QUANTREX</div><div style={S.logoSub}>GESTIÓN LOGÍSTICA · Abbott</div></div>
        </div>
        <nav style={S.nav}>
          {[...( sesion?.perfil==="chofer"?[["lista","Solicitudes"]]:[["dashboard","Panel"],["lista","Solicitudes"],...(["admin","operador"].includes(sesion?.perfil)?[["rutas","Rutas"]]:[]),...(sesion?.perfil!=="cliente"?[["nueva","+ Nueva"]]:[]) ])].map(([v,l])=>(
            <button key={v} style={{...S.navBtn,...(view===v||(view==="detalle"&&v==="lista")||(view==="cierre_detalle"&&v==="cierres")?S.navBtnActive:{})}}
              onClick={()=>setView(v)}>{l}</button>
          ))}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:11,color:C.muted}}>{sesion?.nombre}</span>
            <button style={{...S.exportBtn,fontSize:11,borderColor:C.danger,color:C.danger}} onClick={()=>{setSesion(null);try{localStorage.removeItem("qx:sesion");}catch{}}}>Salir</button>
          </div>
        </nav>
      </header>}
      {sesion?.perfil==="admin"&&sidebarOpen&&(
        <div style={{position:"fixed",top:0,left:0,bottom:0,width:260,background:C.navySurface,borderRight:"1px solid "+C.border,zIndex:200,display:"flex",flexDirection:"column",boxShadow:"4px 0 20px #0006"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:"1px solid "+C.border}}>
            <div style={{fontSize:13,fontWeight:800,color:C.cyan,letterSpacing:1}}>ADMINISTRACIÓN</div>
            <button style={{background:"transparent",border:"none",color:C.muted,fontSize:20,cursor:"pointer"}} onClick={()=>setSidebarOpen(false)}>✕</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4,padding:"12px 12px",flex:1,overflowY:"auto"}}>
            {[
              {id:"usuarios",label:"👥 Gestión de Usuarios"},
              {id:"clientes",label:"🏥 Clientes Abbott"},
              {id:"cierres",label:"📁 Cierres de Período"},
            ].map(item=>(
              <button key={item.id} style={{background:view===item.id?C.cyan+"22":"transparent",border:"1px solid "+(view===item.id?C.cyan:C.border),color:view===item.id?C.cyan:C.textSecondary,borderRadius:8,padding:"10px 14px",textAlign:"left",cursor:"pointer",fontSize:13,fontWeight:600}}
                onClick={()=>{setView(item.id);setSidebarOpen(false);}}>
                {item.label}
              </button>
            ))}
          </div>
          <div style={{padding:"12px 20px",borderTop:"1px solid "+C.border,fontSize:11,color:C.muted}}>
            Quantrex · Panel Admin
          </div>
        </div>
      )}
      {sesion?.perfil==="admin"&&sidebarOpen&&<div style={{position:"fixed",inset:0,background:"#0006",zIndex:199}} onClick={()=>setSidebarOpen(false)}/>}
      <main style={{...S.main,...(esEscritorio&&!esChofer?{maxWidth:1400,margin:"0 auto",padding:"24px 40px"}:{})}}>
        {loading?(<div style={S.loadingWrap}><div style={S.spinner}/><p style={{color:C.muted}}>Cargando...</p></div>)
        :!sesion?(<PantallaLogin onLogin={(u)=>{setSesion(u);try{localStorage.setItem("qx:sesion",JSON.stringify(u));}catch{}registrarAcceso(u.email);if(u.perfil==="chofer")setPerfilChofer(u);}}/>)
        :perfilChofer||sesion?.perfil==="chofer"?(<VistaChofer chofer={perfilChofer||sesion} solicitudes={solicitudes} onEstado={handleChoferEstado} onSalir={()=>{setPerfilChofer(null);setSesion(null);}}/>)
        :view==="chofer_login"?(<LoginChofer selChofer={selChofer} setSelChofer={setSelChofer} onAcceder={()=>{const c=CHOFERES.find(ch=>ch.nombre===selChofer);if(c){setPerfilChofer(c);setView("dashboard");}}} onVolver={()=>setView("dashboard")}/>)
        :view==="dashboard"?(<Dashboard stats={stats} solicitudes={solicitudes} solicitudesPeriodo={solicitudesPeriodo}
            nombrePeriodo={nombrePeriodo} inicio={inicioPeriodo} fin={finPeriodo} yaCerrado={yaCerrado}
            setView={setView} setSelectedId={setSelectedId}
            confirmCierre={confirmCierre} setConfirmCierre={setConfirmCierre} onCerrarMes={handleCerrarMes}
            abrirPeriodo={abrirPeriodo} setAbrirPeriodo={setAbrirPeriodo}
            nuevaFechaInicio={nuevaFechaInicio} setNuevaFechaInicio={setNuevaFechaInicio}
            onAbrirPeriodo={handleAbrirPeriodo} sesion={sesion}
            onExport={()=>{const now=new Date();const ts=now.toLocaleDateString("es-CL").replace(/\//g,"-")+"_"+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false}).replace(":","h");exportToExcel(solicitudesPeriodo,`Quantrex_Abbott_${nombrePeriodo.replace(" ","_")}_${ts}.xlsx`);}}/>)
        :view==="nueva"?(<FormNueva form={form} setForm={setForm} onSave={handleSave} saving={saving} error={formError} setView={setView} clientes={clientes} solicitudes={solicitudes} rutas={rutas}/>)
        :view==="detalle"&&selected?(<Detalle sol={selected} onStatusChange={handleStatusChange}
            onDelete={handleDelete} onEdit={handleEdit} onEditLog={handleEditLog} setView={setView} clientes={clientes} sesion={sesion} solicitudes={solicitudes}/>)
        :view==="usuarios"?(<AdminUsuarios usuarios={usuarios} choferes={CHOFERES} onSave={(u,c)=>{setUsuarios(u);try{localStorage.setItem("qx:usuarios",JSON.stringify(u));}catch{};}} setView={setView}/>)
        :view==="clientes"?(<AdminClientes clientes={clientes} onSave={async (cl)=>{setClientes(cl);await saveClientes(cl);}} setView={setView}/>)
        :view==="rutas"?(<GestionRutas rutas={rutas} setRutas={setRutas} solicitudes={solicitudes} setSolicitudes={setSolicitudes} onSaveRuta={saveRuta} onDeleteRuta={deleteRuta} onSaveSolicitud={saveSolicitud} setView={setView} sesion={sesion}/>)
        :view==="cierres"?(<Cierres cierres={cierres} onDetalle={c=>{setCierreDetalle(c);setView("cierre_detalle");}}
            onExport={c=>exportToExcel(c.solicitudes,`Quantrex_Abbott_${c.nombre.replace(" ","_")}.xlsx`)}/>)
        :view==="cierre_detalle"&&cierreDetalle?(<CierreDetalle cierre={cierreDetalle} setView={setView}
            onExport={()=>exportToExcel(cierreDetalle.solicitudes,`Quantrex_Abbott_${cierreDetalle.nombre.replace(" ","_")}.xlsx`)}/>)
        :(<Lista solicitudes={filtered} filterTipo={filterTipo} setFilterTipo={setFilterTipo}
            filterStatus={filterStatus} setFilterStatus={setFilterStatus}
            filterQ={filterQ} setFilterQ={setFilterQ}
            onSelect={id=>{setSelectedId(id);setView("detalle");}}
            onExport={()=>exportToExcel(solicitudes,excelNombre)} total={solicitudes.length}/>)
        }
      </main>
    </div>
  );
}

// ── ResumenMes ─────────────────────────────────────────────────────────────

function GraficoCobros({ solicitudes }) {
  const P_SPOT=50000, P_OH=85000, M1=2840000, M2=2840000;
  function hm(h){if(!h)return null;const[hh,mm]=h.split(":").map(Number);return isNaN(hh)?null:hh*60+(mm||0);}
  function l17(log){return(log||[]).some(e=>{const p=(e.fechaHora||"").split(" ");if(p.length<2)return false;const m=hm(p[1]);return m!==null&&m>=17*60;});}
  const contN={};let tSpot=0,tOH=0;
  solicitudes.forEach(s=>{
    const f=s.fecha||"x",m=hm(s.hora),a830=s.tipo==="carga_ol"&&m!==null&&m<8*60+30,lT=l17(s.statusLog),esOH=a830||lT;
    if(esOH){tOH++;}else{contN[f]=(contN[f]||0)+1;if(contN[f]>6)tSpot++;}
  });
  // SPOT Regional — recargo por destinos fuera de la RM (misma tabla del Excel)
  let mSpotReg=0, nSpotReg=0;
  solicitudes.forEach(s=>{
    const reg=detectarRegion(s.direccion||s.destino||"");
    const v=reg?(reg.valor||0):0;
    if(v>0){mSpotReg+=v;nSpotReg++;}
  });
  const tNP=solicitudes.filter(s=>s.noPresentacion).length*Math.round(2840000/30);
  const mFijo=M1+M2,mSpot=tSpot*P_SPOT,mOH=tOH*P_OH;
  const total=mFijo+mSpot+mOH+mSpotReg-tNP;
  if(total<=0) return null;

  const segmentos=[
    {label:"OC Mensual",valor:mFijo,color:"#1B3FA0"},
    {label:"SPOT Extra",valor:mSpot,color:"#F59E0B"},
    {label:"Overnight",valor:mOH,color:"#38BDF8"},
    ...(mSpotReg>0?[{label:`SPOT Regional (${nSpotReg})`,valor:mSpotReg,color:"#A78BFA"}]:[]),
    ...(tNP>0?[{label:"Descuento NP",valor:tNP,color:"#EF4444",negativo:true}]:[]),
  ];
  const positivos=segmentos.filter(s=>!s.negativo&&s.valor>0);
  const totalPos=positivos.reduce((a,s)=>a+s.valor,0);

  // Generar arcos SVG
  const cx=100,cy=100,R=75,Ri=45;
  let ang=-Math.PI/2;
  const slices=positivos.map(s=>{
    const pct=s.valor/totalPos;
    const end=ang+pct*2*Math.PI;
    const x1=cx+R*Math.cos(ang),y1=cy+R*Math.sin(ang);
    const x2=cx+R*Math.cos(end),y2=cy+R*Math.sin(end);
    const xi1=cx+Ri*Math.cos(end),yi1=cy+Ri*Math.sin(end);
    const xi2=cx+Ri*Math.cos(ang),yi2=cy+Ri*Math.sin(ang);
    const lg=pct>0.5?1:0;
    const d="M"+x1+","+y1+" A"+R+","+R+" 0 "+lg+",1 "+x2+","+y2+" L"+xi1+","+yi1+" A"+Ri+","+Ri+" 0 "+lg+",0 "+xi2+","+yi2+" Z";
    ang=end;
    return {...s,d};
  });

  return(
    <div style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:12,padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:11,fontWeight:700,color:C.cyan,letterSpacing:1.5,textTransform:"uppercase"}}>Composición Total Pre Cierre</div>
      <div style={{display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
        <svg viewBox="0 0 200 200" style={{width:160,height:160,flexShrink:0}}>
          {slices.map((s,i)=><path key={i} d={s.d} fill={s.color} opacity={0.9}/>)}
          <text x="100" y="96" textAnchor="middle" style={{fontSize:10,fill:C.textSecondary}}>Total</text>
          <text x="100" y="112" textAnchor="middle" style={{fontSize:9,fill:C.textPrimary,fontWeight:"bold"}}>{"$"+Math.round(total/1000)+"K"}</text>
        </svg>
        <div style={{display:"flex",flexDirection:"column",gap:8,flex:1}}>
          {segmentos.map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:10,height:10,borderRadius:2,background:s.color,flexShrink:0}}/>
              <div style={{flex:1,fontSize:12,color:C.textSecondary}}>{s.label}</div>
              <div style={{fontSize:13,fontWeight:700,color:s.negativo?C.danger:C.textPrimary}}>
                {s.negativo?"-":""}{"$"+s.valor.toLocaleString("es-CL")}
              </div>
            </div>
          ))}
          <div style={{borderTop:"1px solid "+C.border,paddingTop:8,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:12,fontWeight:700,color:C.textPrimary}}>Total Pre Cierre</span>
            <span style={{fontSize:13,fontWeight:900,color:C.cyan}}>{"$"+total.toLocaleString("es-CL")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}


function ResumenMes({solicitudes}){
  const P_SPOT=50000,P_OH=85000,M1=2840000,M2=2840000;
  function hm(h){if(!h)return null;const[hh,mm]=h.split(":").map(Number);return isNaN(hh)?null:hh*60+(mm||0);}
  function l17(log){return(log||[]).some(e=>{const p=(e.fechaHora||"").split(" ");if(p.length<2)return false;const m=hm(p[1]);return m!==null&&m>=17*60;});}
  const contD={},contN={};let tSpot=0,tOH=0;
  solicitudes.forEach(s=>{
    const f=s.fecha||"sin-fecha",m=hm(s.hora);
    const a830=s.tipo==="carga_ol"&&m!==null&&m<8*60+30,lT=l17(s.statusLog),esOH=a830||lT;
    if(esOH){tOH++;}else{contN[f]=(contN[f]||0)+1;if(contN[f]>6)tSpot++;}
  });
  const mSpot=tSpot*P_SPOT,mOH=tOH*P_OH,tMov=M1+M2;
  const tNP=solicitudes.filter(s=>s.noPresentacion).length*Math.round(2840000/30);
  const gran=mSpot+mOH+tMov-tNP;
  return(
    <div style={{background:C.navySurface,border:`1px solid ${C.cyan}44`,borderRadius:12,padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:11,fontWeight:700,color:C.cyan,letterSpacing:1.5,textTransform:"uppercase"}}>Resumen de cobros · OC-4000255637</div>
      <div style={{background:C.navy,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.blue}44`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:11,color:C.textSecondary,fontWeight:700,marginBottom:2}}>OC-4000255637</div>
          <div style={{fontSize:11,color:C.muted}}>Quantrex M1 + M2 · Mensual fijo</div></div>
        <div style={{fontSize:22,fontWeight:900,color:C.textPrimary}}>${tMov.toLocaleString("es-CL")}</div>
      </div>
      {(tSpot>0||tOH>0)&&(
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {tSpot>0&&<div style={{flex:1,minWidth:140,background:C.navy,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.warning}44`}}>
            <div style={{fontSize:11,color:C.warning,fontWeight:700,marginBottom:4}}>SPOT Extra</div>
            <div style={{fontSize:11,color:C.muted}}>{tSpot} solicitudes</div>
            <div style={{fontSize:18,fontWeight:900,color:C.warning,marginTop:4}}>${mSpot.toLocaleString("es-CL")}</div>
          </div>}
          {tOH>0&&<div style={{flex:1,minWidth:140,background:C.navy,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.info}44`}}>
            <div style={{fontSize:11,color:C.info,fontWeight:700,marginBottom:4}}>Overnight</div>
            <div style={{fontSize:11,color:C.muted}}>{tOH} solicitudes</div>
            <div style={{fontSize:18,fontWeight:900,color:C.info,marginTop:4}}>${mOH.toLocaleString("es-CL")}</div>
          </div>}
        </div>
      )}
      {tNP>0&&<div style={{background:C.navy,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.danger}44`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:11,color:C.danger,fontWeight:700,marginBottom:2}}>No presentación de vehículo</div>
          <div style={{fontSize:11,color:C.muted}}>{solicitudes.filter(s=>s.noPresentacion).length} día(s) · descuento aplicado</div></div>
        <div style={{fontSize:18,fontWeight:900,color:C.danger}}>-${tNP.toLocaleString("es-CL")}</div>
      </div>}
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:13,fontWeight:700,color:C.textPrimary}}>Gran total a cobrar</div>
        <div style={{fontSize:22,fontWeight:900,color:C.cyan}}>${gran.toLocaleString("es-CL")}</div>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({stats,solicitudes,solicitudesPeriodo,nombrePeriodo,inicio,fin,yaCerrado,setView,setSelectedId,confirmCierre,setConfirmCierre,onCerrarMes,abrirPeriodo,setAbrirPeriodo,nuevaFechaInicio,setNuevaFechaInicio,onAbrirPeriodo,sesion,rutas=[],onExport}){
  const esAdmin=sesion?.perfil==="admin";
  const esCliente=sesion?.perfil==="cliente";
  const fmt=d=>d.toLocaleDateString("es-CL",{day:"numeric",month:"long"});
  return(
    <div style={S.section}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={S.pageTitle}>Dashboard</div>
        {solicitudes.length>0&&!esCliente&&<button style={{...S.exportBtn,display:"flex",alignItems:"center",gap:6}} onClick={onExport}><span>📥</span><span>Reporte</span></button>}
      </div>
      <div style={{...S.periodoBanner,borderColor:yaCerrado?C.muted:C.cyan}}>
        <div style={{flex:1}}>
          <div style={{fontSize:11,fontWeight:700,color:yaCerrado?C.muted:C.cyan,letterSpacing:1.5,textTransform:"uppercase",marginBottom:4}}>{yaCerrado?"✓ Período cerrado":"Período activo"}</div>
          <div style={{fontWeight:800,fontSize:16,color:C.textPrimary}}>{nombrePeriodo}</div>
          <div style={{fontSize:12,color:C.textSecondary,marginTop:2}}>{fmt(inicio)} → {fmt(fin)} · {solicitudesPeriodo.length} solicitudes</div>
        </div>
        {esAdmin&&(yaCerrado
          ?<div style={{...S.badge,background:C.success+"22",color:C.success}}>Cerrado</div>
          :!confirmCierre
            ?<button style={S.btnCierre} onClick={()=>setConfirmCierre(true)}>Cerrar Mes</button>
            :<div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
              <div style={{fontSize:12,color:C.warning,fontWeight:600}}>¿Exportar y cerrar {nombrePeriodo}?</div>
              <div style={{display:"flex",gap:8}}>
                <button style={{...S.statusBtn,border:`1px solid ${C.muted}`,color:C.muted,fontSize:12}} onClick={()=>setConfirmCierre(false)}>Cancelar</button>
                <button style={{...S.statusBtn,background:C.cyan,color:"#fff",border:"none",fontSize:12}} onClick={onCerrarMes}>Confirmar</button>
              </div>
            </div>
        )}
      </div>
      {abrirPeriodo && (
        <div style={{background:C.navySurface,border:"1px solid "+C.cyan,borderRadius:12,padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:13,fontWeight:800,color:C.cyan}}>Abrir nuevo período de facturación</div>
          <div style={{fontSize:12,color:C.textSecondary}}>Define la fecha de inicio del nuevo período. El fin se calculará automáticamente en 30 días.</div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{display:"flex",flexDirection:"column",gap:4,flex:1}}>
              <label style={S.label}>Fecha de inicio</label>
              <input style={S.input} type="date" value={nuevaFechaInicio} onChange={e=>setNuevaFechaInicio(e.target.value)}/>
            </div>
            <div style={{display:"flex",gap:8,alignSelf:"flex-end"}}>
              <button style={{...S.btnSec,fontSize:13}} onClick={()=>setAbrirPeriodo(false)}>Cancelar</button>
              <button style={S.btnCierre} onClick={onAbrirPeriodo}>Abrir período</button>
            </div>
          </div>
        </div>
      )}
      <div style={S.statsGrid}>
        {[["Total",stats.total,C.cyan],["Pendientes",stats.pendiente,C.warning],["En Tránsito",stats.en_proceso,C.info],["Completadas",stats.completada,C.success]].map(([l,v,col])=>(
          <div key={l} style={{...S.statCard,borderTop:`3px solid ${col}`}}>
            <div style={{...S.statNum,color:col}}>{v}</div>
            <div style={S.statLabel}>{l}</div>
          </div>
        ))}
      </div>
      {stats.no_entregado>0&&(
        <div style={{background:"#F9731611",border:"1px solid #F97316",borderRadius:12,padding:"14px 18px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:11,fontWeight:700,color:"#F97316",letterSpacing:1.5,textTransform:"uppercase"}}>⚠ No Entregados — Requieren atención</div>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{fontSize:36,fontWeight:900,color:"#F97316"}}>{stats.no_entregado}</div>
            <div style={{fontSize:13,color:C.textSecondary}}>solicitud(es) marcadas como No Entregado en el período activo</div>
          </div>
          <button style={{...S.exportBtn,fontSize:12,borderColor:"#F97316",color:"#F97316",alignSelf:"flex-start"}}
            onClick={()=>setView("lista")}>
            Ver solicitudes →
          </button>
        </div>
      )}
      {esAdmin&&<ResumenMes solicitudes={solicitudesPeriodo}/>}
      {esAdmin&&<GraficoCobros solicitudes={solicitudesPeriodo}/>}
      {esAdmin&&<ResumenKmDia solicitudes={solicitudes} rutas={rutas}/>}
      {(esAdmin||esCliente)&&<ResumenCO2 solicitudes={solicitudesPeriodo} rutas={rutas}/>}
      {esCliente&&<div style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:12,padding:"14px 18px",display:"flex",gap:16,flexWrap:"wrap"}}><div style={{fontSize:12,color:C.textSecondary}}>📦 <strong style={{color:C.textPrimary}}>{solicitudesPeriodo.length}</strong> solicitudes en el período actual</div><div style={{fontSize:12,color:C.textSecondary}}>✓ <strong style={{color:C.success}}>{solicitudesPeriodo.filter(s=>s.status==="completada").length}</strong> completadas</div><div style={{fontSize:12,color:C.textSecondary}}>🚚 <strong style={{color:C.info}}>{solicitudesPeriodo.filter(s=>s.status==="en_proceso").length}</strong> en tránsito</div></div>}
      <div style={S.sectionTitle}>Solicitudes recientes</div>
      {solicitudes.length===0?<EmptyState msg="Sin solicitudes aún." action={()=>setView("nueva")}/>
        :[...solicitudes].sort((a,b)=>{
            const f=(b.fecha||"").localeCompare(a.fecha||"");
            return f!==0?f:(b.createdAt||"").localeCompare(a.createdAt||"");
          }).slice(0,3).map(s=><SolicitudRow key={s.id} sol={s} onSelect={id=>{setSelectedId(id);setView("detalle");}}/>)}
      {solicitudes.length>3&&<button style={S.linkBtn} onClick={()=>setView("lista")}>Ver todas →</button>}
    </div>
  );
}

// ── Cierres ────────────────────────────────────────────────────────────────
function Cierres({cierres,onDetalle,onExport}){
  return(
    <div style={S.section}>
      <div style={S.pageTitle}>Historial de Cierres</div>
      {cierres.length===0?<EmptyState msg="No hay períodos cerrados aún."/>
        :cierres.map(c=>(
          <div key={c.id} style={{...S.row,cursor:"default"}}>
            <div style={{...S.rowIcon,background:C.cyan+"22",color:C.cyan,fontSize:14}}>✓</div>
            <div style={S.rowBody}>
              <div style={S.rowTitle}>{c.nombre}</div>
              <div style={S.rowMeta}><span style={{color:C.textSecondary}}>{c.fechaInicio} → {c.fechaFin}</span><span style={{color:C.muted}}> · {c.total} solicitudes</span></div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...S.exportBtn,fontSize:11}} onClick={()=>onExport(c)}>⬇ Excel</button>
              <button style={{...S.exportBtn,fontSize:11,borderColor:C.blue,color:C.cyan}} onClick={()=>onDetalle(c)}>Ver →</button>
            </div>
          </div>
        ))}
    </div>
  );
}

function CierreDetalle({cierre,setView,onExport}){
  return(
    <div style={S.section}>
      <button style={S.backBtn} onClick={()=>setView("cierres")}>← Volver</button>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div><div style={S.pageTitle}>{cierre.nombre}</div>
          <div style={{color:C.textSecondary,fontSize:13}}>{cierre.fechaInicio} → {cierre.fechaFin} · {cierre.total} solicitudes</div></div>
        <button style={S.exportBtn} onClick={onExport}>⬇ Excel</button>
      </div>
      {cierre.solicitudes.map(s=><SolicitudRow key={s.id} sol={s} onSelect={()=>{}}/>)}
    </div>
  );
}

// ── Lista ──────────────────────────────────────────────────────────────────
function Lista({solicitudes,filterTipo,setFilterTipo,filterStatus,setFilterStatus,filterQ,setFilterQ,onSelect,onExport,total,sesion}){
  const esCliente=sesion?.perfil==="cliente";
  return(
    <div style={S.section}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={S.pageTitle}>Solicitudes Abbott</div>
        {total>0&&sesion?.perfil!=="cliente"&&<button style={{...S.exportBtn,display:"flex",alignItems:"center",gap:6}} onClick={onExport}><span>📥</span><span>Reporte</span></button>}
      </div>
      <div style={S.filters}>
        <input style={S.searchInput} placeholder="Buscar por cliente o guía..." value={filterQ} onChange={e=>setFilterQ(e.target.value)}/>
        <select style={S.select} value={filterTipo} onChange={e=>setFilterTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {Object.entries(TYPE_META).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <select style={S.select} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="todos">Todos los estados</option>
          {Object.entries(STATUS_META).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      {solicitudes.length===0?<EmptyState msg="No hay solicitudes que coincidan."/>
        :solicitudes.map(s=><SolicitudRow key={s.id} sol={s} onSelect={onSelect}/>)}
    </div>
  );
}

function SolicitudRow({sol,onSelect}){
  const tm=TYPE_META[sol.tipo]||{label:sol.tipo,icon:"·",color:"#6B8CAE"};
  const sm=STATUS_META[sol.status]||{label:sol.status,color:"#6B8CAE"};
  return(
    <div style={{...S.row,cursor:onSelect?"pointer":"default"}} onClick={()=>onSelect&&onSelect(sol.id)}>
      <div style={{...S.rowIcon,background:tm.color+"22",color:tm.color}}>{tm.icon}</div>
      <div style={S.rowBody}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          {sol.ot&&<span style={{fontSize:11,fontWeight:800,color:C.cyan,background:C.cyan+"18",padding:"2px 7px",borderRadius:6}}>{sol.ot}</span>}
          <span style={S.rowTitle}>{sol.titulo}</span>
        </div>
        <div style={S.rowMeta}>
          <span style={{color:C.textSecondary}}>{tm.label}</span>
          <span style={{color:C.muted}}> · {sol.fecha}</span>
          {sol.noPresentacion&&<span style={{color:C.danger}}> · NP</span>}
        </div>
      </div>
      <div style={{...S.badge,background:sm.color+"22",color:sm.color}}>{sm.label}</div>
    </div>
  );
}

// ── Detalle ────────────────────────────────────────────────────────────────
function Detalle({sol,onStatusChange,onDelete,onEdit,onEditLog,setView,clientes=CLIENTES_DEFAULT,sesion,solicitudes=[]}){
  const esAdmin=sesion?.perfil==="admin";
  const tm=TYPE_META[sol.tipo]||{label:sol.tipo,icon:"·",color:"#6B8CAE"};
  const sm=STATUS_META[sol.status]||{label:sol.status,color:"#6B8CAE"};
  const [confirmDel,setConfirmDel]=useState(false);
  const [cancelando,setCancelando]=useState(false);
  const [canceladoPor,setCanceladoPor]=useState("");
  const [editMode,setEditMode]=useState(false);
  const [editForm,setEditForm]=useState({...sol});
  const fe=k=>e=>{
    const upd={...editForm,[k]:e.target.value};
    if(k==="titulo"){const s=clientes.find(c=>(c.id?c.id+" - "+c.nombre:c.nombre)===e.target.value);if(s){upd.direccion=s.direccion;upd.notas=s.notas;}}
    setEditForm(upd);
  };

  if(editMode) return(
    <div style={S.section}>
      <button style={S.backBtn} onClick={()=>setEditMode(false)}>← Cancelar edición</button>
      <div style={S.pageTitle}>Editar Solicitud</div>
      <div style={S.formGrid}>
        <div style={S.fGroup}><label style={S.label}>Tipo *</label>
          <select style={S.input} value={editForm.tipo} onChange={fe("tipo")}>
            {Object.entries(TYPE_META).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Prioridad</label>
          <select style={S.input} value={editForm.prioridad} onChange={fe("prioridad")}>
            <option value="urgente">🔴 Urgente</option><option value="normal">🟡 Normal</option>
          </select></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}>
          <label style={S.label}>Cliente *</label>
          <select style={S.input} value={editForm.titulo} onChange={fe("titulo")}>
            <option value="">-- Seleccionar cliente --</option>
            {clientes.flatMap((c,i)=>{
              const label=c.id?c.id+" - "+c.nombre:c.nombre;
              const base=[<option key={"c"+i} value={label}>{label}</option>];
              const subs=(c.sucursales||[]).map((s,si)=>{
                const sl=label+" — "+s.nombre;
                return <option key={"s"+i+"-"+si} value={sl}>{"  ↳ "+s.nombre}</option>;
              });
              return [...base,...subs];
            })}
          </select></div>
        {editForm.titulo==="000-2 - Dhl Atlantis"&&<div style={{...S.fGroup,gridColumn:"1/-1"}}>
          <label style={S.label}>Destino</label>
          <select style={S.input} value={editForm.destino||""} onChange={e=>{
            const sel=clientes.find(c=>(c.id?c.id+" - "+c.nombre:c.nombre)===e.target.value);
            setEditForm(p=>({...p,destino:e.target.value,
              direccion:sel?.direccion||p.direccion,
              descripcion:sel?.nombre?`Despacho a ${sel.nombre}`:"",
              notas:sel?.notas||p.notas}));
          }}>
            <option value="">-- Seleccionar destino --</option>
            {clientes.flatMap((c,i)=>{
              const label=c.id?c.id+" - "+c.nombre:c.nombre;
              const base=[<option key={"c"+i} value={label}>{label}</option>];
              const subs=(c.sucursales||[]).map((s,si)=>{
                const sl=label+" — "+s.nombre;
                return <option key={"s"+i+"-"+si} value={sl}>{"  ↳ "+s.nombre}</option>;
              });
              return [...base,...subs];
            })}
          </select></div>}
        <div style={S.fGroup}><label style={S.label}>Fecha *</label>
          <input style={S.input} type="date" value={editForm.fecha} onChange={fe("fecha")}/></div>
        <div style={S.fGroup}><label style={S.label}>Hora</label>
          <input style={S.input} type="time" value={editForm.hora} onChange={fe("hora")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Dirección</label>
          <input style={S.input} value={editForm.direccion} onChange={fe("direccion")}/></div>
        <div style={S.fGroup}><label style={S.label}>Contacto</label>
          <input style={S.input} value={editForm.contacto} onChange={fe("contacto")}/></div>
        <div style={S.fGroup}><label style={S.label}>Chofer Asignado</label>
          <select style={S.input} value={editForm.choferAsignado||""} onChange={fe("choferAsignado")}>
            <option value="">-- Seleccionar --</option>
            {CHOFERES.map(c=><option key={c.nombre} value={c.nombre}>{c.nombre} · {c.ppu}</option>)}
          </select></div>
        <div style={S.fGroup}><label style={S.label}>OT Quantrex</label>
          <input style={{...S.input,background:C.navy,color:C.cyan,fontWeight:700}} value={editForm.ot||""} readOnly/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>N° Guías / Documentos Cliente (separar con coma)</label>
          <input style={S.input} placeholder="Ej: Factura 001, Guía 123, OC 456" value={editForm.documentos||""} onChange={fe("documentos")}/></div>
        <div style={S.fGroup}><label style={S.label}>Solicitante *</label>
          <select style={S.input} value={editForm.solicitante} onChange={fe("solicitante")}>
            <option value="">-- Seleccionar --</option>
            <option value="Jorge Monsalve">Jorge Monsalve</option>
            <option value="Yeneidi Rodriguez">Yeneidi Rodriguez</option>
            <option value="Andres Barrios">Andres Barrios</option>
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Canal de Solicitud</label>
          <select style={S.input} value={editForm.canalSolicitud} onChange={fe("canalSolicitud")}>
            <option value="">-- Seleccionar --</option>
            <option value="WhatsApp">WhatsApp</option>
            <option value="Email">Email</option>
            <option value="Llamada Telefónica">Llamada Telefónica</option>
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Usuario DispatchTrack</label>
          <select style={S.input} value={editForm.usuarioDT} onChange={fe("usuarioDT")}>
            <option value="">-- Seleccionar --</option>
            <option value="Quantrex M1">Quantrex M1</option>
            <option value="Quantrex M2">Quantrex M2</option>
          </select></div>
        <div style={S.fGroup}><label style={S.label}>PPU Asignada</label>
          <select style={S.input} value={editForm.ppuAsignada} onChange={fe("ppuAsignada")}>
            <option value="">-- Seleccionar --</option>
            {["KRYX27","PBGJ33","PZGH22","THVZ21","PJSF91","THFY22","Otro"].map(p=><option key={p} value={p}>{p}</option>)}
          </select></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Descripción</label>
          <textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={editForm.descripcion} onChange={fe("descripcion")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Notas internas Quantrex</label>
          <textarea style={{...S.input,minHeight:50,resize:"vertical"}} value={editForm.notas} onChange={fe("notas")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1",borderTop:`1px solid ${C.border}`,paddingTop:12}}>
          <label style={{...S.label,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
            <input type="checkbox" checked={editForm.noPresentacion||false} onChange={e=>setEditForm(p=>({...p,noPresentacion:e.target.checked,vehiculoNP:"",motivoNP:""}))}/>
            <span style={{color:C.danger}}>Registrar no presentación de vehículo (descuento)</span>
          </label></div>
        {editForm.noPresentacion&&<>
          <div style={S.fGroup}><label style={S.label}>Vehículo no presentado</label>
            <select style={S.input} value={editForm.vehiculoNP||""} onChange={fe("vehiculoNP")}>
              <option value="">-- Seleccionar --</option>
              <option value="Quantrex M1">Quantrex M1</option>
              <option value="Quantrex M2">Quantrex M2</option>
            </select></div>
          <div style={S.fGroup}><label style={S.label}>Motivo</label>
            <input style={S.input} value={editForm.motivoNP||""} onChange={fe("motivoNP")}/></div>
          <div style={{...S.fGroup,gridColumn:"1/-1"}}>
            <div style={{background:C.navy,border:`1px solid ${C.danger}44`,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.danger,fontWeight:600}}>
              Descuento: ${Math.round(2840000/30).toLocaleString("es-CL")}
            </div></div>
        </>}
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
        <button style={S.btnSec} onClick={()=>setEditMode(false)}>Cancelar</button>
        <button style={S.btnPri} onClick={()=>{onEdit(editForm);setEditMode(false);}}>Guardar cambios</button>
      </div>
    </div>
  );

  return(
    <div style={S.section}>
      <button style={S.backBtn} onClick={()=>setView("lista")}>← Volver</button>
      <div style={S.detailHeader}>
        <div style={{...S.detailIcon,background:tm.color+"22",color:tm.color}}>{tm.icon}</div>
        <div style={{flex:1}}>
          <div style={S.pageTitle}>{sol.titulo}</div>
          <div style={{color:C.textSecondary,fontSize:13}}>{tm.label} · {sol.fecha}{sol.hora&&` · ${sol.hora}`}</div>
        </div>
        <div style={{...S.badge,background:sm.color+"22",color:sm.color}}>{sm.label}</div>
        {esAdmin||sesion?.perfil==="operador"?<button style={{...S.exportBtn,fontSize:12}} onClick={()=>setEditMode(true)}>✎ Editar</button>:null}
      </div>
      <div style={S.detailGrid}>
        {[["Dirección",sol.direccion],["Contacto",sol.contacto],["N° Guía",sol.guia],
          ["Prioridad",sol.prioridad==="urgente"?"🔴 Urgente":"🟡 Normal"],
          ["Solicitante",sol.solicitante],["Canal",sol.canalSolicitud],
          ["Usuario DT",sol.usuarioDT],["OT Quantrex",sol.ot],["PPU Asignada",sol.ppuAsignada],["Chofer",sol.choferAsignado]
        ].filter(([,v])=>v).map(([l,v])=>(
          <div key={l} style={S.detailField}><div style={S.fieldLabel}>{l}</div><div style={S.fieldValue}>{v}</div></div>
        ))}
      </div>
      {sol.titulo==="000-2 - Dhl Atlantis"&&sol.destino&&<div style={S.detailBlock}><div style={S.fieldLabel}>Destino</div><div style={S.fieldValue}>{sol.destino}</div></div>}
      {sol.noPresentacion&&<div style={{...S.detailBlock,border:`1px solid ${C.danger}44`}}>
        <div style={{...S.fieldLabel,color:C.danger}}>No presentación · {sol.vehiculoNP}</div>
        <div style={S.fieldValue}>{sol.motivoNP} <span style={{color:C.danger,fontWeight:700}}>· Descuento: ${Math.round(2840000/30).toLocaleString("es-CL")}</span></div>
      </div>}
      {sol.documentos&&<div style={S.detailBlock}><div style={S.fieldLabel}>N° Guías / Documentos Cliente</div><div style={S.fieldValue}>{sol.documentos}</div></div>}
      {sol.descripcion&&<div style={S.detailBlock}><div style={S.fieldLabel}>Descripción</div><div style={S.fieldValue}>{sol.descripcion}</div></div>}
      {sol.notas&&<div style={S.detailBlock}><div style={S.fieldLabel}>Notas internas</div><div style={S.fieldValue}>{sol.notas}</div></div>}
      {sol.canceladoPor&&<div style={{...S.detailBlock,border:`1px solid ${C.danger}44`}}><div style={{...S.fieldLabel,color:C.danger}}>Cancelada por</div><div style={S.fieldValue}>{sol.canceladoPor}</div></div>}
      {(sol.firmaReceptor||sol.rechazoFirma)&&(
        <div style={S.detailBlock}>
          <div style={S.fieldLabel}>{sol.rechazoFirma?"Rechazo de firma":"Firma del receptor"}</div>
          {sol.nombreReceptor&&<div style={{fontSize:13,color:C.textPrimary,marginBottom:6}}>👤 {sol.nombreReceptor}</div>}
          {sol.rechazoFirma
            ?<div style={{background:C.danger+"22",border:"1px solid "+C.danger+"44",borderRadius:8,padding:"8px 12px",fontSize:13,color:C.danger,fontWeight:600}}>✗ El receptor se negó a firmar digitalmente</div>
            :<img src={sol.firmaReceptor} alt="Firma receptor" style={{maxWidth:280,borderRadius:8,border:"1px solid "+C.border,background:"#f9f9f9"}}/>
          }
        </div>
      )}
      {sol.horaEntrega&&(
        <div style={S.detailBlock}>
          <div style={S.fieldLabel}>Registro de entrega</div>
          {sol.horaLlegada&&<div style={{fontSize:12,color:C.muted,marginBottom:4}}>📍 Llegada al punto: {sol.horaLlegada}</div>}
          <div style={S.fieldValue}>🕐 Entrega registrada: {sol.horaEntrega}</div>
          {sol.tiempoEnPunto&&<div style={{marginTop:6,background:C.cyan+"18",border:"1px solid "+C.cyan+"44",borderRadius:8,padding:"6px 12px",display:"inline-flex",alignItems:"center",gap:6}}><span style={{fontSize:12,color:C.cyan,fontWeight:700}}>⏱ Tiempo en punto:</span><span style={{fontSize:14,fontWeight:900,color:C.cyan}}>{sol.tiempoEnPunto}</span></div>}
          {sol.geoEntrega&&sol.geoEntrega!=="Sin geolocalización"?(
            <>
              <div style={{fontSize:12,color:C.muted,marginTop:4}}>📍 {sol.geoEntrega}</div>
              <a href={"https://www.google.com/maps?q="+sol.geoEntrega} target="_blank" rel="noreferrer"
                style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,background:C.cyan+"22",border:"1px solid "+C.cyan,color:C.cyan,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,textDecoration:"none"}}>
                📍 Ver en Google Maps
              </a>
            </>
          ):<div style={{fontSize:12,color:C.muted,marginTop:4}}>Sin geolocalización disponible</div>}
          {sol.fotoEntrega&&(
            <div style={{marginTop:12}}>
              <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:6}}>Foto del documento</div>
              <img src={sol.fotoEntrega} alt="Documento entrega" style={{width:"100%",maxWidth:320,borderRadius:10,border:"1px solid "+C.border}}/>
              <a href={sol.fotoEntrega} download="foto_entrega.jpg" target="_blank" rel="noreferrer"
                style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:6,background:C.cyan+"22",border:"1px solid "+C.cyan,color:C.cyan,borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,textDecoration:"none"}}>
                📷 Ver foto completa
              </a>
            </div>
          )}
        </div>
      )}
      <div style={S.fieldLabel}>Cambiar estado</div>
      <div style={S.statusBtns}>
        {Object.entries(STATUS_META).map(([k,v])=>
          k==="cancelada"
            ?<button key={k} onClick={()=>setCancelando(true)} style={{...S.statusBtn,background:sol.status===k?v.color:"transparent",color:sol.status===k?"#fff":v.color,border:`1px solid ${v.color}`}}>{v.label}</button>
            :<button key={k} onClick={()=>onStatusChange(sol.id,k)} style={{...S.statusBtn,background:sol.status===k?v.color:"transparent",color:sol.status===k?"#fff":v.color,border:`1px solid ${v.color}`}}>{v.label}</button>
        )}
      </div>
      {cancelando&&(
        <div style={{background:C.navySurface,border:`1px solid ${C.danger}`,borderRadius:10,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:13,fontWeight:700,color:C.danger}}>¿Quién cancela esta solicitud?</div>
          <select style={S.input} value={canceladoPor} onChange={e=>setCanceladoPor(e.target.value)}>
            <option value="">-- Seleccionar --</option>
            <option value="Jorge Monsalve">Jorge Monsalve</option>
            <option value="Yeneidi Rodriguez">Yeneidi Rodriguez</option>
            <option value="Andres Barrios">Andres Barrios</option>
          </select>
          <div style={{display:"flex",gap:8}}>
            <button style={{...S.statusBtn,border:`1px solid ${C.muted}`,color:C.muted}} onClick={()=>{setCancelando(false);setCanceladoPor("");}}>Cancelar</button>
            <button style={{...S.statusBtn,background:C.danger,color:"#fff",border:"none"}} disabled={!canceladoPor}
              onClick={()=>{onStatusChange(sol.id,"cancelada",canceladoPor);setCancelando(false);setCanceladoPor("");}}>Confirmar</button>
          </div>
        </div>
      )}
      <LogEstados log={sol.statusLog||[]} solId={sol.id} onEditLog={onEditLog} esAdmin={esAdmin}/>
      {esAdmin&&<div style={{marginTop:16}}>
        {!confirmDel
          ?<button style={S.deleteBtn} onClick={()=>setConfirmDel(true)}>Eliminar solicitud</button>
          :<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{color:C.danger,fontSize:13}}>¿Confirmar eliminación?</span>
            <button style={{...S.statusBtn,border:`1px solid ${C.danger}`,color:C.danger}} onClick={()=>onDelete(sol.id)}>Sí, eliminar</button>
            <button style={{...S.statusBtn,border:`1px solid ${C.muted}`,color:C.muted}} onClick={()=>setConfirmDel(false)}>Cancelar</button>
          </div>
        }
      </div>}
    </div>
  );
}

// ── LogEstados ─────────────────────────────────────────────────────────────
function LogEstados({log,solId,onEditLog,esAdmin=true}){
  const [editMode,setEditMode]=useState(false);
  const [editLog,setEditLog]=useState(log);
  const upd=(id,f,v)=>setEditLog(p=>p.map(e=>e.id===id?{...e,[f]:v}:e));
  const del=id=>setEditLog(p=>p.filter(e=>e.id!==id));
  const add=()=>{const n=new Date();setEditLog(p=>[...p,{id:Date.now().toString(),de:"Pendiente",a:"En Tránsito",
    fechaHora:n.toLocaleDateString("es-CL")+" "+n.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false}),canceladoPor:null}]);};
  return(
    <div style={{background:C.navySurface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={S.fieldLabel}>Log de estados</div>
        {esAdmin&&<button style={{...S.exportBtn,fontSize:11,padding:"4px 10px"}} onClick={()=>{setEditMode(!editMode);setEditLog(log);}}>
          {editMode?"Cancelar":"✎ Editar log"}
        </button>}
      </div>
      {log.length===0&&!editMode&&<div style={{fontSize:12,color:C.muted}}>Sin cambios registrados.</div>}
      {!editMode?log.map((e,i)=>(
        <div key={i} style={{fontSize:12,color:C.textSecondary,display:"flex",gap:6,alignItems:"center"}}>
          <span style={{color:C.cyan}}>→</span>
          <span style={{color:C.textPrimary,fontWeight:600}}>{e.de} → {e.a}</span>
          <span style={{color:C.muted}}>· {(e.fechaHora||"").split(" ")[1]||e.fechaHora}</span>
          {e.canceladoPor&&<span style={{color:C.danger}}>· {e.canceladoPor}</span>}
        </div>
      )):(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {editLog.map(e=>(
            <div key={e.id} style={{background:C.navy,borderRadius:8,padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <select style={{...S.input,flex:1,fontSize:12,padding:"5px 8px"}} value={e.de} onChange={ev=>upd(e.id,"de",ev.target.value)}>
                  {Object.values(STATUS_META).map(v=><option key={v.label} value={v.label}>{v.label}</option>)}
                </select>
                <span style={{color:C.muted,alignSelf:"center"}}>→</span>
                <select style={{...S.input,flex:1,fontSize:12,padding:"5px 8px"}} value={e.a} onChange={ev=>upd(e.id,"a",ev.target.value)}>
                  {Object.values(STATUS_META).map(v=><option key={v.label} value={v.label}>{v.label}</option>)}
                </select>
              </div>
              <input style={{...S.input,fontSize:12,padding:"5px 8px"}} value={e.fechaHora}
                placeholder="DD/MM/YYYY HH:MM (24hrs)" onChange={ev=>upd(e.id,"fechaHora",ev.target.value)}/>
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <button style={{...S.statusBtn,border:`1px solid ${C.danger}`,color:C.danger,fontSize:11,padding:"3px 10px"}} onClick={()=>del(e.id)}>Eliminar</button>
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
            <button style={{...S.exportBtn,fontSize:11}} onClick={add}>+ Agregar entrada</button>
            <button style={{...S.btnPri,fontSize:12,padding:"7px 16px"}} onClick={()=>{onEditLog(solId,editLog);setEditMode(false);}}>Guardar log</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FormNueva ──────────────────────────────────────────────────────────────
function FormNueva({form,setForm,onSave,saving,error,setView,clientes=CLIENTES_DEFAULT,solicitudes=[],rutas=[]}){
  const f=k=>e=>setForm(p=>{
    const u={...p,[k]:e.target.value};
    if(k==="tipo")u.prioridad=PRIORIDAD_DEFAULT[e.target.value]||"normal";
    if(k==="titulo"){const s=clientes.find(c=>(c.id?c.id+" - "+c.nombre:c.nombre)===e.target.value);if(s){u.direccion=s.direccion;u.notas=s.notas;u.destino="";}}
    return u;
  });
  return(
    <div style={S.section}>
      <div style={S.pageTitle}>Nueva Solicitud</div>
      <div style={S.formGrid}>
        <div style={S.fGroup}><label style={S.label}>Tipo *</label>
          <select style={S.input} value={form.tipo} onChange={f("tipo")}>
            {Object.entries(TYPE_META).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Prioridad</label>
          <select style={S.input} value={form.prioridad} onChange={f("prioridad")}>
            <option value="urgente">🔴 Urgente</option><option value="normal">🟡 Normal</option>
          </select></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}>
          <label style={S.label}>Cliente *</label>
          <select style={S.input} value={form.titulo} onChange={f("titulo")}>
            <option value="">-- Seleccionar cliente --</option>
            {clientes.flatMap((c,i)=>{
              const label=c.id?c.id+" - "+c.nombre:c.nombre;
              const base=[<option key={"c"+i} value={label}>{label}</option>];
              const subs=(c.sucursales||[]).map((s,si)=>{
                const sl=label+" — "+s.nombre;
                return <option key={"s"+i+"-"+si} value={sl}>{"  ↳ "+s.nombre}</option>;
              });
              return [...base,...subs];
            })}
          </select></div>
        {/* Alerta cliente con solicitudes activas hoy */}
        {form.titulo&&(()=>{
          const hoy=new Date().toISOString().split("T")[0];
          const activas=solicitudes.filter(s=>s.titulo===form.titulo&&s.fecha===hoy&&s.status!=="cancelada"&&s.status!=="completada");
          return activas.length>0?(<div style={{...S.fGroup,gridColumn:"1/-1"}}>
            <div style={{background:C.warning+"22",border:"1px solid "+C.warning,borderRadius:8,padding:"10px 14px",fontSize:13,color:C.warning,fontWeight:600}}>
              ⚠ Este cliente ya tiene {activas.length} solicitud(es) activa(s) hoy. Se generará una nueva OT.
            </div>
          </div>):null;
        })()}
        {form.titulo==="000-2 - Dhl Atlantis"&&<div style={{...S.fGroup,gridColumn:"1/-1"}}>
          <label style={S.label}>Destino</label>
          <select style={S.input} value={form.destino} onChange={e=>{
            const sel=clientes.find(c=>(c.id?c.id+" - "+c.nombre:c.nombre)===e.target.value);
            setForm(p=>({...p,destino:e.target.value,
              direccion:sel?.direccion||p.direccion,
              descripcion:sel?.nombre?`Despacho a ${sel.nombre}`:"",
              notas:sel?.notas||p.notas}));
          }}>
            <option value="">-- Seleccionar destino --</option>
            {clientes.flatMap((c,i)=>{
              const label=c.id?c.id+" - "+c.nombre:c.nombre;
              const base=[<option key={"c"+i} value={label}>{label}</option>];
              const subs=(c.sucursales||[]).map((s,si)=>{
                const sl=label+" — "+s.nombre;
                return <option key={"s"+i+"-"+si} value={sl}>{"  ↳ "+s.nombre}</option>;
              });
              return [...base,...subs];
            })}
          </select></div>}
        <div style={S.fGroup}><label style={S.label}>Fecha *</label>
          <input style={S.input} type="date" value={form.fecha} onChange={f("fecha")}/></div>
        <div style={S.fGroup}><label style={S.label}>Hora</label>
          <input style={S.input} type="time" value={form.hora} onChange={f("hora")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Dirección</label>
          <input style={S.input} placeholder="Dirección de entrega" value={form.direccion} onChange={f("direccion")}/></div>
        <div style={S.fGroup}><label style={S.label}>Contacto</label>
          <input style={S.input} placeholder="Nombre / teléfono" value={form.contacto} onChange={f("contacto")}/></div>
        <div style={S.fGroup}><label style={S.label}>Solicitante *</label>
          <select style={S.input} value={form.solicitante} onChange={f("solicitante")}>
            <option value="">-- Seleccionar --</option>
            <option value="Jorge Monsalve">Jorge Monsalve</option>
            <option value="Yeneidi Rodriguez">Yeneidi Rodriguez</option>
            <option value="Andres Barrios">Andres Barrios</option>
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Canal de Solicitud *</label>
          <select style={S.input} value={form.canalSolicitud} onChange={f("canalSolicitud")}>
            <option value="">-- Seleccionar --</option>
            <option value="WhatsApp">WhatsApp</option>
            <option value="Email">Email</option>
            <option value="Llamada Telefónica">Llamada Telefónica</option>
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Usuario DispatchTrack</label>
          <select style={S.input} value={form.usuarioDT} onChange={f("usuarioDT")}>
            <option value="">-- Seleccionar --</option>
            <option value="Quantrex M1">Quantrex M1</option>
            <option value="Quantrex M2">Quantrex M2</option>
          </select></div>
        <div style={S.fGroup}><label style={S.label}>PPU Asignada</label>
          <select style={S.input} value={form.ppuAsignada} onChange={f("ppuAsignada")}>
            <option value="">-- Seleccionar --</option>
            {["KRYX27","PBGJ33","PZGH22","THVZ21","PJSF91","THFY22","Otro"].map(p=><option key={p} value={p}>{p}</option>)}
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Chofer Asignado</label>
          <select style={S.input} value={form.choferAsignado} onChange={f("choferAsignado")}>
            <option value="">-- Seleccionar --</option>
            {CHOFERES.map(c=><option key={c.nombre} value={c.nombre}>{c.nombre} · {c.ppu}</option>)}
          </select></div>
        <div style={S.fGroup}><label style={S.label}>Asignar a Ruta</label>
          <select style={S.input} value={form.rutaId} onChange={f("rutaId")}>
            <option value="">-- Sin ruta --</option>
            {rutas.map(r=><option key={r.id} value={r.id}>{r.id} · {r.fecha} · {r.vehiculo}</option>)}
          </select></div>
        <div style={S.fGroup}><label style={S.label}>OT Quantrex</label>
          <input style={{...S.input,background:C.navy,color:C.cyan,fontWeight:700}} value={form.ot||"Se genera automáticamente"} readOnly/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>N° Guías / Documentos Cliente (separar con coma)</label>
          <input style={S.input} placeholder="Ej: Factura 001, Guía 123, OC 456" value={form.documentos} onChange={f("documentos")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Descripción</label>
          <textarea style={{...S.input,minHeight:60,resize:"vertical"}} placeholder="Detalle de la carga..." value={form.descripcion} onChange={f("descripcion")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Notas internas Quantrex</label>
          <textarea style={{...S.input,minHeight:50,resize:"vertical"}} placeholder="Instrucciones al equipo..." value={form.notas} onChange={f("notas")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1",borderTop:`1px solid ${C.border}`,paddingTop:12,marginTop:4}}>
          <label style={{...S.label,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
            <input type="checkbox" checked={form.noPresentacion} onChange={e=>setForm(p=>({...p,noPresentacion:e.target.checked,vehiculoNP:"",motivoNP:""}))}/>
            <span style={{color:C.danger}}>Registrar no presentación de vehículo (descuento)</span>
          </label></div>
        {form.noPresentacion&&<>
          <div style={S.fGroup}><label style={S.label}>Vehículo no presentado</label>
            <select style={S.input} value={form.vehiculoNP} onChange={f("vehiculoNP")}>
              <option value="">-- Seleccionar --</option>
              <option value="Quantrex M1">Quantrex M1</option>
              <option value="Quantrex M2">Quantrex M2</option>
            </select></div>
          <div style={S.fGroup}><label style={S.label}>Motivo</label>
            <input style={S.input} placeholder="Describe el motivo..." value={form.motivoNP} onChange={f("motivoNP")}/></div>
          <div style={{...S.fGroup,gridColumn:"1/-1"}}>
            <div style={{background:C.navy,border:`1px solid ${C.danger}44`,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.danger,fontWeight:600}}>
              Descuento a aplicar: ${Math.round(2840000/30).toLocaleString("es-CL")} · ($2.840.000 / 30 días)
            </div></div>
        </>}
      </div>
      {error&&<div style={{color:C.danger,fontSize:13,fontWeight:600}}>{error}</div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
        <button style={S.btnSec} onClick={()=>setView("lista")}>Cancelar</button>
        <button style={S.btnPri} onClick={onSave} disabled={saving}>{saving?"Guardando…":"Crear solicitud"}</button>
      </div>
    </div>
  );
}



// ── Pantalla Login ─────────────────────────────────────────────────────────
function PantallaLogin({onLogin}){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [modo,setModo]=useState("login");
  const [cambioRequerido,setCambioRequerido]=useState(null);
  const [nuevaPassword,setNuevaPassword]=useState("");

  function handleLogin(){
    const u=USUARIOS.find(u=>u.email===email&&u.password===password);
    if(u){
      if(debeCambiarPassword(u)){
        setCambioRequerido(u);
      } else {
        onLogin(u);
      }
    }
    else{setError("Email o contraseña incorrectos.");}
  }

  return(
    <div style={{minHeight:"100vh",background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:16,padding:"32px 28px",width:"100%",maxWidth:380,display:"flex",flexDirection:"column",gap:20}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:900,fontSize:22,letterSpacing:3,color:"#fff",fontStyle:"italic",marginBottom:4}}>QUANTREX</div>
          <div style={{fontSize:11,color:C.cyan,letterSpacing:2,fontWeight:600}}>GESTIÓN LOGÍSTICA · Abbott</div>
        </div>

        {cambioRequerido?(
          <>
            <div style={{textAlign:"center",marginBottom:8}}>
              <div style={{fontSize:14,fontWeight:700,color:C.warning}}>⚠ Cambio de contraseña requerido</div>
              <div style={{fontSize:12,color:C.muted,marginTop:4}}>Es el primer día del mes. Por seguridad debes actualizar tu contraseña.</div>
            </div>
            <div style={S.fGroup}>
              <label style={S.label}>Nueva contraseña</label>
              <input style={S.input} type="password" placeholder="Nueva contraseña" value={nuevaPassword} onChange={e=>setNuevaPassword(e.target.value)}/>
            </div>
            <button style={{...S.btnPri,width:"100%",padding:"13px",fontSize:15,opacity:nuevaPassword.length>=6?1:0.5}}
              disabled={nuevaPassword.length<6}
              onClick={()=>{
                const u={...cambioRequerido,password:nuevaPassword};
                marcarPasswordCambiado(u.email);
                onLogin(u);
              }}>
              Actualizar y continuar
            </button>
            <div style={{fontSize:11,color:C.muted,textAlign:"center"}}>Mínimo 6 caracteres</div>
          </>
        ):modo==="login"?(
          <>
            <div style={S.fGroup}>
              <label style={S.label}>Email</label>
              <input style={S.input} type="email" placeholder="usuario@quantrex.cl"
                value={email} onChange={e=>setEmail(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
            </div>
            <div style={S.fGroup}>
              <label style={S.label}>Contraseña</label>
              <input style={S.input} type="password" placeholder="••••••••"
                value={password} onChange={e=>setPassword(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
            </div>
            {error&&<div style={{color:C.danger,fontSize:13,fontWeight:600,textAlign:"center"}}>{error}</div>}
            <button style={{...S.btnPri,width:"100%",padding:"13px",fontSize:15}} onClick={handleLogin}>
              Ingresar
            </button>
            <button style={{background:"transparent",border:"none",color:C.cyan,cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"center"}}
              onClick={()=>setModo("chofer")}>
              🚗 Soy chofer — acceder aquí
            </button>
          </>
        ):(
          <>
            <div style={{textAlign:"center",fontSize:13,color:C.textSecondary}}>Selecciona tu nombre para ver tus entregas del día</div>
            <div style={S.fGroup}>
              <label style={S.label}>Chofer</label>
              <select style={{...S.input,fontSize:15,padding:"12px"}} value={email} onChange={e=>setEmail(e.target.value)}>
                <option value="">-- Selecciona tu nombre --</option>
                {CHOFERES.map(c=><option key={c.nombre} value={c.nombre}>{c.nombre} · {c.ppu}</option>)}
              </select>
            </div>
            <button style={{...S.btnPri,width:"100%",padding:"13px",fontSize:15,opacity:email?1:0.5}}
              disabled={!email}
              onClick={()=>{const c=CHOFERES.find(ch=>ch.nombre===email);if(c)onLogin({...c,perfil:"chofer",nombre:c.nombre});}}>
              Ingresar como Chofer
            </button>
            <button style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:13,textAlign:"center"}}
              onClick={()=>{setModo("login");setEmail("");}}>
              ← Volver al login
            </button>
          </>
        )}
      </div>
    </div>
  );
}



// ── Gestión de Rutas ───────────────────────────────────────────────────────
const VEHICULOS = [
  {id:"M1", label:"M1 · Felipe Hernandez", ppu:"KRYX27"},
  {id:"M2", label:"M2 · Italo Loiza", ppu:"PBGJ33"},
  {id:"M3", label:"M3 · Cristian Donoso", ppu:"PZGH22"},
];

function GestionRutas({rutas,setRutas,solicitudes,setSolicitudes,onSaveRuta,onDeleteRuta,onSaveSolicitud,setView,sesion}){
  const hoy=new Date().toISOString().split("T")[0];
  const [nuevaRuta,setNuevaRuta]=useState(false);
  const [formRuta,setFormRuta]=useState({nombre:"",fecha:hoy,vehiculo:"M1"});
  const [rutaDetalle,setRutaDetalle]=useState(null);
  const [agregandoParada,setAgregandoParada]=useState(false);
  const [kmCalculando,setKmCalculando]=useState(false);

  function generarIdRuta(){
    return "RUTA-"+(rutas.length+1).toString().padStart(3,"0");
  }

  async function crearRuta(){
    const idRuta=generarIdRuta();
    const r={id:idRuta,nombre:idRuta,fecha:formRuta.fecha,
      vehiculo:formRuta.vehiculo,paradas:[],kmTotal:null,estado:"abierta",cerradaPor:null,reaperturas:[],createdAt:new Date().toISOString()};
    const upd=[r,...rutas];
    setRutas(upd); await onSaveRuta(r);
    setNuevaRuta(false); setFormRuta({nombre:"",fecha:hoy,vehiculo:"M1"});
    setRutaDetalle(r.id);
  }

  async function eliminarRuta(id){
    if(!window.confirm("¿Eliminar esta ruta?"))return;
    setRutas(rutas.filter(r=>r.id!==id));
    await onDeleteRuta(id);
    if(rutaDetalle===id)setRutaDetalle(null);
  }

  async function agregarParada(rutaId, solId, orden){
    const upd=rutas.map(r=>{
      if(r.id!==rutaId)return r;
      const paradas=[...r.paradas.filter(p=>p.solId!==solId),{solId,orden:r.paradas.length+1}]
        .sort((a,b)=>a.orden-b.orden);
      return {...r,paradas};
    });
    setRutas(upd);
    const ruta=upd.find(r=>r.id===rutaId);
    if(ruta) await onSaveRuta(ruta);
    // Actualizar solicitud con ID de ruta
    const sol=solicitudes.find(s=>s.id===solId);
    if(sol){
      const solUpd={...sol,rutaId};
      setSolicitudes(solicitudes.map(s=>s.id===solId?solUpd:s));
      await onSaveSolicitud(solUpd);
    }
  }

  async function quitarParada(rutaId, solId){
    const upd=rutas.map(r=>{
      if(r.id!==rutaId)return r;
      return {...r,paradas:r.paradas.filter(p=>p.solId!==solId)};
    });
    setRutas(upd);
    const ruta=upd.find(r=>r.id===rutaId);
    if(ruta) await onSaveRuta(ruta);
    const sol=solicitudes.find(s=>s.id===solId);
    if(sol){
      const solUpd={...sol,rutaId:null};
      setSolicitudes(solicitudes.map(s=>s.id===solId?solUpd:s));
      await onSaveSolicitud(solUpd);
    }
  }

  async function moverParada(rutaId, solId, dir){
    const ruta=rutas.find(r=>r.id===rutaId);
    if(!ruta)return;
    const idx=ruta.paradas.findIndex(p=>p.solId===solId);
    if((dir===-1&&idx===0)||(dir===1&&idx===ruta.paradas.length-1))return;
    const paradas=[...ruta.paradas];
    [paradas[idx],paradas[idx+dir]]=[paradas[idx+dir],paradas[idx]];
    paradas.forEach((p,i)=>p.orden=i+1);
    const upd=rutas.map(r=>r.id===rutaId?{...r,paradas}:r);
    setRutas(upd);
    await onSaveRuta(upd.find(r=>r.id===rutaId));
  }

  async function cambiarVehiculo(rutaId, vehiculo){
    const upd=rutas.map(r=>r.id===rutaId?{...r,vehiculo}:r);
    setRutas(upd);
    await onSaveRuta(upd.find(r=>r.id===rutaId));
  }

  async function calcularKmRuta(rutaId){
    const ruta=rutas.find(r=>r.id===rutaId);
    if(!ruta||ruta.paradas.length===0)return;
    setKmCalculando(rutaId);
    const paradaSols=ruta.paradas.map(p=>solicitudes.find(s=>s.id===p.solId)).filter(Boolean);
    
    let total=0;
    let origen=ORIGEN_PUDAHUEL;
    let primera=true;

    for(const s of paradaSols){
      if(!s.direccion)continue;
      
      if(primera){
        primera=false;
        if(s.tipo==="carga_ol"){
          // Carga OL: siempre es punto de salida desde Pudahuel, nunca destino
          origen=ORIGEN_PUDAHUEL;
          continue;
        } else if(s.tipo==="li_retiro"){
          // LI Retiro como primera parada: es el origen de la ruta
          origen=s.direccion+", Chile";
          continue;
        }
        // LI Devolución, Entrega/Despacho: siempre cuentan como destino
      }
      
      // Calcular distancia desde el origen actual hasta este destino
      const destCoords=await geocodificar(s.direccion);
      let origenCoords;
      if(origen===ORIGEN_PUDAHUEL){
        origenCoords=PUDAHUEL_COORDS;
      } else {
        origenCoords=await geocodificar(origen.replace(", Chile",""));
      }
      if(destCoords&&origenCoords){
        const km=haversineKm(origenCoords.lat,origenCoords.lon,destCoords.lat,destCoords.lon);
        total+=parseFloat(km);
      }
      origen=s.direccion+", Chile";
    }
    
    const upd=rutas.map(r=>r.id===rutaId?{...r,kmTotal:total.toFixed(1)}:r);
    setRutas(upd);
    await onSaveRuta(upd.find(r=>r.id===rutaId));
    setKmCalculando(null);
  }

  const perfil=sesion?.perfil;
  const puedeReabrir=perfil==="admin";

  async function cerrarRutaManual(rutaId){
    const ruta=rutas.find(r=>r.id===rutaId);
    if(!ruta)return;
    if((ruta.paradas||[]).length===0){window.alert("La ruta no tiene paradas, no se puede cerrar.");return;}
    const pendientes=ruta.paradas.map(p=>solicitudes.find(s=>s.id===p.solId)).filter(Boolean)
      .filter(s=>!ESTADOS_TERMINALES.includes(s.status));
    if(pendientes.length>0 && !window.confirm(`Hay ${pendientes.length} parada(s) sin finalizar. ¿Cerrar la ruta de todas formas?`))return;
    const nr={...ruta,estado:"cerrada",cerradaAt:new Date().toISOString(),cerradaPor:sesion?.nombre||perfil||"Manual"};
    setRutas(rutas.map(r=>r.id===rutaId?nr:r));
    await onSaveRuta(nr);
  }

  async function reabrirRuta(rutaId){
    if(perfil!=="admin"){window.alert("Solo un administrador puede reabrir una ruta.");return;}
    const ruta=rutas.find(r=>r.id===rutaId);
    if(!ruta)return;
    const motivo=(window.prompt("Motivo de la reapertura (queda registrado):")||"").trim();
    if(!motivo){window.alert("Debes indicar un motivo para reabrir la ruta.");return;}
    const now=new Date();
    const sello=now.toLocaleDateString("es-CL")+" "+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false});
    const reaperturas=[...(ruta.reaperturas||[]),{fecha:sello,usuario:sesion?.nombre||"Admin",motivo}];
    const nr={...ruta,estado:"abierta",cerradaAt:null,cerradaPor:null,reaperturas};
    setRutas(rutas.map(r=>r.id===rutaId?nr:r));
    await onSaveRuta(nr);
  }

  const rutaActiva=rutaDetalle?rutas.find(r=>r.id===rutaDetalle):null;
  const solsDisponibles=solicitudes.filter(s=>!s.rutaId||s.rutaId===rutaDetalle);

  return(
    <div style={S.section}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={S.pageTitle}>Gestión de Rutas</div>
        <button style={S.btnPri} onClick={()=>setNuevaRuta(true)}>+ Nueva Ruta</button>
      </div>

      {nuevaRuta&&(
        <div style={{background:C.navySurface,border:"1px solid "+C.cyan,borderRadius:12,padding:"16px"}}>
          <div style={{fontWeight:700,color:C.cyan,marginBottom:12}}>Nueva Ruta — {generarIdRuta()}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={S.fGroup}><label style={S.label}>Fecha</label>
              <input style={S.input} type="date" value={formRuta.fecha} onChange={e=>setFormRuta(p=>({...p,fecha:e.target.value}))}/></div>
            <div style={S.fGroup}><label style={S.label}>Vehículo</label>
              <select style={S.input} value={formRuta.vehiculo} onChange={e=>setFormRuta(p=>({...p,vehiculo:e.target.value}))}>
                {VEHICULOS.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
              </select></div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12}}>
            <button style={S.btnSec} onClick={()=>setNuevaRuta(false)}>Cancelar</button>
            <button style={S.btnPri} onClick={crearRuta}>Crear Ruta</button>
          </div>
        </div>
      )}

      {/* Lista de rutas */}
      {rutas.length===0&&!nuevaRuta&&<EmptyState msg="No hay rutas creadas aún."/>}
      {rutas.map(r=>{
        const veh=VEHICULOS.find(v=>v.id===r.vehiculo);
        const isOpen=rutaDetalle===r.id;
        const paradaSols=r.paradas.map(p=>solicitudes.find(s=>s.id===p.solId)).filter(Boolean);
        const listaParaCerrar=paradaSols.length>0&&paradaSols.every(s=>ESTADOS_TERMINALES.includes(s.status));
        const estaCerrada=(r.estado||"abierta")==="cerrada";
        return(
          <div key={r.id} style={{background:C.navySurface,border:"1px solid "+(isOpen?C.cyan:C.border),borderRadius:12,overflow:"hidden"}}>
            {/* Header ruta */}
            <div style={{padding:"14px 16px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>setRutaDetalle(isOpen?null:r.id)}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontWeight:800,fontSize:14}}>{r.id}</span>
                  <span style={{fontSize:13,color:C.textSecondary}}>{r.nombre}</span>
                  <span style={{fontSize:11,background:C.cyan+"22",color:C.cyan,padding:"2px 8px",borderRadius:6,fontWeight:700}}>{veh?.label||r.vehiculo}</span>
                  <span style={{fontSize:11,background:(estaCerrada?"#22C55E":"#F59E0B")+"22",color:estaCerrada?"#22C55E":"#F59E0B",padding:"2px 8px",borderRadius:6,fontWeight:700}}>{estaCerrada?"✓ Cerrada":"Abierta"}</span>
                  {!estaCerrada&&listaParaCerrar&&<span style={{fontSize:11,background:"#22C55E22",color:"#22C55E",padding:"2px 8px",borderRadius:6,fontWeight:700}}>Lista para cerrar</span>}
                </div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{r.fecha} · {r.paradas.length} parada(s){r.kmTotal?` · ${r.kmTotal} km`:""}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                {!estaCerrada&&<button style={{...S.exportBtn,fontSize:11}} onClick={e=>{e.stopPropagation();eliminarRuta(r.id);}}>✕</button>}
                <span style={{color:C.muted,fontSize:16}}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>

            {/* Detalle ruta */}
            {isOpen&&(
              <div style={{borderTop:"1px solid "+C.border,padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
                {/* Acciones de cierre / reapertura */}
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  {!estaCerrada
                    ? <button style={{...S.btnPri,fontSize:13}} onClick={()=>cerrarRutaManual(r.id)}>🔒 Cerrar ruta</button>
                    : (<>
                        <button style={{...S.btnSec,fontSize:13,opacity:puedeReabrir?1:.5,cursor:puedeReabrir?"pointer":"not-allowed"}} disabled={!puedeReabrir} onClick={()=>reabrirRuta(r.id)}>🔓 Reabrir ruta</button>
                        {!puedeReabrir&&<span style={{fontSize:11,color:C.muted}}>Solo un administrador puede reabrir.</span>}
                      </>)
                  }
                </div>
                {estaCerrada&&(
                  <div style={{background:C.navy,borderRadius:8,padding:"10px 12px",fontSize:12,color:C.textSecondary}}>
                    Ruta cerrada{r.cerradaPor?` por ${r.cerradaPor}`:""}{r.cerradaAt?` · ${new Date(r.cerradaAt).toLocaleString("es-CL")}`:""}. Edición bloqueada.
                    {(r.reaperturas||[]).length>0&&(
                      <div style={{marginTop:8}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Reaperturas registradas</div>
                        {(r.reaperturas||[]).map((re,i)=>(
                          <div key={i} style={{fontSize:11,color:C.muted,marginBottom:2}}>• {re.fecha} — {re.usuario}: {re.motivo}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {!estaCerrada&&(
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <label style={{...S.label,marginBottom:0}}>Vehículo:</label>
                  {VEHICULOS.map(v=>(
                    <button key={v.id} style={{...S.statusBtn,background:r.vehiculo===v.id?C.cyan+"33":"transparent",border:"1px solid "+(r.vehiculo===v.id?C.cyan:C.border),color:r.vehiculo===v.id?C.cyan:C.muted,fontSize:12}}
                      onClick={()=>cambiarVehiculo(r.id,v.id)}>{v.label}</button>
                  ))}
                </div>
                )}

                {/* Paradas */}
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Paradas en orden</div>
                  {paradaSols.length===0&&<div style={{fontSize:12,color:C.muted}}>Sin paradas. Agrega solicitudes abajo.</div>}
                  {paradaSols.map((s,i)=>{
                    const tm=TYPE_META[s.tipo]||{label:s.tipo,icon:"·",color:"#6B8CAE"};
                    return(
                      <div key={s.id} style={{background:C.navy,borderRadius:8,padding:"10px 12px",marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:18,fontWeight:900,color:C.cyan,minWidth:24}}>{i+1}</span>
                        <div style={{...S.rowIcon,background:tm.color+"22",color:tm.color,width:28,height:28,fontSize:14,flexShrink:0}}>{tm.icon}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.titulo}</div>
                          <div style={{fontSize:11,color:C.muted}}>{s.direccion||"Sin dirección"}</div>
                          <div style={{fontSize:10,fontWeight:700,color:STATUS_META[s.status]?.color||C.muted,marginTop:2}}>{STATUS_META[s.status]?.label||s.status}</div>
                        </div>
                        {!estaCerrada&&(
                        <div style={{display:"flex",gap:4,flexShrink:0}}>
                          <button style={{...S.statusBtn,fontSize:12,padding:"4px 8px"}} onClick={()=>moverParada(r.id,s.id,-1)} disabled={i===0}>↑</button>
                          <button style={{...S.statusBtn,fontSize:12,padding:"4px 8px"}} onClick={()=>moverParada(r.id,s.id,1)} disabled={i===paradaSols.length-1}>↓</button>
                          <button style={{...S.statusBtn,fontSize:11,padding:"4px 8px",border:"1px solid "+C.danger,color:C.danger}} onClick={()=>quitarParada(r.id,s.id)}>✕</button>
                        </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {!estaCerrada&&(<>
                {/* Agregar parada */}
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Agregar solicitud a la ruta</div>
                  <select style={S.input} value="" onChange={e=>{if(e.target.value)agregarParada(r.id,e.target.value);}}>
                    <option value="">-- Seleccionar solicitud --</option>
                    {solicitudes.filter(s=>(!s.rutaId||s.rutaId===r.id)&&!r.paradas.find(p=>p.solId===s.id)).map(s=>(
                      <option key={s.id} value={s.id}>{s.ot||s.id} · {s.titulo} · {s.fecha}</option>
                    ))}
                  </select>
                </div>

                {/* Calcular km */}
                {paradaSols.length>0&&(
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <button style={{...S.exportBtn,fontSize:12}} disabled={kmCalculando===r.id} onClick={()=>calcularKmRuta(r.id)}>
                      {kmCalculando===r.id?"Calculando...":"🗺 Calcular km de la ruta"}
                    </button>
                    {r.kmTotal&&<span style={{fontSize:16,fontWeight:900,color:C.cyan}}>{r.kmTotal} km totales</span>}
                  </div>
                )}
                </>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── Admin Usuarios ─────────────────────────────────────────────────────────
function AdminUsuarios({usuarios,choferes,onSave,setView}){
  const [listaU,setListaU]=useState(usuarios.filter(u=>u.perfil!=="admin"));
  const [listaC,setListaC]=useState(choferes);
  const [tab,setTab]=useState("operadores");
  const [editU,setEditU]=useState(null);
  const [editC,setEditC]=useState(null);
  const [formU,setFormU]=useState({email:"",password:"",nombre:"",perfil:"operador"});
  const [formC,setFormC]=useState({nombre:"",ppu:"",usuarioDT:"Quantrex M1"});
  const [nuevoU,setNuevoU]=useState(false);
  const [nuevoC,setNuevoC]=useState(false);

  function guardarOperador(){
    if(!formU.email||!formU.password||!formU.nombre)return;
    const upd=editU!==null
      ?listaU.map((u,i)=>i===editU?{...formU}:u)
      :[...listaU,{...formU}];
    setListaU(upd);
    const todosUsuarios=[usuarios.find(u=>u.perfil==="admin"),...upd,{email:"info@transportesbs.cl",password:"libre2026",perfil:"cliente",nombre:"Abbott Chile"}];
    onSave(todosUsuarios);
    setEditU(null);setNuevoU(false);setFormU({email:"",password:"",nombre:"",perfil:"operador"});
  }

  function eliminarOperador(i){
    if(!window.confirm("¿Eliminar este usuario?"))return;
    const upd=listaU.filter((_,j)=>j!==i);
    setListaU(upd);
    const todosUsuarios=[usuarios.find(u=>u.perfil==="admin"),...upd,{email:"info@transportesbs.cl",password:"libre2026",perfil:"cliente",nombre:"Abbott Chile"}];
    onSave(todosUsuarios);
  }

  return(
    <div style={S.section}>
      <div style={S.pageTitle}>Gestión de Usuarios</div>
      <div style={{display:"flex",gap:8,marginBottom:4,flexWrap:"wrap"}}>
        {[["operadores","👤 Operadores"],["clientes_acc","🏢 Clientes"],["choferes","🚗 Choferes"]].map(([id,label])=>(
          <button key={id} style={{...S.statusBtn,background:tab===id?C.cyan+"33":"transparent",border:"1px solid "+(tab===id?C.cyan:C.border),color:tab===id?C.cyan:C.muted,fontWeight:700,fontSize:13}}
            onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>

      {tab==="operadores"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",justifyContent:"flex-end"}}>
            <button style={S.btnPri} onClick={()=>{setNuevoU(true);setEditU(null);setFormU({email:"",password:"",nombre:"",perfil:"operador"});}}>+ Nuevo operador</button>
          </div>
          {(nuevoU||editU!==null)&&(
            <div style={{background:C.navySurface,border:"1px solid "+C.cyan,borderRadius:12,padding:"16px"}}>
              <div style={{fontWeight:700,color:C.cyan,marginBottom:12}}>{editU!==null?"Editar operador":"Nuevo operador"}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={S.fGroup}><label style={S.label}>Nombre</label>
                  <input style={S.input} value={formU.nombre} onChange={e=>setFormU(p=>({...p,nombre:e.target.value}))}/></div>
                <div style={S.fGroup}><label style={S.label}>Email</label>
                  <input style={S.input} type="email" value={formU.email} onChange={e=>setFormU(p=>({...p,email:e.target.value}))}/></div>
                <div style={S.fGroup}><label style={S.label}>Contraseña</label>
                  <input style={S.input} type="text" value={formU.password} onChange={e=>setFormU(p=>({...p,password:e.target.value}))}/></div>
                <div style={S.fGroup}><label style={S.label}>Perfil</label>
                  <select style={S.input} value={formU.perfil} onChange={e=>setFormU(p=>({...p,perfil:e.target.value}))}>
                    <option value="operador">Operador</option>
                    <option value="cliente">Cliente (solo lectura)</option>
                  </select></div>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12}}>
                <button style={S.btnSec} onClick={()=>{setNuevoU(false);setEditU(null);}}>Cancelar</button>
                <button style={S.btnPri} onClick={guardarOperador}>Guardar</button>
              </div>
            </div>
          )}
          {listaU.map((u,i)=>(
            <div key={i} style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{u.nombre}</div>
                <div style={{fontSize:12,color:C.muted}}>{u.email} · <span style={{color:C.cyan}}>{u.perfil}</span></div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button style={{...S.exportBtn,fontSize:11}} onClick={()=>{setEditU(i);setNuevoU(false);setFormU({...u});}}>✎ Editar</button>
                <button style={{...S.exportBtn,fontSize:11,borderColor:C.danger,color:C.danger}} onClick={()=>eliminarOperador(i)}>✕</button>
              </div>
            </div>
          ))}
          {listaU.length===0&&!nuevoU&&<EmptyState msg="No hay operadores registrados."/>}
        </div>
      )}

      {tab==="clientes_acc"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",justifyContent:"flex-end"}}>
            <button style={S.btnPri} onClick={()=>{setNuevoU(true);setEditU(null);setFormU({email:"",password:"",nombre:"",perfil:"cliente"});}}>+ Nuevo cliente</button>
          </div>
          {(nuevoU&&formU.perfil==="cliente"||editU!==null&&listaU[editU]?.perfil==="cliente")&&(
            <div style={{background:C.navySurface,border:"1px solid "+C.cyan,borderRadius:12,padding:"16px"}}>
              <div style={{fontWeight:700,color:C.cyan,marginBottom:12}}>{editU!==null?"Editar cliente":"Nuevo cliente"}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={S.fGroup}><label style={S.label}>Nombre / Empresa</label>
                  <input style={S.input} value={formU.nombre} onChange={e=>setFormU(p=>({...p,nombre:e.target.value}))}/></div>
                <div style={S.fGroup}><label style={S.label}>Email</label>
                  <input style={S.input} type="email" value={formU.email} onChange={e=>setFormU(p=>({...p,email:e.target.value}))}/></div>
                <div style={S.fGroup}><label style={S.label}>Contraseña</label>
                  <input style={S.input} type="text" value={formU.password} onChange={e=>setFormU(p=>({...p,password:e.target.value}))}/></div>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12}}>
                <button style={S.btnSec} onClick={()=>{setNuevoU(false);setEditU(null);}}>Cancelar</button>
                <button style={S.btnPri} onClick={()=>{setFormU(p=>({...p,perfil:"cliente"}));guardarOperador();}}>Guardar</button>
              </div>
            </div>
          )}
          {usuarios.filter(u=>u.perfil==="cliente").map((u,i)=>{
            const dias=diasSinAcceso(u.email);
            const cambio=debeCambiarPassword(u);
            return(
              <div key={i} style={{background:C.navySurface,border:"1px solid "+(cambio?C.warning:C.border),borderRadius:10,padding:"12px 16px",display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:13}}>{u.nombre}</div>
                    <div style={{fontSize:12,color:C.muted}}>{u.email}</div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button style={{...S.exportBtn,fontSize:11}} onClick={()=>{
                      const idx=listaU.findIndex(lu=>lu.email===u.email);
                      if(idx>=0){setEditU(idx);setNuevoU(false);setFormU({...u});}
                      else{setNuevoU(true);setEditU(null);setFormU({...u});}
                      setTab("clientes_acc");
                    }}>✎ Editar</button>
                  </div>
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <div style={{background:dias===null?"#333":dias>7?C.danger+"22":C.success+"22",border:"1px solid "+(dias===null?"#555":dias>7?C.danger:C.success),borderRadius:6,padding:"4px 10px",fontSize:11,color:dias===null?C.muted:dias>7?C.danger:C.success,fontWeight:700}}>
                    {dias===null?"Sin accesos registrados":dias===0?"Accedió hoy":dias===1?"Hace 1 día":dias+" días sin acceder"}
                  </div>
                  {cambio&&<div style={{background:C.warning+"22",border:"1px solid "+C.warning,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.warning,fontWeight:700}}>
                    ⚠ Debe cambiar contraseña este mes
                  </div>}
                </div>
              </div>
            );
          })}
          {usuarios.filter(u=>u.perfil==="cliente").length===0&&!nuevoU&&<EmptyState msg="No hay clientes registrados."/>}
        </div>
      )}

      {tab==="choferes"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",justifyContent:"flex-end"}}>
            <button style={S.btnPri} onClick={()=>{setNuevoC(true);setEditC(null);setFormC({nombre:"",ppu:"",usuarioDT:"Quantrex M1"});}}>+ Nuevo chofer</button>
          </div>
          {(nuevoC||editC!==null)&&(
            <div style={{background:C.navySurface,border:"1px solid "+C.cyan,borderRadius:12,padding:"16px"}}>
              <div style={{fontWeight:700,color:C.cyan,marginBottom:12}}>{editC!==null?"Editar chofer":"Nuevo chofer"}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div style={S.fGroup}><label style={S.label}>Nombre</label>
                  <input style={S.input} value={formC.nombre} onChange={e=>setFormC(p=>({...p,nombre:e.target.value}))}/></div>
                <div style={S.fGroup}><label style={S.label}>PPU</label>
                  <input style={S.input} placeholder="Ej: KRYX27" value={formC.ppu} onChange={e=>setFormC(p=>({...p,ppu:e.target.value.toUpperCase()}))}/></div>
                <div style={S.fGroup}><label style={S.label}>Usuario DT</label>
                  <select style={S.input} value={formC.usuarioDT} onChange={e=>setFormC(p=>({...p,usuarioDT:e.target.value}))}>
                    <option>Quantrex M1</option>
                    <option>Quantrex M2</option>
                  </select></div>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12}}>
                <button style={S.btnSec} onClick={()=>{setNuevoC(false);setEditC(null);}}>Cancelar</button>
                <button style={S.btnPri} onClick={()=>{
                  if(!formC.nombre||!formC.ppu)return;
                  const upd=editC!==null?listaC.map((c,i)=>i===editC?{...formC}:c):[...listaC,{...formC}];
                  setListaC(upd);setNuevoC(false);setEditC(null);
                  try{localStorage.setItem("qx:choferes",JSON.stringify(upd));}catch{}
                }}>Guardar</button>
              </div>
            </div>
          )}
          {listaC.map((c,i)=>(
            <div key={i} style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{c.nombre}</div>
                <div style={{fontSize:12,color:C.muted}}>PPU: {c.ppu} · {c.usuarioDT}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button style={{...S.exportBtn,fontSize:11}} onClick={()=>{setEditC(i);setNuevoC(false);setFormC({...c});}}>✎ Editar</button>
                <button style={{...S.exportBtn,fontSize:11,borderColor:C.danger,color:C.danger}} onClick={()=>{const upd=listaC.filter((_,j)=>j!==i);setListaC(upd);try{localStorage.setItem("qx:choferes",JSON.stringify(upd));}catch{};}}>✕</button>
              </div>
            </div>
          ))}
          {listaC.length===0&&!nuevoC&&<EmptyState msg="No hay choferes registrados."/>}
        </div>
      )}
    </div>
  );
}

// ── Admin Clientes ─────────────────────────────────────────────────────────
function AdminClientes({clientes,onSave,setView}){
  const [lista,setLista]=useState(clientes.map(c=>({...c,sucursales:c.sucursales||[]})));
  const [editIdx,setEditIdx]=useState(null);
  const [editData,setEditData]=useState(null);
  const [hayambios,setHayCambios]=useState(false);
  const [buscar,setBuscar]=useState("");
  const [mostrarNuevo,setMostrarNuevo]=useState(false);
  const [nuevoCliente,setNuevoCliente]=useState({id:"",nombre:"",direccion:"",notas:"",sucursales:[]});

  const filtrados=lista.filter(c=>c.nombre.toLowerCase().includes(buscar.toLowerCase())||c.id.includes(buscar));

  function iniciarEdit(idx){
    setEditIdx(idx);
    setEditData({...lista[idx],sucursales:[...(lista[idx].sucursales||[])]});
  }

  function guardarEdit(){
    const nueva=[...lista];
    nueva[editIdx]=editData;
    setLista(nueva); setEditIdx(null); setEditData(null); setHayCambios(true);
  }

  function eliminarCliente(idx){
    if(!window.confirm("¿Eliminar este cliente?"))return;
    const nueva=lista.filter((_,i)=>i!==idx);
    setLista(nueva); setHayCambios(true);
  }

  function agregarSucursal(){
    setEditData(p=>({...p,sucursales:[...p.sucursales,{nombre:"",direccion:"",notas:""}]}));
  }

  function editarSucursal(i,k,v){
    setEditData(p=>{const s=[...p.sucursales];s[i]={...s[i],[k]:v};return{...p,sucursales:s};});
  }

  function eliminarSucursal(i){
    setEditData(p=>({...p,sucursales:p.sucursales.filter((_,j)=>j!==i)}));
  }

  function agregarNuevo(){
    if(!nuevoCliente.nombre.trim()){alert("El nombre es obligatorio.");return;}
    setLista(p=>[...p,{...nuevoCliente}]);
    setNuevoCliente({id:"",nombre:"",direccion:"",notas:"",sucursales:[]});
    setMostrarNuevo(false); setHayCambios(true);
  }

  async function handleGuardar(){
    await onSave(lista);
    setHayCambios(false);
    alert("✓ Clientes guardados correctamente.");
  }

  return(
    <div style={S.section}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={S.pageTitle}>Administrar Clientes</div>
        <div style={{display:"flex",gap:8}}>
          {hayambios&&<button style={{...S.btnPri,fontSize:13}} onClick={handleGuardar}>💾 Guardar cambios</button>}
          <button style={{...S.exportBtn,fontSize:13}} onClick={()=>setMostrarNuevo(true)}>+ Nuevo cliente</button>
        </div>
      </div>

      {hayambios&&<div style={{background:"#3A2000",border:"1px solid "+C.warning,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.warning,fontWeight:600}}>
        ⚠ Tienes cambios sin guardar. Haz clic en "Guardar cambios" para aplicarlos.
      </div>}

      <input style={S.searchInput} placeholder="Buscar cliente por nombre o ID..." value={buscar} onChange={e=>setBuscar(e.target.value)}/>

      {mostrarNuevo&&(
        <div style={{background:C.navySurface,border:"1px solid "+C.cyan,borderRadius:12,padding:"16px"}}>
          <div style={{fontWeight:700,color:C.cyan,marginBottom:12,fontSize:13}}>Nuevo cliente</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={S.fGroup}><label style={S.label}>ID (RUT)</label>
              <input style={S.input} value={nuevoCliente.id} onChange={e=>setNuevoCliente(p=>({...p,id:e.target.value}))}/></div>
            <div style={S.fGroup}><label style={S.label}>Nombre *</label>
              <input style={S.input} value={nuevoCliente.nombre} onChange={e=>setNuevoCliente(p=>({...p,nombre:e.target.value}))}/></div>
            <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Dirección</label>
              <input style={S.input} value={nuevoCliente.direccion} onChange={e=>setNuevoCliente(p=>({...p,direccion:e.target.value}))}/></div>
            <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Notas</label>
              <input style={S.input} value={nuevoCliente.notas} onChange={e=>setNuevoCliente(p=>({...p,notas:e.target.value}))}/></div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12,justifyContent:"flex-end"}}>
            <button style={S.btnSec} onClick={()=>setMostrarNuevo(false)}>Cancelar</button>
            <button style={S.btnPri} onClick={agregarNuevo}>Agregar</button>
          </div>
        </div>
      )}

      {filtrados.map((c,i)=>{
        const idxReal=lista.indexOf(c);
        const enEdicion=editIdx===idxReal;
        return(
          <div key={i} style={{background:C.navySurface,border:"1px solid "+(enEdicion?C.cyan:C.border),borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
            {!enEdicion?(
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{c.id&&<span style={{color:C.muted,marginRight:6}}>{c.id}</span>}{c.nombre}</div>
                    {c.direccion&&<div style={{fontSize:12,color:C.textSecondary,marginTop:2}}>📍 {c.direccion}</div>}
                    {c.notas&&<div style={{fontSize:12,color:C.muted,marginTop:1}}>💬 {c.notas}</div>}
                    {c.sucursales?.length>0&&<div style={{fontSize:11,color:C.cyan,marginTop:2}}>🏢 {c.sucursales.length} sucursal(es)</div>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button style={{...S.exportBtn,fontSize:11}} onClick={()=>iniciarEdit(idxReal)}>✎ Editar</button>
                    <button style={{...S.exportBtn,fontSize:11,borderColor:C.danger,color:C.danger}} onClick={()=>eliminarCliente(idxReal)}>✕</button>
                  </div>
                </div>
              </>
            ):(
              <>
                <div style={{fontWeight:700,color:C.cyan,fontSize:13}}>Editando: {c.nombre}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div style={S.fGroup}><label style={S.label}>ID (RUT)</label>
                    <input style={S.input} value={editData.id} onChange={e=>setEditData(p=>({...p,id:e.target.value}))}/></div>
                  <div style={S.fGroup}><label style={S.label}>Nombre *</label>
                    <input style={S.input} value={editData.nombre} onChange={e=>setEditData(p=>({...p,nombre:e.target.value}))}/></div>
                  <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Dirección principal</label>
                    <input style={S.input} value={editData.direccion} onChange={e=>setEditData(p=>({...p,direccion:e.target.value}))}/></div>
                  <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Notas</label>
                    <input style={S.input} value={editData.notas} onChange={e=>setEditData(p=>({...p,notas:e.target.value}))}/></div>
                </div>
                <div style={{borderTop:"1px solid "+C.border,paddingTop:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Sucursales</div>
                    <button style={{...S.exportBtn,fontSize:11}} onClick={agregarSucursal}>+ Agregar sucursal</button>
                  </div>
                  {editData.sucursales.map((s,si)=>(
                    <div key={si} style={{background:C.navy,borderRadius:8,padding:"10px",marginBottom:8,display:"flex",flexDirection:"column",gap:6}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        <div style={S.fGroup}><label style={S.label}>Nombre sucursal</label>
                          <input style={S.input} placeholder="Ej: Bodega Norte, Piso 7..." value={s.nombre} onChange={e=>editarSucursal(si,"nombre",e.target.value)}/></div>
                        <div style={S.fGroup}><label style={S.label}>Dirección</label>
                          <input style={S.input} value={s.direccion} onChange={e=>editarSucursal(si,"direccion",e.target.value)}/></div>
                        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Notas</label>
                          <input style={S.input} value={s.notas} onChange={e=>editarSucursal(si,"notas",e.target.value)}/></div>
                      </div>
                      <div style={{display:"flex",justifyContent:"flex-end"}}>
                        <button style={{...S.statusBtn,border:"1px solid "+C.danger,color:C.danger,fontSize:11}} onClick={()=>eliminarSucursal(si)}>Eliminar sucursal</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button style={S.btnSec} onClick={()=>{setEditIdx(null);setEditData(null);}}>Cancelar</button>
                  <button style={S.btnPri} onClick={guardarEdit}>Guardar cliente</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── Mapa tramo en detalle solicitud ───────────────────────────────────────
function MapaTramo({ sol, solicitudes }) {
  const [tramo, setTramo] = useState(null);
  const [calculando, setCalculando] = useState(false);

  // Determinar origen: Pudahuel o la solicitud anterior del mismo día y chofer
  function getOrigen() {
    if (!sol.fecha || !sol.direccion) return null;
    const mismaFecha = solicitudes
      .filter(s => s.fecha === sol.fecha && s.id !== sol.id && s.status === "completada")
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    
    const idx = mismaFecha.findIndex(s => {
      // La solicitud anterior a la actual
      return new Date(s.updatedAt) < new Date(sol.updatedAt);
    });
    
    const anterior = mismaFecha.filter(s => new Date(s.updatedAt) < new Date(sol.updatedAt)).pop();
    if (anterior?.direccion) return anterior.direccion + ", Chile";
    return ORIGEN_PUDAHUEL;
  }

  async function calcular() {
    if (!sol.direccion) return;
    setCalculando(true);
    const origen = getOrigen() || ORIGEN_PUDAHUEL;
    const result = await calcularTramo(origen, sol.direccion + ", Chile");
    if(result) {
      setTramo({ ...result, origen });
    } else {
      setTramo({km:"N/D", tiempo:"N/D", mapaUrl:null, origen});
    }
    setCalculando(false);
  }

  if (!sol.direccion) return null;

  return (
    <div style={S.detailBlock}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div style={S.fieldLabel}>Ruta del tramo</div>
        {!tramo&&<button style={{...S.exportBtn,fontSize:11,padding:"4px 10px"}} disabled={calculando} onClick={calcular}>
          {calculando?"Calculando...":"🗺 Ver ruta"}
        </button>}
      </div>
      {tramo?(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:10}}>
            <div style={{background:C.navy,borderRadius:8,padding:"8px 12px",flex:1,border:"1px solid "+C.border}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700}}>DISTANCIA</div>
              <div style={{fontSize:18,fontWeight:900,color:C.cyan}}>{tramo.km} km</div>
            </div>
            <div style={{background:C.navy,borderRadius:8,padding:"8px 12px",flex:1,border:"1px solid "+C.border}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700}}>TIEMPO EST.</div>
              <div style={{fontSize:18,fontWeight:900,color:C.warning}}>{tramo.tiempo}</div>
            </div>
          </div>
          <div style={{fontSize:11,color:C.muted}}>
            📍 {tramo.origen === ORIGEN_PUDAHUEL ? "Desde Pudahuel" : "Desde entrega anterior"}
          </div>
          <img
            src={tramo.mapaUrl}
            alt="Mapa del tramo"
            style={{width:"100%",borderRadius:10,border:"1px solid "+C.border}}
            onError={e=>e.target.style.display="none"}
          />
          <a href={`https://www.google.com/maps/dir/${encodeURIComponent(tramo.origen)}/${encodeURIComponent(sol.direccion+", Chile")}`}
            target="_blank" rel="noreferrer"
            style={{display:"inline-flex",alignItems:"center",gap:6,background:C.cyan+"22",border:"1px solid "+C.cyan,color:C.cyan,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,textDecoration:"none"}}>
            🗺 Abrir en Google Maps
          </a>
        </div>
      ):null}
    </div>
  );
}


// ── Modal Firma Receptor ───────────────────────────────────────────────────
function ModalFirma({ solId, onGuardar, onCerrar }) {
  const canvasRef = useRef(null);
  const [dibujando, setDibujando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [hayFirma, setHayFirma] = useState(false);
  const [modo, setModo] = useState("firma"); // firma | rechazo

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches?.[0] || e;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  function iniciar(e) {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDibujando(true);
  }

  function dibujar(e) {
    e.preventDefault();
    if (!dibujando) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0D1F3C";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHayFirma(true);
  }

  function terminar(e) { e.preventDefault(); setDibujando(false); }

  function limpiar() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHayFirma(false);
  }

  function guardar() {
    if (modo === "rechazo") {
      onGuardar({ rechazo: true, nombre: nombre||"Anónimo", dataUrl: null });
      return;
    }
    if (!hayFirma) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onGuardar({ rechazo: false, nombre: nombre||"Receptor", dataUrl });
  }

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#000000CC",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:16,padding:20,width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:16,fontWeight:800,color:C.navy}}>Firma del receptor</div>
          <button style={{background:"transparent",border:"none",fontSize:20,cursor:"pointer",color:C.muted}} onClick={onCerrar}>✕</button>
        </div>

        <div style={{display:"flex",gap:8}}>
          <button style={{flex:1,padding:"8px",borderRadius:8,border:"2px solid "+(modo==="firma"?"#7C3AED":"#ddd"),background:modo==="firma"?"#7C3AED22":"transparent",color:modo==="firma"?"#7C3AED":C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}}
            onClick={()=>setModo("firma")}>✍️ Firma</button>
          <button style={{flex:1,padding:"8px",borderRadius:8,border:"2px solid "+(modo==="rechazo"?C.danger:"#ddd"),background:modo==="rechazo"?C.danger+"22":"transparent",color:modo==="rechazo"?C.danger:C.muted,fontWeight:700,fontSize:13,cursor:"pointer"}}
            onClick={()=>setModo("rechazo")}>✗ No quiso firmar</button>
        </div>

        {modo==="firma"?(
          <>
            <div style={{fontSize:12,color:C.muted}}>El receptor dibuja su firma con el dedo:</div>
            <div style={{border:"2px solid #ddd",borderRadius:10,overflow:"hidden",background:"#f9f9f9",touchAction:"none"}}>
              <canvas ref={canvasRef} width={380} height={160} style={{display:"block",width:"100%",touchAction:"none"}}
                onMouseDown={iniciar} onMouseMove={dibujar} onMouseUp={terminar} onMouseLeave={terminar}
                onTouchStart={iniciar} onTouchMove={dibujar} onTouchEnd={terminar}/>
            </div>
            <button style={{background:"transparent",border:"1px solid #ddd",borderRadius:8,padding:"6px 12px",fontSize:12,color:C.muted,cursor:"pointer",alignSelf:"flex-start"}}
              onClick={limpiar}>Limpiar firma</button>
          </>
        ):(
          <div style={{background:C.danger+"11",border:"1px solid "+C.danger+"44",borderRadius:10,padding:"12px",fontSize:13,color:C.danger,fontWeight:600}}>
            Se registrará que el receptor se negó a firmar digitalmente.
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <label style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Nombre del receptor</label>
          <input style={{border:"1px solid #ddd",borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none"}}
            placeholder="Nombre completo" value={nombre} onChange={e=>setNombre(e.target.value)}/>
        </div>

        <div style={{display:"flex",gap:10}}>
          <button style={{flex:1,background:"transparent",border:"1px solid #ddd",borderRadius:8,padding:"11px",fontWeight:600,fontSize:14,cursor:"pointer",color:C.muted}}
            onClick={onCerrar}>Cancelar</button>
          <button style={{flex:1,background:modo==="rechazo"?C.danger:"#7C3AED",color:"#fff",border:"none",borderRadius:8,padding:"11px",fontWeight:800,fontSize:14,cursor:"pointer",opacity:(modo==="firma"&&!hayFirma)?0.4:1}}
            disabled={modo==="firma"&&!hayFirma} onClick={guardar}>
            {modo==="rechazo"?"Registrar rechazo":"Guardar firma"}
          </button>
        </div>
      </div>
    </div>

  );
}

// ── Login Chofer ───────────────────────────────────────────────────────────
function LoginChofer({selChofer,setSelChofer,onAcceder,onVolver}){
  return(
    <div style={{...S.section,maxWidth:400,margin:"40px auto"}}>
      <button style={S.backBtn} onClick={onVolver}>← Volver</button>
      <div style={{textAlign:"center",marginBottom:8}}>
        <div style={{fontSize:32,marginBottom:8}}>🚗</div>
        <div style={S.pageTitle}>Acceso Choferes</div>
        <div style={{fontSize:13,color:C.textSecondary,marginTop:4}}>Selecciona tu nombre para ver tus entregas del día</div>
      </div>
      <div style={S.fGroup}>
        <label style={S.label}>Seleccionar chofer</label>
        <select style={{...S.input,fontSize:15,padding:"12px"}} value={selChofer} onChange={e=>setSelChofer(e.target.value)}>
          <option value="">-- Selecciona tu nombre --</option>
          {CHOFERES.map(c=><option key={c.nombre} value={c.nombre}>{c.nombre} · {c.ppu}</option>)}
        </select>
      </div>
      <button style={{...S.btnPri,width:"100%",padding:"14px",fontSize:15,opacity:selChofer?1:0.5}}
        disabled={!selChofer} onClick={onAcceder}>Ingresar</button>
    </div>
  );
}

// ── Vista Chofer ───────────────────────────────────────────────────────────
function VistaChofer({chofer,solicitudes,onEstado,onSalir}){
  const hoy = new Date().toISOString().split("T")[0];
  const misSols = solicitudes.filter(s =>
    (s.ppuAsignada === chofer.ppu || s.choferAsignado === chofer.nombre) &&
    s.fecha === hoy &&
    ["en_proceso","pendiente"].includes(s.status)
  );
  const [cargando,setCargando]=useState(null);
  const [fotos,setFotos]=useState({});
  const [errorFoto,setErrorFoto]=useState(null);
  const [firmas,setFirmas]=useState({}); // {solId: {dataUrl, nombre, rechazo}}
  const [modalFirma,setModalFirma]=useState(null); // solId activo
  const [llegadas,setLlegadas]=useState({}); // {solId: {hora, timestamp, geo}}
  const [tiempos,setTiempos]=useState({}); // {solId: segundosTranscurridos}
  const timerRef=useRef({});

  useEffect(()=>{
    return ()=>{ Object.values(timerRef.current).forEach(t=>clearInterval(t)); };
  },[]);

  function registrarLlegada(solId){
    const now=new Date();
    const hora=now.toLocaleDateString("es-CL")+" "+now.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false});
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const geo=pos.coords.latitude.toFixed(6)+","+pos.coords.longitude.toFixed(6);
        setLlegadas(p=>({...p,[solId]:{hora,timestamp:now.getTime(),geo}}));
      },
      ()=>{setLlegadas(p=>({...p,[solId]:{hora,timestamp:now.getTime(),geo:null}}));},
      {timeout:5000}
    );
    // Iniciar cronómetro
    timerRef.current[solId]=setInterval(()=>{
      setTiempos(p=>({...p,[solId]:Math.floor((Date.now()-now.getTime())/1000)}));
    },1000);
  }

  function formatTiempo(seg){
    if(!seg&&seg!==0)return null;
    const h=Math.floor(seg/3600),m=Math.floor((seg%3600)/60),s=seg%60;
    if(h>0)return h+"h "+m+"m "+s+"s";
    if(m>0)return m+"m "+s+"s";
    return s+"s";
  }

  function capturarFoto(solId){
    const input=document.createElement("input");
    input.type="file"; input.accept="image/*"; input.capture="environment";
    input.onchange=e=>{
      const file=e.target.files[0];
      if(!file)return;
      const reader=new FileReader();
      reader.onload=ev=>{
        // Comprimir imagen antes de guardar
        const img=new Image();
        img.onload=()=>{
          const canvas=document.createElement("canvas");
          const MAX=800;
          let w=img.width,h=img.height;
          if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
          if(h>MAX){w=Math.round(w*MAX/h);h=MAX;}
          canvas.width=w; canvas.height=h;
          canvas.getContext("2d").drawImage(img,0,0,w,h);
          const b64=canvas.toDataURL("image/jpeg",0.7);
          setFotos(p=>({...p,[solId]:b64}));
        };
        img.src=ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function cerrar(id, estado){
    // Validar foto obligatoria
    if(!fotos[id]){
      setErrorFoto(id);
      setTimeout(()=>setErrorFoto(null),3000);
      return;
    }
    // Validar firma obligatoria
    if(!firmas[id]){
      setErrorFoto(id+"firma");
      setTimeout(()=>setErrorFoto(null),3000);
      return;
    }
    setErrorFoto(null);
    setCargando(id+estado);
    // Calcular tiempo en punto
    const llegada=llegadas[id];
    const tiempoEnPunto=llegada?Math.floor((Date.now()-llegada.timestamp)/1000):null;
    const tiempoStr=tiempoEnPunto!==null?formatTiempo(tiempoEnPunto):null;
    // Detener cronómetro
    if(timerRef.current[id]){clearInterval(timerRef.current[id]);delete timerRef.current[id];}
    await onEstado(id, estado, fotos[id]||null, llegada?.hora||null, tiempoStr, firmas[id]||null);
    setFotos(p=>{const n={...p};delete n[id];return n;});
    setFirmas(p=>{const n={...p};delete n[id];return n;});
    setLlegadas(p=>{const n={...p};delete n[id];return n;});
    setTiempos(p=>{const n={...p};delete n[id];return n;});
    setCargando(null);
  }

  return(
    <>
    <div style={S.section}>
      <div style={{background:C.navySurface,border:"1px solid "+C.cyan,borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:11,color:C.cyan,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Perfil Chofer</div>
          <div style={{fontSize:18,fontWeight:800,color:C.textPrimary,marginTop:2}}>{chofer.nombre}</div>
          <div style={{fontSize:13,color:C.textSecondary}}>PPU: {chofer.ppu} · {chofer.usuarioDT}</div>
        </div>
        <button style={{...S.btnSec,fontSize:12}} onClick={onSalir}>Salir</button>
      </div>

      <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1.5,textTransform:"uppercase"}}>
        Entregas de hoy — {new Date().toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"long"})}
      </div>

      {misSols.length===0?(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"40px 0",color:C.muted}}>
          <div style={{fontSize:36}}>✓</div>
          <p style={{margin:0,fontWeight:600}}>Sin entregas pendientes para hoy</p>
        </div>
      ):misSols.map(s=>{
        const tm=TYPE_META[s.tipo]||{label:s.tipo,icon:"·",color:"#6B8CAE"};
        return(
          <div key={s.id} style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:12,padding:"16px",display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{...S.rowIcon,background:tm.color+"22",color:tm.color,flexShrink:0}}>{tm.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{s.titulo}</div>
                <div style={{fontSize:12,color:C.textSecondary,marginTop:2}}>{tm.label}</div>
              </div>
            </div>
            {s.direccion&&<div style={{background:C.navy,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.textSecondary}}>
              📍 {s.direccion}
              {s.notas&&<div style={{color:C.muted,fontSize:12,marginTop:4}}>💬 {s.notas}</div>}
            </div>}
            {/* Llegada al punto */}
            {!llegadas[s.id]?(
              <button style={{background:C.cyan+"22",border:"1px solid "+C.cyan,color:C.cyan,borderRadius:10,padding:"10px 14px",fontSize:13,fontWeight:700,cursor:"pointer",width:"100%"}}
                onClick={()=>registrarLlegada(s.id)}>
                📍 Llegué al punto de entrega
              </button>
            ):(
              <div style={{background:C.navy,border:"1px solid "+C.cyan,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:11,color:C.cyan,fontWeight:700}}>EN PUNTO DE ENTREGA</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>Llegada: {llegadas[s.id].hora}</div>
                </div>
                <div style={{fontSize:22,fontWeight:900,color:C.cyan,fontFamily:"monospace"}}>
                  {formatTiempo(tiempos[s.id]||0)}
                </div>
              </div>
            )}
            {/* Captura de foto */}
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button style={{background:fotos[s.id]?C.success+"22":C.danger+"22",border:"1px solid "+(fotos[s.id]?C.success:C.danger),color:fotos[s.id]?C.success:C.danger,borderRadius:10,padding:"10px 14px",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6,width:"100%",justifyContent:"center"}}
                onClick={()=>capturarFoto(s.id)}>
                📷 {fotos[s.id]?"Foto tomada ✓":"Tomar foto (obligatorio)"}
              </button>
              {fotos[s.id]&&<img src={fotos[s.id]} alt="preview" style={{width:48,height:48,borderRadius:8,objectFit:"cover",border:"2px solid "+C.success}}/>}
            </div>
            {errorFoto===s.id&&<div style={{background:C.danger+"22",border:"1px solid "+C.danger,borderRadius:8,padding:"8px 12px",fontSize:13,color:C.danger,fontWeight:600}}>
              📷 Debes tomar una foto del documento antes de registrar la entrega.
            </div>}
            {/* Firma del receptor */}
            <button style={{background:firmas[s.id]?C.success+"22":"#7C3AED22",border:"1px solid "+(firmas[s.id]?C.success:"#7C3AED"),color:firmas[s.id]?C.success:"#A78BFA",borderRadius:10,padding:"10px 14px",fontSize:13,fontWeight:700,cursor:"pointer",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
              onClick={()=>setModalFirma(s.id)}>
              ✍️ {firmas[s.id]?(firmas[s.id].rechazo?"Rechazo registrado ✓":"Firma tomada ✓"):"Firma del receptor (obligatorio)"}
            </button>
            {errorFoto===s.id+"firma"&&<div style={{background:C.danger+"22",border:"1px solid "+C.danger,borderRadius:8,padding:"8px 12px",fontSize:13,color:C.danger,fontWeight:600}}>
              ✍️ Debes registrar la firma o el rechazo del receptor.
            </div>}
            <div style={{display:"flex",gap:10}}>
              <button style={{flex:1,background:C.success+"22",border:"1px solid "+C.success,color:C.success,borderRadius:10,padding:"12px",fontWeight:800,fontSize:14,cursor:"pointer",opacity:cargando?0.6:1}}
                disabled={!!cargando} onClick={()=>cerrar(s.id,"completada")}>
                {cargando===s.id+"completada"?"Registrando...":"✓ Completada"}
              </button>
              <button style={{flex:1,background:"#F9731622",border:"1px solid #F97316",color:"#F97316",borderRadius:10,padding:"12px",fontWeight:800,fontSize:14,cursor:"pointer",opacity:cargando?0.6:1}}
                disabled={!!cargando} onClick={()=>cerrar(s.id,"no_entregado")}>
                {cargando===s.id+"no_entregado"?"Registrando...":"✗ No Entregado"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
    {modalFirma&&<ModalFirma solId={modalFirma}
      onGuardar={f=>{setFirmas(p=>({...p,[modalFirma]:f}));setModalFirma(null);}}
      onCerrar={()=>setModalFirma(null)}/>}
    </>
  );
}


// ── Resumen KM del día ────────────────────────────────────────────────────
function ResumenKmDia({ solicitudes, rutas=[] }) {
  const [kmData, setKmData] = useState(null);
  const [calculando, setCalculando] = useState(false);

  const hoy = new Date().toISOString().split("T")[0];
  const solsHoy = solicitudes.filter(s =>
    s.fecha === hoy && s.direccion && s.status === "completada" && s.tipo !== "carga_ol"
  );

  async function calcularKmRuta() {
    if (solsHoy.length === 0) return;
    setCalculando(true);
    let totalKm = 0;
    const tramos = [];
    // Primero agregar km de rutas completas (sin duplicar solicitudes)
    const rutasHoy = rutas.filter(r => r.fecha === hoy && r.kmTotal);
    const solsEnRuta = new Set();
    for (const r of rutasHoy) {
      r.paradas.forEach(p => solsEnRuta.add(p.solId));
      totalKm += parseFloat(r.kmTotal);
      tramos.push({ titulo: r.id + " · " + r.vehiculo, direccion: "Ruta completa", km: r.kmTotal });
    }
    // Luego agregar solicitudes que NO están en ninguna ruta
    for (const s of solsHoy) {
      if (solsEnRuta.has(s.id)) continue;
      const km = await calcularKmDesdePudahuel(s.direccion);
      if (km !== null) {
        totalKm += parseFloat(km);
        tramos.push({ titulo: s.titulo, direccion: s.direccion, km });
      }
    }
    setKmData({ totalKm: totalKm.toFixed(1), tramos, nSols: solsHoy.length });
    setCalculando(false);
  }

  if (solsHoy.length === 0) return null;

  return (
    <div style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:12,padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:11,fontWeight:700,color:C.cyan,letterSpacing:1.5,textTransform:"uppercase"}}>Kilómetros del día</div>
        {!kmData&&<button style={{...S.exportBtn,fontSize:11}} disabled={calculando} onClick={calcularKmRuta}>
          {calculando?"Calculando...":"🗺 Calcular km"}
        </button>}
      </div>
      {kmData?(
        <>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{background:C.navy,borderRadius:10,padding:"12px 16px",border:"1px solid "+C.cyan+"44",flex:1}}>
              <div style={{fontSize:11,color:C.muted}}>Total recorrido hoy</div>
              <div style={{fontSize:28,fontWeight:900,color:C.cyan}}>{kmData.totalKm} km</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>desde Pudahuel</div>
            </div>
            <div style={{background:C.navy,borderRadius:10,padding:"12px 16px",border:"1px solid "+C.border,flex:1}}>
              <div style={{fontSize:11,color:C.muted}}>Entregas completadas</div>
              <div style={{fontSize:28,fontWeight:900,color:C.success}}>{kmData.nSols}</div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {kmData.tramos.map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:C.textSecondary}}>
                <span style={{color:C.cyan}}>→</span>
                <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.titulo}</span>
                <span style={{color:C.textPrimary,fontWeight:700,flexShrink:0}}>{t.km} km</span>
              </div>
            ))}
          </div>
        </>
      ):(
        <div style={{fontSize:12,color:C.muted}}>{solsHoy.length} entrega(s) completada(s) hoy. Presiona para calcular km desde Pudahuel.</div>
      )}
    </div>
  );
}


// ── Resumen CO2 mensual ────────────────────────────────────────────────────
function ResumenCO2({ solicitudes, rutas=[] }) {
  const [co2Data, setCo2Data] = useState(null);
  const [calculando, setCalculando] = useState(false);

  const solsConDireccion = solicitudes.filter(s =>
    s.status === "completada" && s.direccion && s.tipo !== "carga_ol"
  );

  async function calcularCO2() {
    if (solsConDireccion.length === 0) return;
    setCalculando(true);
    let totalKm = 0;
    const detalles = [];
    for (const s of solsConDireccion) {
      const km = await calcularKmDesdePudahuel(s.direccion);
      if (km !== null) {
        totalKm += km;
        detalles.push({ titulo: s.titulo, direccion: s.direccion, km });
      }
    }
    const totalKg = solsConDireccion.length * PESO_BASE_KG;
    const co2 = (totalKm * totalKg).toFixed(0);
    setCo2Data({ totalKm: totalKm.toFixed(1), totalKg, co2, detalles, nSols: solsConDireccion.length });
    setCalculando(false);
  }

  if (solsConDireccion.length === 0) return null;

  return (
    <div style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:12,padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:11,fontWeight:700,color:C.cyan,letterSpacing:1.5,textTransform:"uppercase"}}>Medición CO₂</div>
        {!co2Data&&<button style={{...S.exportBtn,fontSize:11}} disabled={calculando} onClick={calcularCO2}>
          {calculando?"Calculando...":"🌿 Calcular CO₂"}
        </button>}
      </div>
      {co2Data?(
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:C.navy,borderRadius:10,padding:"12px",border:"1px solid "+C.border}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700,marginBottom:4}}>TOTAL KM</div>
              <div style={{fontSize:20,fontWeight:900,color:C.cyan}}>{co2Data.totalKm} km</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>desde Pudahuel</div>
            </div>
            <div style={{background:C.navy,borderRadius:10,padding:"12px",border:"1px solid "+C.border}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700,marginBottom:4}}>TOTAL KG TRANSPORTADOS</div>
              <div style={{fontSize:20,fontWeight:900,color:C.warning}}>{co2Data.totalKg.toLocaleString("es-CL")} kg</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{co2Data.nSols} entregas × 1.000 kg</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:C.navy,borderRadius:10,padding:"12px",border:"1px solid "+C.cyan+"44"}}>
              <div style={{fontSize:10,color:C.cyan,fontWeight:700,marginBottom:4}}>ÍNDICE TKM (Abbott)</div>
              <div style={{fontSize:20,fontWeight:900,color:C.cyan}}>{parseInt(co2Data.co2).toLocaleString("es-CL")}</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>km × kg transportados</div>
            </div>
            <div style={{background:C.navy,borderRadius:10,padding:"12px",border:"1px solid "+C.success+"44"}}>
              <div style={{fontSize:10,color:C.success,fontWeight:700,marginBottom:4}}>CO₂ ESTIMADO</div>
              <div style={{fontSize:20,fontWeight:900,color:C.success}}>{(parseInt(co2Data.co2)/1000*0.15).toFixed(1)} kg</div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>tkm × 0,15 kg CO₂/tkm</div>
            </div>
          </div>
          <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>
            Índice tkm = Σ km (Pudahuel → destino) × Σ kg (base 1.000 kg/entrega) · CO₂ según estándar GLEC/ISO 14083
          </div>
        </>
      ):(
        <div style={{fontSize:12,color:C.muted}}>{solsConDireccion.length} entregas completadas. Presiona para calcular el CO₂ del período.</div>
      )}
    </div>
  );
}


// ── Resumen rutas del día en Dashboard ───────────────────────────────────
function ResumenRutasDia({ solicitudes }) {
  const [rutas, setRutas] = useState(null);
  const [calculando, setCalculando] = useState(false);

  const hoy = new Date().toISOString().split("T")[0];
  const solsHoy = solicitudes
    .filter(s => s.fecha === hoy && s.direccion && s.status === "completada")
    .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));

  async function calcularRutas() {
    if (solsHoy.length === 0) return;
    setCalculando(true);
    const tramos = [];
    let totalKm = 0;

    for (let i = 0; i < solsHoy.length; i++) {
      const origen = i === 0 ? ORIGEN_PUDAHUEL : solsHoy[i-1].direccion + ", Chile";
      const destino = solsHoy[i].direccion + ", Chile";
      const result = await calcularTramo(origen, destino);
      if (result) {
        totalKm += parseFloat(result.km);
        tramos.push({
          de: i === 0 ? "Pudahuel (origen)" : solsHoy[i-1].titulo,
          a: solsHoy[i].titulo,
          direccionA: solsHoy[i].direccion,
          km: result.km,
          tiempo: result.tiempo,
          mapaUrl: result.mapaUrl,
        });
      }
    }
    setRutas({ tramos, totalKm: totalKm.toFixed(1) });
    setCalculando(false);
  }

  if (solsHoy.length === 0) return null;

  return (
    <div style={{background:C.navySurface,border:"1px solid "+C.border,borderRadius:12,padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:11,fontWeight:700,color:C.cyan,letterSpacing:1.5,textTransform:"uppercase"}}>Rutas del día</div>
        {!rutas&&<button style={{...S.exportBtn,fontSize:11}} disabled={calculando} onClick={calcularRutas}>
          {calculando?"Calculando rutas...":"🗺 Ver rutas del día"}
        </button>}
      </div>

      {rutas?(
        <>
          <div style={{background:C.navy,borderRadius:10,padding:"12px 16px",border:"1px solid "+C.cyan+"44",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:11,color:C.muted}}>Total recorrido hoy</div>
              <div style={{fontSize:24,fontWeight:900,color:C.cyan}}>{rutas.totalKm} km</div>
            </div>
            <div style={{fontSize:11,color:C.muted,textAlign:"right"}}>
              {rutas.tramos.length} tramo(s)<br/>{solsHoy.length} entrega(s)
            </div>
          </div>

          {rutas.tramos.map((t, i) => (
            <div key={i} style={{background:C.navy,borderRadius:10,padding:"12px",border:"1px solid "+C.border,display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                <span style={{color:C.cyan,fontWeight:700}}>Tramo {i+1}</span>
                <span style={{color:C.muted}}>{t.de}</span>
                <span style={{color:C.cyan}}>→</span>
                <span style={{color:C.textPrimary,fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.a}</span>
              </div>
              <div style={{display:"flex",gap:8}}>
                <div style={{background:C.navySurface,borderRadius:8,padding:"6px 10px",fontSize:12,fontWeight:700,color:C.cyan}}>{t.km} km</div>
                <div style={{background:C.navySurface,borderRadius:8,padding:"6px 10px",fontSize:12,fontWeight:700,color:C.warning}}>{t.tiempo}</div>
              </div>
              <img src={t.mapaUrl} alt={"Tramo "+(i+1)} style={{width:"100%",borderRadius:8,border:"1px solid "+C.border}} onError={e=>e.target.style.display="none"}/>
              <a href={`https://www.google.com/maps/dir/${encodeURIComponent(i===0?ORIGEN_PUDAHUEL:rutas.tramos[i-1].direccionA+", Chile")}/${encodeURIComponent(t.direccionA+", Chile")}`}
                target="_blank" rel="noreferrer"
                style={{display:"inline-flex",alignItems:"center",gap:6,color:C.cyan,fontSize:11,fontWeight:700,textDecoration:"none"}}>
                🗺 Abrir en Google Maps
              </a>
            </div>
          ))}
        </>
      ):(
        <div style={{fontSize:12,color:C.muted}}>{solsHoy.length} entrega(s) completada(s) hoy. Presiona para ver las rutas.</div>
      )}
    </div>
  );
}

function EmptyState({msg,action}){
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"40px 0",color:C.muted}}>
      <p style={{margin:0}}>{msg}</p>
      {action&&<button style={S.btnPri} onClick={action}>+ Nueva solicitud</button>}
    </div>
  );
}

const S={
  root:{minHeight:"100vh",background:C.navy,color:C.textPrimary,fontFamily:"'DM Sans','Segoe UI',sans-serif",display:"flex",flexDirection:"column"},
  header:{background:C.navyMid,borderBottom:`1px solid ${C.border}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",minHeight:68,boxShadow:"0 2px 12px #00000040"},
  logoWrap:{display:"flex",alignItems:"center",gap:12},
  logoTitle:{fontWeight:900,fontSize:15,letterSpacing:3,color:"#ffffff",fontStyle:"italic"},
  logoSub:{fontSize:10,color:C.cyan,letterSpacing:2,fontWeight:600},
  nav:{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"},
  navBtn:{background:"transparent",border:"none",color:C.muted,padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600},
  navBtnActive:{background:C.cyan+"22",color:C.cyan},
  exportBtn:{background:"transparent",border:`1px solid ${C.cyan}`,color:C.cyan,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700},
  btnCierre:{background:`linear-gradient(135deg,${C.cyan},${C.blue})`,color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontWeight:800,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"},
  periodoBanner:{background:C.navySurface,border:"1px solid",borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"},
  main:{flex:1,maxWidth:740,width:"100%",margin:"0 auto",padding:"24px 16px"},
  section:{display:"flex",flexDirection:"column",gap:16},
  pageTitle:{fontSize:22,fontWeight:800,color:C.textPrimary,letterSpacing:-.5},
  sectionTitle:{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginTop:8},
  statsGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:12},
  statCard:{background:C.navySurface,borderRadius:12,padding:"16px 14px",border:`1px solid ${C.border}`},
  statNum:{fontSize:32,fontWeight:900,lineHeight:1},
  statLabel:{fontSize:11,color:C.textSecondary,marginTop:4,fontWeight:600},
  row:{background:C.navySurface,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:14},
  rowIcon:{width:40,height:40,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,flexShrink:0},
  rowBody:{flex:1,minWidth:0},
  rowTitle:{fontWeight:700,fontSize:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  rowMeta:{fontSize:12,marginTop:2},
  badge:{padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,flexShrink:0,whiteSpace:"nowrap"},
  filters:{display:"flex",gap:8,flexWrap:"wrap"},
  searchInput:{flex:1,minWidth:160,background:C.navySurface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",color:C.textPrimary,fontSize:13,outline:"none"},
  select:{background:C.navySurface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",color:C.textPrimary,fontSize:13,outline:"none",cursor:"pointer"},
  formGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14},
  fGroup:{display:"flex",flexDirection:"column",gap:6},
  label:{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"},
  input:{background:C.navySurface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 12px",color:C.textPrimary,fontSize:13,outline:"none",fontFamily:"inherit"},
  btnPri:{background:`linear-gradient(135deg,${C.cyan},${C.blue})`,color:"#fff",border:"none",borderRadius:8,padding:"10px 22px",fontWeight:800,fontSize:14,cursor:"pointer"},
  btnSec:{background:"transparent",color:C.muted,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 18px",fontWeight:600,fontSize:14,cursor:"pointer"},
  detailHeader:{display:"flex",alignItems:"flex-start",gap:14,flexWrap:"wrap"},
  detailIcon:{width:52,height:52,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:700,flexShrink:0},
  detailGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12},
  detailField:{background:C.navySurface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px"},
  detailBlock:{background:C.navySurface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px"},
  fieldLabel:{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:4},
  fieldValue:{fontSize:14,color:C.textPrimary},
  statusBtns:{display:"flex",gap:8,flexWrap:"wrap",marginTop:6},
  statusBtn:{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",background:"transparent"},
  deleteBtn:{background:"transparent",border:`1px solid ${C.danger}`,color:C.danger,borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer"},
  backBtn:{background:"transparent",border:"none",color:C.cyan,cursor:"pointer",fontSize:13,fontWeight:700,padding:0},
  linkBtn:{color:C.cyan,background:"transparent",border:"none",cursor:"pointer",fontSize:13,fontWeight:700,padding:"4px 0",alignSelf:"flex-start"},
  toast:{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",padding:"10px 22px",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,zIndex:999,boxShadow:"0 4px 20px #0006",whiteSpace:"nowrap"},
  loadingWrap:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,minHeight:300},
  spinner:{width:36,height:36,border:`3px solid ${C.border}`,borderTop:`3px solid ${C.cyan}`,borderRadius:"50%",animation:"spin 1s linear infinite"},
};

if(typeof document!=="undefined"){
  const s=document.createElement("style");
  s.textContent=`@keyframes spin{to{transform:rotate(360deg)}} @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800;900&display=swap'); *{box-sizing:border-box} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:#0D1F3C} ::-webkit-scrollbar-thumb{background:#1E3A6E;border-radius:3px}`;
  document.head.appendChild(s);
}
