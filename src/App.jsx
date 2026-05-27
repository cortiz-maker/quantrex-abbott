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
  pendiente:  { label:"Pendiente",   color:"#F59E0B" },
  en_proceso: { label:"En Tránsito", color:"#00AEEF" },
  completada: { label:"Completada",  color:"#22C55E" },
  cancelada:  { label:"Cancelada",   color:"#EF4444" },
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
  destino:"", noPresentacion:false, vehiculoNP:"", motivoNP:"", statusLog:[],
};

const CLIENTES_ABBOTT = [{"id":"000-2","nombre":"Dhl Atlantis","direccion":"","notas":"Cita XX:XX hrs Andenes 32-33"},{"id":"17004950-0","nombre":"Warner Payamares","direccion":"Marathon 5187, Macul","notas":"Dpto 41, Torre 7"},{"id":"19.684.207-1","nombre":"Felipe Moya Pineda / Dpto 305 / Torre 1","direccion":"Portezuelo de los azules 6975, Puente Alto","notas":""},{"id":"53.125.850-9","nombre":"Comunidad Hospital Del Profesor","direccion":"Avenida Libertador Bernardo O'Higgins 4860, Estación Central, Santiago","notas":"Bodega Hemodinamia Piso 1"},{"id":"60.910.000-1","nombre":"Hospital Clinico U de Chile","direccion":"Santos Dumontt 999, Independencia","notas":""},{"id":"61.101.030-3","nombre":"Hospital Militar De Santiago","direccion":"Av Alcalde Fdo Castillo v 9100, La Reina","notas":"5to Piso, Pabellon Hemodinamia"},{"id":"61.103.007-K","nombre":"Hosp Gral Dr Raul Yazigi","direccion":"Av Las Condes 8631, Las Condes","notas":"Entregar en Hemodinamia Piso 2"},{"id":"61513003-6","nombre":"Dipreca Fondo Hospital","direccion":"Vital Apoquindo 1200, Las condes","notas":"3er Piso Consignacion"},{"id":"61.602.054-4","nombre":"Hospital Carlos Van Buren","direccion":"El Litre 1012, Valparaiso","notas":""},{"id":"61.602.054-4","nombre":"Hospital Carlos Van Buren","direccion":"San Ignacio 725, Valparaiso","notas":""},{"id":"61.602.138-9","nombre":"Hospital Rancagua","direccion":"Av. Libertador Bernardo O'Higgins 3065, Rancagua, O'Higgins","notas":""},{"id":"61.602.189-3","nombre":"Hosp Guillermo Grant Benavente","direccion":"San Martin 1436, Concepcion","notas":"Entregar a Warner Payamares"},{"id":"61606602-1","nombre":"Hosp Dr Gustavo Fricke","direccion":"Alvarez 1532, Viña Del Mar","notas":""},{"id":"61.606.903-9","nombre":"HOSP BASE CURICO","direccion":"Archipielago Juan Fernandez 1890, Curico","notas":""},{"id":"61.608.002-4","nombre":"Hospital San Jose","direccion":"Calle San Jose 1030, Santiago Independencia","notas":"Bodega Central"},{"id":"61608004-0","nombre":"Hospital Roberto del Rio","direccion":"Profesor Zanartu 1085, Independencia","notas":"Bodega Central"},{"id":"61.608.101-2","nombre":"Hosp Barros Luco Trudeau","direccion":"Gran Avenida 3204, San Miguel","notas":"Entrega en Equipos Medicos"},{"id":"61608204-3","nombre":"Hospital San Juan de Dios","direccion":"Huerfanos 3255, Santiago","notas":"1er Piso Pabellon Hemodinamia"},{"id":"61.608.402-K","nombre":"Inst Nacional Del Torax","direccion":"Jose Manuel Infante 717, Providencia","notas":"Bodega General"},{"id":"61.608.408-9","nombre":"Hospital Calvo Mackenna","direccion":"Antonio Varas 248, Providencia","notas":""},{"id":"61608502-6","nombre":"Hospital Sotero del Rio","direccion":"Avenida Concha y Toro 3459, Puente alto","notas":"3er Piso, Pabellon 16"},{"id":"61.608.602-2","nombre":"Hosp Urgencia  Asist Pubica","direccion":"Portugal 125, Santiago","notas":"Pabellon 3,  Angiografía 3er piso"},{"id":"61.608.604-9","nombre":"Hospital San Borja De Arriaran","direccion":"Santa Rosa 1234, Santiago","notas":""},{"id":"61980320-5","nombre":"Hospital del Carmen","direccion":"Camino A Rinconada 1201 &, El Olimpo, Maipú, Región Metropolitana","notas":""},{"id":"71.494.700-1","nombre":"Fundacion Diabetes Juvenil","direccion":"Calle Valparaiso 507, Viña del mar","notas":"Piso 2"},{"id":"71.614.000-8","nombre":"Clinica Univer Los Andes","direccion":"Av Plaza 2501, Las Condes","notas":"2do Piso Hemodinamia"},{"id":"76.044.959-8","nombre":"Arlab S.A","direccion":"Alferez Real 1380, Providencia","notas":"Entrega en Bodega"},{"id":"76242774-5","nombre":"Clinica BUPA Santiago S.A.","direccion":"Av. Departamental 1455, La Florida, Region Metropolitana","notas":"Piso -1 Consignacion"},{"id":"76.336.093-3","nombre":"Clinica Meds La Dehesa Spa","direccion":"Jose Alcalde Delano 10581","notas":""},{"id":"76.363.205-9","nombre":"Clinica Ensenada Spa","direccion":"Av Fermin Vivaceta 957, Independencia","notas":"Bodega General"},{"id":"76.871.990-K","nombre":"Nueva Clinica Cordillera Ph S.A","direccion":"Alejandro Fleming  7885, Las Condes","notas":""},{"id":"77.067.168-K","nombre":"Frimed Spa","direccion":"CAMINO LO BOZA 107, Pudahuel","notas":"BODEGA A-08"},{"id":"77487960-9","nombre":"Importadora Y Exportadora CAMIR SPA","direccion":"Perez Valenzuela 1098, Providencia","notas":""},{"id":"78.040.520-1","nombre":"Clin Avansalud Providencia S.A","direccion":"Av Salvador 130, Providencia","notas":""},{"id":"78.800.870-8","nombre":"M Kaplan Y Cia Ltda","direccion":"Marchant Pereira 174, Providencia","notas":""},{"id":"81.378.300-2","nombre":"Abbott Laboratories De Chile","direccion":"Los Militares 4777, Las Condes","notas":"Piso 7 o 8"},{"id":"81698900-0","nombre":"Pontificia Universidad Catolica","direccion":"Marcoleta 367, Santiago","notas":""},{"id":"90.753.000-0","nombre":"Clinica Santa Maria Spa","direccion":"AV Santa Maria 410, Providencia","notas":"Entrega: 4 piso torre C - Pabellón Hemodinamia."},{"id":"92.051.000-0","nombre":"Inst De Diagnostico S.A","direccion":"AV SANTA MARIA 1810, PROVIDENCIA","notas":"Entrega 5to piso Hemodinamia"},{"id":"92.999.000-5","nombre":"Imp. y Distrib.Arquimed S.A","direccion":"Arturo Prat 828, Santiago","notas":""},{"id":"93930000-7","nombre":"Clinica Las Condes S.A.","direccion":"Estoril 450, Las condes","notas":"Piso -2 Consignacion"},{"id":"96.530.470-3","nombre":"Clinica Davila y Servs Medicos Spa","direccion":"Recoleta 464, Recoleta","notas":""},{"id":"96662450-7","nombre":"Clínica Isamédica","direccion":"Carretera El Cobre Presidente Eduardo Frei Montalva N°884, Rancagua, Región del Libertador Bernardo O´Higgins","notas":""},{"id":"96.770.100-9","nombre":"Clin Alemana De Santiago","direccion":"Vitacura 5951, Viitacura","notas":"Pabellon Hemodinamia 5to Piso"},{"id":"96774580-4","nombre":"Clinica Redsalud Mayor Temuco","direccion":"Avenida Gabriela Mistral N°01955, Temuco","notas":""},{"id":"96.885.930-7","nombre":"Clinica Bicentenario SpA","direccion":"Av. Alameda Libertador Bernardo O'Higgins 4850, Estacion Central","notas":""},{"id":"96.885.950-1","nombre":"Clin Ciudad Del Mar S A","direccion":"13 Norte 672, Viña Del Mar","notas":"Entrega en Equipos Medicos"},{"id":"96898980-4","nombre":"Clinica Vespucio SPA","direccion":"Serafin Zamora 190, La Florida, Region Metropolitana","notas":""},{"id":"99.519.620-4","nombre":"Soc De Diag Invasivo Cardiologia Spa","direccion":"Gran Avenida 3204, San Miguel","notas":"Pabellon Hemodinamia"},{"id":"99573490-7","nombre":"UC Christus Servicios Clinicos SPA","direccion":"Camino El Alba 12351, Las Condes","notas":""},{"id":"71.494.700-11","nombre":"Fundacion Diabetes Juvenil","direccion":"Lota 2344, Providencia","notas":"Bodega Central"},{"id":"99.573.490-77","nombre":"Uc Christus Servicios Clinicos Spa","direccion":"Marcoleta 367, Santiago","notas":""},{"id":"","nombre":"Cenabast","direccion":"San Eugenio 40, Ñuñoa","notas":"Entregar a Solange Arzola"}];

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
  try { const r = localStorage.getItem("abbott:solicitudes"); return r ? JSON.parse(r) : []; } catch { return []; }
}
async function saveSolicitudes(data) {
  try { localStorage.setItem("abbott:solicitudes", JSON.stringify(data)); } catch {}
}
async function loadCierres() {
  try { const r = localStorage.getItem("abbott:cierres"); return r ? JSON.parse(r) : []; } catch { return []; }
}
async function saveCierres(data) {
  try { localStorage.setItem("abbott:cierres", JSON.stringify(data)); } catch {}
}
async function loadPeriodo() {
  try { const r = localStorage.getItem("abbott:periodo"); return r ? JSON.parse(r) : null; } catch { return null; }
}
async function savePeriodo(data) {
  try { localStorage.setItem("abbott:periodo", JSON.stringify(data)); } catch {}
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
    const antes830=mins!==null&&mins<8*60+30;
    const logTarde=logSuperaLas17(s.statusLog);
    const esOH=antes830||logTarde;
    contD[fecha]=(contD[fecha]||0)+1; const nro=contD[fecha];
    let esSpot=false;
    if(!esOH){contN[fecha]=(contN[fecha]||0)+1; esSpot=contN[fecha]>6;}
    const cSpot=esSpot?PRECIO_SPOT:0, cOH=esOH?PRECIO_OVERNIGHT:0;
    const motivoOH=esOH?[antes830?"Hora antes 08:30":null,logTarde?"Log después 17:00":null].filter(Boolean).join(" / "):"";
    return [i+1,s.fecha||"",s.hora||"",s.titulo||"",s.titulo==="000-2 - Dhl Atlantis"?(s.destino||""):"",
      TYPE_META[s.tipo]?.label||s.tipo, STATUS_META[s.status]?.label||s.status,
      s.prioridad==="urgente"?"Urgente":"Normal", s.solicitante||"", s.canalSolicitud||"",
      s.usuarioDT||"", s.ppuAsignada||"", nro,
      (s.statusLog||[]).map(e=>(e.fechaHora||"").split(" ")[1]||"").join(" | "),
      esSpot?"Sí":"No", cSpot||"", esOH?"Sí":"No", motivoOH, cOH||"", (cSpot+cOH)||"",
      s.noPresentacion?(s.vehiculoNP||""):"", s.noPresentacion?(s.motivoNP||""):"",
      s.noPresentacion?DESCUENTO_DIA:""];
  });

  const totalSpot=rows.filter(r=>r[14]==="Sí").length;
  const totalOH=rows.filter(r=>r[16]==="Sí").length;
  const totalCobro=totalSpot*PRECIO_SPOT+totalOH*PRECIO_OVERNIGHT;
  const totalNP=solicitudes.filter(s=>s.noPresentacion).length;
  const totalDescNP=totalNP*DESCUENTO_DIA;
  const granTotal=totalCobro+COBRO_M1+COBRO_M2-totalDescNP;

  const headers=["N°","Fecha","Hora","Cliente","Destino","Tipo","Estado","Prioridad",
    "Solicitante","Canal","Usuario DT","PPU","N° día","Hora Cierre Completado",
    "SPOT","Costo SPOT","Overnight","Motivo OH","Costo OH","Total Cobros",
    "Veh. NP","Motivo NP","Descuento NP"];

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws1["!cols"]=[{wch:5},{wch:12},{wch:8},{wch:35},{wch:20},{wch:28},{wch:13},{wch:10},
    {wch:18},{wch:14},{wch:13},{wch:10},{wch:8},{wch:18},{wch:7},{wch:13},
    {wch:10},{wch:22},{wch:12},{wch:14},{wch:13},{wch:25},{wch:14}];
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
  r2.push(["Total solicitudes período:",solicitudes.length]);
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
  const [confirmCierre,setConfirmCierre]=useState(false);
  const [periodo,setPeriodo]=useState(null);
  const [abrirPeriodo,setAbrirPeriodo]=useState(false); // Se activa automáticamente post-cierre
  const [nuevaFechaInicio,setNuevaFechaInicio]=useState("");
  const toastRef=useRef();

  useEffect(()=>{Promise.all([loadSolicitudes(),loadCierres(),loadPeriodo()]).then(([s,c,p])=>{setSolicitudes(s);setCierres(c);setPeriodo(p);if(c.length>0&&!p)setAbrirPeriodo(true);setLoading(false);});},[]);

  function showToast(msg,type="success"){
    setToast({msg,type}); clearTimeout(toastRef.current);
    toastRef.current=setTimeout(()=>setToast(null),3500);
  }

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
    // Limpiar período para que aparezca la opción de abrir uno nuevo
    setPeriodo(null); await savePeriodo(null);
    setConfirmCierre(false);
    setAbrirPeriodo(true); // Mostrar panel de apertura
    showToast("✓ Período cerrado. Define el nuevo período.");
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
    const nueva={...form,id:Date.now().toString(),status:"pendiente",
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const upd=[nueva,...solicitudes]; setSolicitudes(upd); await saveSolicitudes(upd);
    setSaving(false); setForm({...EMPTY_FORM,
      fecha:new Date().toISOString().split("T")[0],
      hora:new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit",hour12:false})});
    showToast("Solicitud creada correctamente."); setView("lista");
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
    setSolicitudes(upd); await saveSolicitudes(upd);
    showToast(newStatus==="cancelada"?`Cancelada por ${canceladoPor}.`:"Estado actualizado.");
  }

  async function handleEdit(updatedSol){
    const upd=solicitudes.map(s=>s.id===updatedSol.id?{...updatedSol,updatedAt:new Date().toISOString()}:s);
    setSolicitudes(upd); await saveSolicitudes(upd); showToast("Solicitud actualizada.");
  }

  async function handleEditLog(id,updatedLog){
    const upd=solicitudes.map(s=>s.id===id?{...s,statusLog:updatedLog,updatedAt:new Date().toISOString()}:s);
    setSolicitudes(upd); await saveSolicitudes(upd); showToast("Log actualizado.");
  }

  async function handleDelete(id){
    const upd=solicitudes.filter(s=>s.id!==id); setSolicitudes(upd); await saveSolicitudes(upd);
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
    completada:solicitudesPeriodo.filter(s=>s.status==="completada").length};

  const excelNombre=`Quantrex_Abbott_${new Date().toISOString().split("T")[0]}.xlsx`;

  return (
    <div style={S.root}>
      {toast&&<div style={{...S.toast,background:toast.type==="danger"?C.danger:toast.type==="warning"?C.warning:C.success}}>{toast.msg}</div>}
      <header style={S.header}>
        <div style={S.logoWrap}>
          <div><div style={S.logoTitle}>QUANTREX</div><div style={S.logoSub}>GESTIÓN LOGÍSTICA · Abbott</div></div>
        </div>
        <nav style={S.nav}>
          {[["dashboard","Panel"],["lista","Solicitudes"],["cierres","Cierres"],["nueva","+ Nueva"]].map(([v,l])=>(
            <button key={v} style={{...S.navBtn,...(view===v||(view==="detalle"&&v==="lista")||(view==="cierre_detalle"&&v==="cierres")?S.navBtnActive:{})}}
              onClick={()=>setView(v)}>{l}</button>
          ))}
          {solicitudes.length>0&&<button style={S.exportBtn} onClick={()=>exportToExcel(solicitudes,excelNombre)}>⬇ Excel</button>}
        </nav>
      </header>
      <main style={S.main}>
        {loading?(<div style={S.loadingWrap}><div style={S.spinner}/><p style={{color:C.muted}}>Cargando...</p></div>)
        :view==="dashboard"?(<Dashboard stats={stats} solicitudes={solicitudes} solicitudesPeriodo={solicitudesPeriodo}
            nombrePeriodo={nombrePeriodo} inicio={inicioPeriodo} fin={finPeriodo} yaCerrado={yaCerrado}
            setView={setView} setSelectedId={setSelectedId}
            confirmCierre={confirmCierre} setConfirmCierre={setConfirmCierre} onCerrarMes={handleCerrarMes}
            abrirPeriodo={abrirPeriodo} setAbrirPeriodo={setAbrirPeriodo}
            nuevaFechaInicio={nuevaFechaInicio} setNuevaFechaInicio={setNuevaFechaInicio}
            onAbrirPeriodo={handleAbrirPeriodo}
            onExport={()=>exportToExcel(solicitudes,excelNombre)}/>)
        :view==="nueva"?(<FormNueva form={form} setForm={setForm} onSave={handleSave} saving={saving} error={formError} setView={setView}/>)
        :view==="detalle"&&selected?(<Detalle sol={selected} onStatusChange={handleStatusChange}
            onDelete={handleDelete} onEdit={handleEdit} onEditLog={handleEditLog} setView={setView}/>)
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
    const f=s.fecha||"x",m=hm(s.hora),a830=m!==null&&m<8*60+30,lT=l17(s.statusLog),esOH=a830||lT;
    if(esOH){tOH++;}else{contN[f]=(contN[f]||0)+1;if(contN[f]>6)tSpot++;}
  });
  const tNP=solicitudes.filter(s=>s.noPresentacion).length*Math.round(2840000/30);
  const mFijo=M1+M2,mSpot=tSpot*P_SPOT,mOH=tOH*P_OH;
  const total=mFijo+mSpot+mOH-tNP;
  if(total<=0) return null;

  const segmentos=[
    {label:"OC Mensual",valor:mFijo,color:"#1B3FA0"},
    {label:"SPOT Extra",valor:mSpot,color:"#F59E0B"},
    {label:"Overnight",valor:mOH,color:"#38BDF8"},
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
    const a830=m!==null&&m<8*60+30,lT=l17(s.statusLog),esOH=a830||lT;
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
function Dashboard({stats,solicitudes,solicitudesPeriodo,nombrePeriodo,inicio,fin,yaCerrado,setView,setSelectedId,confirmCierre,setConfirmCierre,onCerrarMes,abrirPeriodo,setAbrirPeriodo,nuevaFechaInicio,setNuevaFechaInicio,onAbrirPeriodo,onExport}){
  const fmt=d=>d.toLocaleDateString("es-CL",{day:"numeric",month:"long"});
  return(
    <div style={S.section}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={S.pageTitle}>Dashboard</div>
        {solicitudes.length>0&&<button style={S.exportBtn} onClick={onExport}>⬇ Excel</button>}
      </div>
      <div style={{...S.periodoBanner,borderColor:yaCerrado?C.muted:C.cyan}}>
        <div style={{flex:1}}>
          <div style={{fontSize:11,fontWeight:700,color:yaCerrado?C.muted:C.cyan,letterSpacing:1.5,textTransform:"uppercase",marginBottom:4}}>{yaCerrado?"✓ Período cerrado":"Período activo"}</div>
          <div style={{fontWeight:800,fontSize:16,color:C.textPrimary}}>{nombrePeriodo}</div>
          <div style={{fontSize:12,color:C.textSecondary,marginTop:2}}>{fmt(inicio)} → {fmt(fin)} · {solicitudesPeriodo.length} solicitudes</div>
        </div>
        {!yaCerrado?(!confirmCierre?
          <button style={S.btnCierre} onClick={()=>setConfirmCierre(true)}>Cerrar Mes</button>:
          <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
            <div style={{fontSize:12,color:C.warning,fontWeight:600}}>¿Exportar y cerrar {nombrePeriodo}?</div>
            <div style={{display:"flex",gap:8}}>
              <button style={{...S.statusBtn,border:`1px solid ${C.muted}`,color:C.muted,fontSize:12}} onClick={()=>setConfirmCierre(false)}>Cancelar</button>
              <button style={{...S.statusBtn,background:C.cyan,color:"#fff",border:"none",fontSize:12}} onClick={onCerrarMes}>Confirmar</button>
            </div>
          </div>):
          <div style={{...S.badge,background:C.success+"22",color:C.success}}>Cerrado</div>
        }
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
      <ResumenMes solicitudes={solicitudesPeriodo}/>
      <GraficoCobros solicitudes={solicitudesPeriodo}/>
      <div style={S.sectionTitle}>Solicitudes recientes</div>
      {solicitudes.length===0?<EmptyState msg="Sin solicitudes aún." action={()=>setView("nueva")}/>
        :solicitudes.slice(0,3).map(s=><SolicitudRow key={s.id} sol={s} onSelect={id=>{setSelectedId(id);setView("detalle");}}/>)}
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
function Lista({solicitudes,filterTipo,setFilterTipo,filterStatus,setFilterStatus,filterQ,setFilterQ,onSelect,onExport,total}){
  return(
    <div style={S.section}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={S.pageTitle}>Solicitudes Abbott</div>
        {total>0&&<button style={S.exportBtn} onClick={onExport}>⬇ Excel</button>}
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
        <div style={S.rowTitle}>{sol.titulo}</div>
        <div style={S.rowMeta}>
          <span style={{color:C.textSecondary}}>{tm.label}</span>
          {sol.guia&&<span style={{color:C.muted}}> · {sol.guia}</span>}
          <span style={{color:C.muted}}> · {sol.fecha}</span>
          {sol.noPresentacion&&<span style={{color:C.danger}}> · NP</span>}
        </div>
      </div>
      <div style={{...S.badge,background:sm.color+"22",color:sm.color}}>{sm.label}</div>
    </div>
  );
}

// ── Detalle ────────────────────────────────────────────────────────────────
function Detalle({sol,onStatusChange,onDelete,onEdit,onEditLog,setView}){
  const tm=TYPE_META[sol.tipo]||{label:sol.tipo,icon:"·",color:"#6B8CAE"};
  const sm=STATUS_META[sol.status]||{label:sol.status,color:"#6B8CAE"};
  const [confirmDel,setConfirmDel]=useState(false);
  const [cancelando,setCancelando]=useState(false);
  const [canceladoPor,setCanceladoPor]=useState("");
  const [editMode,setEditMode]=useState(false);
  const [editForm,setEditForm]=useState({...sol});
  const fe=k=>e=>{
    const upd={...editForm,[k]:e.target.value};
    if(k==="titulo"){const s=CLIENTES_ABBOTT.find(c=>(c.id?c.id+" - "+c.nombre:c.nombre)===e.target.value);if(s){upd.direccion=s.direccion;upd.notas=s.notas;}}
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
            {CLIENTES_ABBOTT.map((c,i)=>{const l=c.id?c.id+" - "+c.nombre:c.nombre;return <option key={i} value={l}>{l}</option>;})}
          </select></div>
        {editForm.titulo==="000-2 - Dhl Atlantis"&&<div style={{...S.fGroup,gridColumn:"1/-1"}}>
          <label style={S.label}>Destino</label>
          <input style={S.input} value={editForm.destino||""} onChange={fe("destino")}/></div>}
        <div style={S.fGroup}><label style={S.label}>Fecha *</label>
          <input style={S.input} type="date" value={editForm.fecha} onChange={fe("fecha")}/></div>
        <div style={S.fGroup}><label style={S.label}>Hora</label>
          <input style={S.input} type="time" value={editForm.hora} onChange={fe("hora")}/></div>
        <div style={{...S.fGroup,gridColumn:"1/-1"}}><label style={S.label}>Dirección</label>
          <input style={S.input} value={editForm.direccion} onChange={fe("direccion")}/></div>
        <div style={S.fGroup}><label style={S.label}>Contacto</label>
          <input style={S.input} value={editForm.contacto} onChange={fe("contacto")}/></div>
        <div style={S.fGroup}><label style={S.label}>N° Guía</label>
          <input style={S.input} value={editForm.guia} onChange={fe("guia")}/></div>
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
        <button style={{...S.exportBtn,fontSize:12}} onClick={()=>setEditMode(true)}>✎ Editar</button>
      </div>
      <div style={S.detailGrid}>
        {[["Dirección",sol.direccion],["Contacto",sol.contacto],["N° Guía",sol.guia],
          ["Prioridad",sol.prioridad==="urgente"?"🔴 Urgente":"🟡 Normal"],
          ["Solicitante",sol.solicitante],["Canal",sol.canalSolicitud],
          ["Usuario DT",sol.usuarioDT],["PPU Asignada",sol.ppuAsignada]
        ].filter(([,v])=>v).map(([l,v])=>(
          <div key={l} style={S.detailField}><div style={S.fieldLabel}>{l}</div><div style={S.fieldValue}>{v}</div></div>
        ))}
      </div>
      {sol.titulo==="000-2 - Dhl Atlantis"&&sol.destino&&<div style={S.detailBlock}><div style={S.fieldLabel}>Destino</div><div style={S.fieldValue}>{sol.destino}</div></div>}
      {sol.noPresentacion&&<div style={{...S.detailBlock,border:`1px solid ${C.danger}44`}}>
        <div style={{...S.fieldLabel,color:C.danger}}>No presentación · {sol.vehiculoNP}</div>
        <div style={S.fieldValue}>{sol.motivoNP} <span style={{color:C.danger,fontWeight:700}}>· Descuento: ${Math.round(2840000/30).toLocaleString("es-CL")}</span></div>
      </div>}
      {sol.descripcion&&<div style={S.detailBlock}><div style={S.fieldLabel}>Descripción</div><div style={S.fieldValue}>{sol.descripcion}</div></div>}
      {sol.notas&&<div style={S.detailBlock}><div style={S.fieldLabel}>Notas internas</div><div style={S.fieldValue}>{sol.notas}</div></div>}
      {sol.canceladoPor&&<div style={{...S.detailBlock,border:`1px solid ${C.danger}44`}}><div style={{...S.fieldLabel,color:C.danger}}>Cancelada por</div><div style={S.fieldValue}>{sol.canceladoPor}</div></div>}
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
      <LogEstados log={sol.statusLog||[]} solId={sol.id} onEditLog={onEditLog}/>
      <div style={{marginTop:16}}>
        {!confirmDel
          ?<button style={S.deleteBtn} onClick={()=>setConfirmDel(true)}>Eliminar solicitud</button>
          :<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{color:C.danger,fontSize:13}}>¿Confirmar eliminación?</span>
            <button style={{...S.statusBtn,border:`1px solid ${C.danger}`,color:C.danger}} onClick={()=>onDelete(sol.id)}>Sí, eliminar</button>
            <button style={{...S.statusBtn,border:`1px solid ${C.muted}`,color:C.muted}} onClick={()=>setConfirmDel(false)}>Cancelar</button>
          </div>
        }
      </div>
    </div>
  );
}

// ── LogEstados ─────────────────────────────────────────────────────────────
function LogEstados({log,solId,onEditLog}){
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
        <button style={{...S.exportBtn,fontSize:11,padding:"4px 10px"}} onClick={()=>{setEditMode(!editMode);setEditLog(log);}}>
          {editMode?"Cancelar":"✎ Editar log"}
        </button>
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
function FormNueva({form,setForm,onSave,saving,error,setView}){
  const f=k=>e=>setForm(p=>{
    const u={...p,[k]:e.target.value};
    if(k==="tipo")u.prioridad=PRIORIDAD_DEFAULT[e.target.value]||"normal";
    if(k==="titulo"){const s=CLIENTES_ABBOTT.find(c=>(c.id?c.id+" - "+c.nombre:c.nombre)===e.target.value);if(s){u.direccion=s.direccion;u.notas=s.notas;u.destino="";}}
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
            {CLIENTES_ABBOTT.map((c,i)=>{const l=c.id?c.id+" - "+c.nombre:c.nombre;return <option key={i} value={l}>{l}</option>;})}
          </select></div>
        {form.titulo==="000-2 - Dhl Atlantis"&&<div style={{...S.fGroup,gridColumn:"1/-1"}}>
          <label style={S.label}>Destino</label>
          <input style={S.input} placeholder="Ingresa el destino del despacho..." value={form.destino} onChange={f("destino")}/></div>}
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
        <div style={S.fGroup}><label style={S.label}>N° Guía / Documento</label>
          <input style={S.input} placeholder="Ej: GD-20260526-001" value={form.guia} onChange={f("guia")}/></div>
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
