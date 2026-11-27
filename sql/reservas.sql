-- =============================================================
-- LA MAR | Migración 01: sistema de reservas
-- Ejecutar una sola vez, completa, en SQL Editor de Supabase.
-- Requiere public.profiles, public.es_admin() y Supabase Auth.
-- No modifica ni elimina las tablas, funciones o datos anteriores.
-- Horario local: America/Lima. Uso académico: DNI ficticios.
-- =============================================================

BEGIN;

-- 1. TABLAS Y RESTRICCIONES ------------------------------------

CREATE TABLE public.configuracion_restaurante (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mesas_habilitadas integer NOT NULL DEFAULT 20
        CHECK (mesas_habilitadas BETWEEN 0 AND 20),
    sillas_por_mesa integer NOT NULL DEFAULT 5 CHECK (sillas_por_mesa = 5),
    -- Fechas de feriados configuradas por el responsable del proyecto.
    feriados date[] NOT NULL DEFAULT ARRAY[]::date[]
);

INSERT INTO public.configuracion_restaurante (id) VALUES (1);

CREATE TABLE public.reservas (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fecha_reserva date NOT NULL CHECK (isfinite(fecha_reserva)),
    hora_reserva time NOT NULL CHECK (
        EXTRACT(MINUTE FROM hora_reserva) IN (0, 30)
        AND EXTRACT(SECOND FROM hora_reserva) = 0
        AND hora_reserva < TIME '24:00'
    ),
    cantidad_personas integer NOT NULL CHECK (cantidad_personas BETWEEN 1 AND 100),
    cantidad_mesas integer GENERATED ALWAYS AS ((cantidad_personas + 4) / 5) STORED,
    estado text NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'asistio', 'vencida')),
    creado timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.asistentes_reserva (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reserva_id bigint NOT NULL REFERENCES public.reservas(id) ON DELETE CASCADE,
    dni varchar(8) NOT NULL CHECK (dni ~ '^[0-9]{8}$'),
    UNIQUE (reserva_id, dni)
);

CREATE INDEX reservas_fecha_hora_idx ON public.reservas (fecha_reserva, hora_reserva);
CREATE INDEX reservas_usuario_idx ON public.reservas (usuario_id);

-- 2. SEGURIDAD RLS Y PERMISOS ----------------------------------
-- Lectura: clientes solo de sus reservas; administradores de todas.
-- Escritura: exclusivamente mediante las funciones validadas de abajo.

ALTER TABLE public.configuracion_restaurante ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistentes_reserva ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.configuracion_restaurante, public.reservas,
    public.asistentes_reserva FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.configuracion_restaurante, public.reservas,
    public.asistentes_reserva TO authenticated;

CREATE POLICY "consultar configuracion" ON public.configuracion_restaurante
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "consultar reservas propias o admin" ON public.reservas
    FOR SELECT TO authenticated
    USING (usuario_id = auth.uid() OR public.es_admin());

CREATE POLICY "consultar asistentes propios o admin" ON public.asistentes_reserva
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.reservas AS r
        WHERE r.id = reserva_id
          AND (r.usuario_id = auth.uid() OR public.es_admin())
    ));

-- 3. FUNCIONES INTERNAS ----------------------------------------
-- No se exponen al cliente. Todas las referencias a tablas son explícitas.

CREATE FUNCTION public.validar_horario_reserva(p_fecha date, p_hora time)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_apertura time;
    v_cierre time;
    v_dia integer;
    v_feriado boolean;
