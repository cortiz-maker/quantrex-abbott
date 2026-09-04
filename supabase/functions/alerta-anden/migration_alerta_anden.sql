-- Migración: alerta "Carga No Preparada en Andén"
-- Correr UNA VEZ en el SQL Editor de Supabase (proyecto principal, el mismo
-- de SUPABASE_URL en App.jsx) antes de desplegar la Edge Function.

-- 1) Evita reenviar el mismo aviso una y otra vez mientras la solicitud
--    sigue "en_punto_cliente" (la Edge Function corre cada pocos minutos).
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS alerta_anden_enviada boolean DEFAULT false;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS alerta_anden_enviada_en timestamptz;

-- 2) Si aún no se corrió la migración de la fase anterior (cronómetro "En
--    Punto Cliente"), esta columna es indispensable para calcular los
--    minutos transcurridos server-side:
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS llegada_ts timestamptz;

-- 3) Importante: cuando una solicitud "en_punto_cliente" avanza a otro
--    estado (se cierra, o el chofer se retira sin cerrar), hay que resetear
--    la marca de aviso para que, si la MISMA guía vuelve a quedar
--    "en_punto_cliente" en una gestión futura, pueda alertar de nuevo. Esto
--    ya lo maneja handleChoferLlegada() en App.jsx (ver alerta_anden_enviada
--    reseteada a false cada vez que se registra una llegada nueva) -- no
--    requiere trigger de base de datos adicional.

-- 4) Habilitar la extensión pg_net (para que Postgres pueda llamar HTTP
--    a la Edge Function vía cron) y pg_cron (para programar la corrida
--    periódica). En Supabase: Database -> Extensions -> buscar "pg_net" y
--    "pg_cron" y activarlas. Luego programar la corrida cada 5 minutos:
--
--    select cron.schedule(
--      'alerta-anden-cada-5-min',
--      '*/5 * * * *',
--      $$
--      select net.http_post(
--        url := 'https://<TU-PROYECTO>.supabase.co/functions/v1/alerta-anden',
--        headers := jsonb_build_object(
--          'Content-Type','application/json',
--          'Authorization','Bearer <TU_SERVICE_ROLE_KEY_O_ANON_KEY_SEGUN_CONFIGURES_LA_FUNCION>'
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
-- Para desactivarlo más adelante: select cron.unschedule('alerta-anden-cada-5-min');
