# ITESA Asistencia Oficina — prueba de cámara/QR

Esta versión se preparó para probar fuera del sandbox de LlamaCoder.

## Qué debe probarse primero
1. Publicar en un dominio HTTPS real (por ejemplo Vercel).
2. Abrir la URL en Chrome Android.
3. Tocar **ACTIVAR CÁMARA** y conceder permiso.
4. Mostrar el QR de prueba de JUAN PÉREZ cuyo contenido exacto es:
   `8d26f45c-97d8-42ac-a4b8-45e7c936ac02`
5. Debe registrar ENTRADA.
6. Un segundo escaneo dentro de 60 segundos no debe crear otro movimiento.

## Importante
- No existe backend en esta versión.
- Los registros se guardan localmente en el dispositivo.
- Permanecen como `PENDIENTE_SINCRONIZAR`.
- Esta versión es únicamente para comprobar cámara, QR y secuencia de movimientos antes de cargar empleados reales.

## Despliegue en Vercel
1. Subir esta carpeta completa a un repositorio de GitHub.
2. En Vercel elegir **Add New > Project**.
3. Importar el repositorio.
4. Framework preset: **Vite** (Vercel normalmente lo detecta solo).
5. Build command: `npm run build`.
6. Output directory: `dist`.
7. Deploy.