BEGIN
    IF p_fecha IS NULL OR p_hora IS NULL OR NOT isfinite(p_fecha) THEN
        RAISE EXCEPTION 'Selecciona una fecha y hora validas.';
    END IF;
    IF p_fecha + p_hora <= (clock_timestamp() AT TIME ZONE 'America/Lima') THEN
        RAISE EXCEPTION 'La reserva debe ser en una fecha y hora futura.';
    END IF;
    IF EXTRACT(MINUTE FROM p_hora) NOT IN (0, 30)
       OR EXTRACT(SECOND FROM p_hora) <> 0 OR p_hora >= TIME '24:00' THEN
        RAISE EXCEPTION 'Selecciona un horario en intervalos de 30 minutos.';
    END IF;

    v_dia := EXTRACT(ISODOW FROM p_fecha);
    SELECT p_fecha = ANY(c.feriados) INTO v_feriado
    FROM public.configuracion_restaurante AS c WHERE c.id = 1;

    IF v_dia IN (6, 7) OR v_feriado IS TRUE THEN
        v_apertura := TIME '11:30'; v_cierre := TIME '17:30';
    ELSIF v_dia = 5 THEN
        v_apertura := TIME '12:00'; v_cierre := TIME '19:00';
    ELSE
        v_apertura := TIME '12:00'; v_cierre := TIME '17:00';
    END IF;

    -- Las dos horas completas deben caber dentro del horario de atención.
    IF p_hora < v_apertura OR p_fecha + p_hora + INTERVAL '2 hours' > p_fecha + v_cierre THEN
        RAISE EXCEPTION 'Horario fuera de atencion o insuficiente para una reserva de 2 horas.';
    END IF;
END;
$$;

CREATE FUNCTION public.mesas_libres_intervalo(p_fecha date, p_hora time)
RETURNS integer
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = ''
AS $$
    -- Cada reserva dura cuatro bloques de 30 minutos.
    -- Se usa la mayor ocupación de esos bloques, no la suma de todas
    -- las reservas que coincidan parcialmente con el intervalo.
    SELECT GREATEST(0, c.mesas_habilitadas - COALESCE((
        SELECT MAX(ocupacion)::integer
        FROM (
            SELECT COALESCE(SUM(r.cantidad_mesas), 0) AS ocupacion
            FROM generate_series(0, 3) AS b(n)
            LEFT JOIN public.reservas AS r
              ON r.fecha_reserva = p_fecha
             AND r.estado IN ('pendiente', 'asistio')
             AND r.fecha_reserva + r.hora_reserva <= p_fecha + p_hora + b.n * INTERVAL '30 minutes'
             AND r.fecha_reserva + r.hora_reserva + INTERVAL '2 hours' > p_fecha + p_hora + b.n * INTERVAL '30 minutes'
            GROUP BY b.n
        ) AS bloques
    ), 0))
    FROM public.configuracion_restaurante AS c WHERE c.id = 1;
$$;

-- 4. FUNCIONES PARA CLIENTES -----------------------------------
-- En JS: db.rpc('calcular_disponibilidad', {p_fecha, p_hora})

CREATE FUNCTION public.calcular_disponibilidad(p_fecha date, p_hora time)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesion.';
    END IF;
    PERFORM public.validar_horario_reserva(p_fecha, p_hora);
    RETURN public.mesas_libres_intervalo(p_fecha, p_hora);
END;
$$;

-- En JS: db.rpc('crear_reserva', {p_fecha, p_hora, p_personas, p_dnis})
-- p_dnis: arreglo de cadenas de texto. Ejemplo: ['00000001','00000002'].
-- Devuelve el ID de la reserva creada.

