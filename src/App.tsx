import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MovementType = "ENTRADA" | "SALIDA" | "REGRESO";
type SyncStatus = "PENDIENTE_SINCRONIZAR" | "SINCRONIZADO" | "ERROR_SINCRONIZACION";

type Employee = {
  id_empleado: string;
  nombre: string;
  area: string;
  puesto: string;
  hora_entrada_programada: string;
  hora_salida_programada: string;
  minutos_tolerancia: number;
  qr_token: string;
  activo: boolean;
};

type Movement = {
  id_evento_cliente: string;
  id_empleado: string;
  fecha: string;
  fecha_hora_captura: string;
  fecha_hora_sincronizacion: string | null;
  tipo_movimiento: MovementType;
  qr_token_leido: string;
  dispositivo: string;
  timezone: "America/Monterrey";
  estado_sincronizacion: SyncStatus;
  creado_en: string;
};

const EMP_KEY = "itesa_employees";
const MOV_KEY = "itesa_movements";
const TZ = "America/Monterrey";

const seedEmployees: Employee[] = [
  {
    id_empleado: "EMP001",
    nombre: "JUAN PÉREZ",
    area: "OFICINA",
    puesto: "PRUEBA",
    hora_entrada_programada: "08:00",
    hora_salida_programada: "17:00",
    minutos_tolerancia: 5,
    qr_token: "8d26f45c-97d8-42ac-a4b8-45e7c936ac02",
    activo: true,
  },
  {
    id_empleado: "EMP002",
    nombre: "LORENA MARTÍNEZ",
    area: "OFICINA",
    puesto: "PRUEBA",
    hora_entrada_programada: "08:00",
    hora_salida_programada: "17:00",
    minutos_tolerancia: 5,
    qr_token: "c9e4f1a2-3b5d-4e6f-8a7b-9c0d1e2f3a4b",
    activo: true,
  },
  {
    id_empleado: "EMP003",
    nombre: "ERIKA GARCÍA",
    area: "OFICINA",
    puesto: "PRUEBA",
    hora_entrada_programada: "09:00",
    hora_salida_programada: "18:00",
    minutos_tolerancia: 10,
    qr_token: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
    activo: true,
  },
];

function getLocalDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatLocalTime(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function localMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const map = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function loadEmployees(): Employee[] {
  try {
    const raw = localStorage.getItem(EMP_KEY);
    if (raw) return JSON.parse(raw);
    localStorage.setItem(EMP_KEY, JSON.stringify(seedEmployees));
    return seedEmployees;
  } catch {
    return seedEmployees;
  }
}

function loadMovements(): Movement[] {
  try {
    const raw = localStorage.getItem(MOV_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistMovements(items: Movement[]) {
  localStorage.setItem(MOV_KEY, JSON.stringify(items));
}

function KioskScreen({ onAdmin }: { onAdmin: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLockRef = useRef(false);
  const lastVisibleTokenRef = useRef<string | null>(null);
  const lastVisibleAtRef = useRef(0);

  const [online, setOnline] = useState(navigator.onLine);
  const [employees] = useState<Employee[]>(() => loadEmployees());
  const [movements, setMovements] = useState<Movement[]>(() => loadMovements());
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<{name: string; message: string} | null>(null);
  const [feedback, setFeedback] = useState<{type: "success" | "error" | "duplicate"; message: string} | null>(null);

  const barcodeAvailable = typeof (window as any).BarcodeDetector !== "undefined";
  const pendingCount = movements.filter(m => m.estado_sincronizacion === "PENDIENTE_SINCRONIZAR").length;

  const saveMovement = useCallback((movement: Movement) => {
    setMovements(prev => {
      const next = [...prev, movement];
      persistMovements(next);
      return next;
    });
  }, []);

  const determineMovementType = useCallback((employeeId: string): MovementType => {
    const today = getLocalDate();
    const list = movements
      .filter(m => m.id_empleado === employeeId && m.fecha === today)
      .sort((a, b) => new Date(a.fecha_hora_captura).getTime() - new Date(b.fecha_hora_captura).getTime());
    if (!list.length) return "ENTRADA";
    const last = list[list.length - 1].tipo_movimiento;
    return last === "SALIDA" ? "REGRESO" : "SALIDA";
  }, [movements]);

  const handleScan = useCallback((token: string) => {
    if (scanLockRef.current) return;
    const employee = employees.find(e => e.qr_token === token && e.activo);
    if (!employee) {
      scanLockRef.current = true;
      setFeedback({ type: "error", message: "QR NO VÁLIDO\nCONTACTA A ADMINISTRACIÓN" });
      window.setTimeout(() => { setFeedback(null); scanLockRef.current = false; }, 1800);
      return;
    }

    const now = Date.now();
    const recent = movements
      .filter(m => m.id_empleado === employee.id_empleado)
      .sort((a, b) => new Date(b.fecha_hora_captura).getTime() - new Date(a.fecha_hora_captura).getTime())[0];
    if (recent && now - new Date(recent.fecha_hora_captura).getTime() < 60_000) {
      scanLockRef.current = true;
      setFeedback({ type: "duplicate", message: `REGISTRO YA REALIZADO\n${formatLocalTime(recent.fecha_hora_captura)}` });
      window.setTimeout(() => { setFeedback(null); scanLockRef.current = false; }, 1800);
      return;
    }

    const tipo = determineMovementType(employee.id_empleado);
    const captured = new Date();
    const movement: Movement = {
      id_evento_cliente: crypto.randomUUID(),
      id_empleado: employee.id_empleado,
      fecha: getLocalDate(captured),
      fecha_hora_captura: captured.toISOString(),
      fecha_hora_sincronizacion: null,
      tipo_movimiento: tipo,
      qr_token_leido: token,
      dispositivo: "Kiosco-Android",
      timezone: TZ,
      estado_sincronizacion: "PENDIENTE_SINCRONIZAR",
      creado_en: captured.toISOString(),
    };
    scanLockRef.current = true;
    saveMovement(movement);
    setFeedback({ type: "success", message: `${employee.nombre}\n${tipo}\n${formatLocalTime(movement.fecha_hora_captura)}\n✓ REGISTRO GUARDADO` });
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.15;
      osc.start(); osc.stop(ctx.currentTime + 0.18);
    } catch { /* optional sound */ }
    window.setTimeout(() => { setFeedback(null); scanLockRef.current = false; }, 1800);
  }, [determineMovementType, employees, movements, saveMovement]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (!window.isSecureContext) throw new DOMException("La página no está en un contexto seguro", "SecurityError");
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("getUserMedia no disponible", "NotSupportedError");
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (error) {
      const e = error as Error;
      setCameraActive(false);
      setCameraError({ name: e.name || "Error", message: e.message || "No se pudo abrir la cámara" });
    }
  }, []);

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    if (cameraActive && barcodeAvailable) {
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({ formats: ["qr_code"] });
      timer = window.setInterval(async () => {
        if (!videoRef.current || scanLockRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const now = Date.now();
          if (!codes.length) {
            if (now - lastVisibleAtRef.current > 1200) lastVisibleTokenRef.current = null;
            return;
          }
          const token = String(codes[0].rawValue || "");
          lastVisibleAtRef.current = now;
          if (!token) return;
          if (lastVisibleTokenRef.current === token) return;
          lastVisibleTokenRef.current = token;
          handleScan(token);
        } catch { /* detection frame error: ignore */ }
      }, 350);
    }
    return () => { if (timer) window.clearInterval(timer); };
  }, [barcodeAvailable, cameraActive, handleScan]);

  useEffect(() => {
    let released = false;
    let wakeLock: any;
    (async () => {
      try { wakeLock = await (navigator as any).wakeLock?.request("screen"); } catch { /* optional */ }
    })();
    return () => {
      released = true;
      if (!released && wakeLock) wakeLock.release?.();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="bg-slate-800 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-bold text-lg leading-tight">CONTROL DE ASISTENCIA ITESA</h1>
          <p className="text-xs text-slate-400">OFICINA · PRUEBA DE KIOSCO</p>
        </div>
        <span className={`shrink-0 px-3 py-2 rounded-full text-xs font-bold ${online ? "bg-emerald-500" : "bg-orange-500"}`}>
          {online ? "● EN LÍNEA" : `● SIN INTERNET · ${pendingCount}`}
        </span>
      </header>

      <main className="relative flex-1 min-h-[540px] bg-slate-900 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />

        {!cameraActive && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <button onClick={startCamera} className="rounded-2xl bg-emerald-500 px-7 py-5 text-xl font-bold shadow-xl active:scale-95">
              📷 ACTIVAR CÁMARA
            </button>
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-8 text-center">
            <div className="text-red-400 text-2xl font-bold mb-5">ERROR DE CÁMARA</div>
            <div className="text-lg mb-2">{cameraError.name}</div>
            <div className="text-slate-400 text-sm mb-6">{cameraError.message}</div>
            <button onClick={startCamera} className="rounded-xl bg-emerald-500 px-6 py-4 text-lg font-bold">Reintentar</button>
          </div>
        )}

        {cameraActive && (
          <>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-4 border-white/80 rounded-2xl shadow-2xl" />
            </div>
            <div className="absolute left-4 right-4 bottom-7 rounded-xl bg-black/65 py-3 text-center font-semibold">
              {barcodeAvailable ? "Coloca tu QR dentro del marco" : "Cámara activa · lector QR no disponible en este navegador"}
            </div>
          </>
        )}

        {feedback && (
          <div className={`absolute inset-0 z-20 flex items-center justify-center p-8 text-center ${feedback.type === "success" ? "bg-emerald-500" : feedback.type === "duplicate" ? "bg-amber-500" : "bg-red-500"}`}>
            <div className="whitespace-pre-line text-3xl font-bold leading-relaxed">{feedback.message}</div>
          </div>
        )}
      </main>

      <footer className="bg-slate-800 p-3 text-xs text-slate-300">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>Secure Context: <b className={window.isSecureContext ? "text-emerald-400" : "text-red-400"}>{window.isSecureContext ? "SÍ" : "NO"}</b></span>
          <span>getUserMedia: <b className={navigator.mediaDevices?.getUserMedia ? "text-emerald-400" : "text-red-400"}>{navigator.mediaDevices?.getUserMedia ? "DISPONIBLE" : "NO"}</b></span>
          <span>BarcodeDetector: <b className={barcodeAvailable ? "text-emerald-400" : "text-amber-400"}>{barcodeAvailable ? "DISPONIBLE" : "NO"}</b></span>
        </div>
        <button onClick={onAdmin} className="mt-2 text-slate-500 underline">Panel de prueba</button>
      </footer>
    </div>
  );
}

function AdminPanel({ onKiosk }: { onKiosk: () => void }) {
  const [employees] = useState<Employee[]>(() => loadEmployees());
  const [movements, setMovements] = useState<Movement[]>(() => loadMovements());
  const today = getLocalDate();
  const todayMovements = useMemo(() => movements.filter(m => m.fecha === today), [movements, today]);

  const rows = employees.filter(e => e.activo).map(e => {
    const ms = todayMovements.filter(m => m.id_empleado === e.id_empleado).sort((a,b) => new Date(a.fecha_hora_captura).getTime() - new Date(b.fecha_hora_captura).getTime());
    const entry = ms.find(m => m.tipo_movimiento === "ENTRADA");
    const last = ms[ms.length - 1];
    const late = entry ? Math.max(0, localMinutes(entry.fecha_hora_captura) - hhmmToMinutes(e.hora_entrada_programada) - e.minutos_tolerancia) : 0;
    const status = !last ? "SIN REGISTRO" : last.tipo_movimiento === "SALIDA" ? "FUERA" : late > 0 ? "RETARDO" : "EN OFICINA";
    return { e, ms, entry, last, late, status };
  });

  const clearTest = () => {
    if (!confirm("¿Borrar todos los movimientos de prueba de este teléfono?")) return;
    localStorage.setItem(MOV_KEY, "[]");
    setMovements([]);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-start gap-4 mb-6">
          <div><h1 className="text-2xl font-bold">CONTROL DE ASISTENCIA ITESA</h1><p className="text-slate-500">Panel local de prueba · {today}</p></div>
          <button onClick={onKiosk} className="bg-slate-800 text-white rounded-lg px-4 py-2">Volver al kiosco</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card label="Activos" value={rows.length} />
          <Card label="Dentro" value={rows.filter(r => r.last && r.last.tipo_movimiento !== "SALIDA").length} />
          <Card label="Sin entrada" value={rows.filter(r => !r.entry).length} />
          <Card label="Retardos" value={rows.filter(r => r.late > 0).length} />
        </div>
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50"><tr>{["EMPLEADO","ENTRADA","ÚLTIMO MOV.","ESTADO","SINCRONIZACIÓN"].map(h => <th key={h} className="text-left p-3">{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => <tr key={r.e.id_empleado} className="border-t">
              <td className="p-3"><b>{r.e.nombre}</b><div className="text-slate-500">{r.e.puesto}</div></td>
              <td className="p-3">{r.entry ? formatLocalTime(r.entry.fecha_hora_captura) : "—"}</td>
              <td className="p-3">{r.last ? `${r.last.tipo_movimiento} ${formatLocalTime(r.last.fecha_hora_captura)}` : "—"}</td>
              <td className="p-3">{r.status}{r.late > 0 ? ` (${r.late} min)` : ""}</td>
              <td className="p-3 text-orange-600">{r.last?.estado_sincronizacion || "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mt-5 flex gap-3">
          <button onClick={() => setMovements(loadMovements())} className="bg-indigo-600 text-white rounded-lg px-4 py-2">Actualizar</button>
          <button onClick={clearTest} className="bg-red-100 text-red-700 rounded-lg px-4 py-2">Borrar movimientos de prueba</button>
        </div>
        <div className="mt-6 bg-amber-50 border border-amber-200 p-4 rounded-xl text-sm">
          <b>Versión de prueba:</b> todavía no hay backend. Los registros se guardan localmente y permanecen como PENDIENTE_SINCRONIZAR.
        </div>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return <div className="bg-white rounded-xl shadow p-4"><div className="text-3xl font-bold text-indigo-700">{value}</div><div className="text-slate-500 text-sm">{label}</div></div>;
}

export default function App() {
  const [view, setView] = useState<"kiosk" | "admin">(() => location.hash === "#admin" ? "admin" : "kiosk");
  return view === "kiosk" ? <KioskScreen onAdmin={() => { location.hash = "admin"; setView("admin"); }} /> : <AdminPanel onKiosk={() => { location.hash = ""; setView("kiosk"); }} />;
}