CREATE FUNCTION public.crear_reserva(
    p_fecha date, p_hora time, p_personas integer, p_dnis text[]
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_usuario uuid := auth.uid();
    v_mesas integer;
    v_reserva bigint;
BEGIN
    IF v_usuario IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = v_usuario AND rol = 'cliente'
    ) THEN
        RAISE EXCEPTION 'Debes iniciar sesion como cliente.';
    END IF;
    IF p_personas IS NULL OR p_personas NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'La cantidad de personas debe estar entre 1 y 100.';
    END IF;
    IF p_dnis IS NULL OR array_ndims(p_dnis) IS DISTINCT FROM 1
        OR cardinality(p_dnis) <> p_personas THEN
        RAISE EXCEPTION 'Ingresa un DNI por cada asistente.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_dnis) AS d(dni)
        WHERE d.dni IS NULL OR d.dni !~ '^[0-9]{8}$') THEN
        RAISE EXCEPTION 'Cada DNI debe contener exactamente 8 digitos.';
    END IF;
    IF (SELECT COUNT(DISTINCT d.dni) FROM unnest(p_dnis) AS d(dni)) <> p_personas THEN
        RAISE EXCEPTION 'No se permiten DNI repetidos dentro de una reserva.';
    END IF;

    -- Bloqueo compartido con actualizar_mesas: serializa las escrituras
    -- de capacidad/reservas (aislamiento predeterminado READ COMMITTED).
    -- La consulta de disponibilidad ocurre DESPUÉS de obtener el bloqueo.
    PERFORM 1 FROM public.configuracion_restaurante WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Falta configurar el restaurante.'; END IF;
    PERFORM public.validar_horario_reserva(p_fecha, p_hora);
    v_mesas := (p_personas + 4) / 5;
    IF v_mesas > public.mesas_libres_intervalo(p_fecha, p_hora) THEN
        RAISE EXCEPTION 'El limite de disponibilidad ha sido superado.';
    END IF;

    INSERT INTO public.reservas (usuario_id, fecha_reserva, hora_reserva, cantidad_personas)
    VALUES (v_usuario, p_fecha, p_hora, p_personas)
    RETURNING id INTO v_reserva;

    INSERT INTO public.asistentes_reserva (reserva_id, dni)
    SELECT v_reserva, d.dni FROM unnest(p_dnis) AS d(dni);

    -- Ambas inserciones son atómicas: si una falla, se revierte la operación.
    RETURN v_reserva;
END;
$$;

-- 5. FUNCIONES PARA ADMINISTRADORES ----------------------------
-- En JS: db.rpc('actualizar_mesas', {p_mesas})

CREATE FUNCTION public.actualizar_mesas(p_mesas integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_max_ocupacion integer;
    v_ahora timestamp;
BEGIN
    IF auth.uid() IS NULL OR public.es_admin() IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo el administrador puede actualizar las mesas.';
    END IF;
    IF p_mesas IS NULL OR p_mesas NOT BETWEEN 0 AND 20 THEN
        RAISE EXCEPTION 'La cantidad de mesas debe estar entre 0 y 20.';
    END IF;
    PERFORM 1 FROM public.configuracion_restaurante WHERE id = 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Falta configurar el restaurante.'; END IF;
    v_ahora := clock_timestamp() AT TIME ZONE 'America/Lima';

    -- Busca el máximo de mesas ocupadas en cualquier bloque activo o futuro.
    SELECT COALESCE(MAX(t.ocupadas), 0)::integer INTO v_max_ocupacion
    FROM (
        SELECT bloque.inicio, SUM(r.cantidad_mesas) AS ocupadas
        FROM public.reservas AS r
        CROSS JOIN LATERAL generate_series(
            r.fecha_reserva + r.hora_reserva,
            r.fecha_reserva + r.hora_reserva + INTERVAL '90 minutes',
            INTERVAL '30 minutes'
        ) AS bloque(inicio)
        WHERE r.estado IN ('pendiente', 'asistio')
          AND r.fecha_reserva + r.hora_reserva + INTERVAL '2 hours' > v_ahora
          AND bloque.inicio + INTERVAL '30 minutes' > v_ahora
        GROUP BY bloque.inicio
    ) AS t;

    IF p_mesas < v_max_ocupacion THEN
        RAISE EXCEPTION 'No puedes reducir las mesas por debajo de las reservas existentes (minimo: %).', v_max_ocupacion;
    END IF;
    UPDATE public.configuracion_restaurante SET mesas_habilitadas = p_mesas WHERE id = 1;
    RETURN p_mesas;
END;
$$;

-- En JS: db.rpc('confirmar_asistencia', {p_reserva_id})

CREATE FUNCTION public.confirmar_asistencia(p_reserva_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_ahora timestamp;
BEGIN
    IF auth.uid() IS NULL OR public.es_admin() IS NOT TRUE THEN
        RAISE EXCEPTION 'Solo el administrador puede confirmar asistencia.';
    END IF;
    -- Impide que una confirmación y el vencimiento modifiquen a la vez la fila.
    PERFORM 1 FROM public.reservas WHERE id = p_reserva_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La reserva no existe.'; END IF;
    v_ahora := clock_timestamp() AT TIME ZONE 'America/Lima';
    UPDATE public.reservas SET estado = 'asistio'
    WHERE id = p_reserva_id AND estado = 'pendiente'
      AND fecha_reserva + hora_reserva <= v_ahora
      AND fecha_reserva + hora_reserva + INTERVAL '2 hours' > v_ahora;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La reserva no esta pendiente o esta fuera del plazo de asistencia.';
    END IF;
    RETURN true;
END;
$$;

-- 6. VENCIMIENTO AUTOMÁTICO ------------------------------------
-- Conserva historial. Las mesas se liberan al terminar el intervalo,
-- aun si Cron todavía no ha actualizado la etiqueta de estado.

CREATE FUNCTION public.vencer_reservas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_total integer;
BEGIN
    UPDATE public.reservas SET estado = 'vencida'
    WHERE estado = 'pendiente'
      AND fecha_reserva + hora_reserva + INTERVAL '2 hours'
          <= (clock_timestamp() AT TIME ZONE 'America/Lima');
    GET DIAGNOSTICS v_total = ROW_COUNT;
    RETURN v_total;
END;
$$;

-- 7. PERMISOS DE EJECUCIÓN DE FUNCIONES -------------------------
-- Los permisos predeterminados de Supabase pueden ser amplios.
-- Se revocan explícitamente, también de anon y authenticated.

REVOKE ALL ON FUNCTION public.validar_horario_reserva(date, time),
    public.mesas_libres_intervalo(date, time),
    public.calcular_disponibilidad(date, time),
    public.crear_reserva(date, time, integer, text[]),
    public.actualizar_mesas(integer),
    public.confirmar_asistencia(bigint),
    public.vencer_reservas()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.calcular_disponibilidad(date, time),
    public.crear_reserva(date, time, integer, text[]),
    public.actualizar_mesas(integer),
    public.confirmar_asistencia(bigint)
TO authenticated;
-- Las funciones administrativas comprueban es_admin() internamente.
-- Las funciones internas y de vencimiento quedan para su propietario.

COMMIT;

-- 8. SUPABASE CRON: EJECUCIÓN CADA MINUTO -----------------------
-- Si Cron no está habilitado o no hay permisos, se conserva la migración
-- anterior y se muestra una advertencia. Habilitar Cron en Integrations
-- y ejecutar SOLO esta sección si falla (no repetir toda la migración).

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
    GRANT USAGE ON SCHEMA cron TO postgres;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
    PERFORM cron.schedule('lamar_vencer_reservas', '* * * * *',
        'SELECT public.vencer_reservas();');
    RAISE NOTICE 'Cron configurado: lamar_vencer_reservas (cada minuto).';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Las tablas y funciones ya se crearon. Cron pendiente: %', SQLERRM;
END;
$$;

-- 9. VERIFICACIÓN FINAL (solo lectura) ---------------------------
SELECT id, mesas_habilitadas, sillas_por_mesa, feriados
FROM public.configuracion_restaurante;

-- Para comprobar la tarea, ejecutar aparte cuando Cron esté habilitado:
-- SELECT jobid, jobname, schedule, active FROM cron.job
-- WHERE jobname = 'lamar_vencer_reservas';
-- Para registrar feriados del proyecto (solo SQL Editor; antes de reservar):
-- UPDATE public.configuracion_restaurante SET feriados = ARRAY[DATE '2026-12-25'] WHERE id = 1;
