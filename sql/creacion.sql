-- Ejecutar en Supabase > SQL Editor

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nombre text,
  rol text not null default 'cliente' check (rol in ('cliente','admin')),
  creado timestamptz default now()
);

create table public.reportes_espera (
  id bigint generated always as identity primary key,
  usuario_id uuid not null default auth.uid() references auth.users on delete cascade,
  fecha_visita date not null,
  franja text not null check (franja in ('almuerzo','tarde','fin de semana o feriado')),
  minutos int not null check (minutos between 0 and 360),
  comentario text check (char_length(comentario) <= 500),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  creado timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.reportes_espera enable row level security;

create function public.es_admin() returns boolean
language sql security definer set search_path = public stable as
$$ select exists (select 1 from profiles where id = auth.uid() and rol = 'admin') $$;

-- Crea el perfil automáticamente al registrarse
create function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  insert into profiles (id, nombre) values (new.id, new.raw_user_meta_data->>'nombre');
  return new;
end $$;
create trigger al_registrarse after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- Perfiles: cada quien ve el suyo; el admin ve todos. Nadie edita su rol desde la web.
create policy "ver perfil" on profiles for select using (id = auth.uid() or es_admin());

-- Reportes
create policy "ver reportes" on reportes_espera for select
  using (estado = 'aprobado' or usuario_id = auth.uid() or es_admin());
create policy "crear reporte" on reportes_espera for insert to authenticated
  with check (usuario_id = auth.uid() and estado = 'pendiente');
create policy "moderar reporte" on reportes_espera for update using (es_admin());
create policy "borrar reporte" on reportes_espera for delete using (es_admin());

-- Convertirte en admin (cambia el correo, después de registrarte en la web):
-- update profiles set rol = 'admin' where id = (select id from auth.users where email = 'tu@correo.com');


grant usage on schema public to anon, authenticated;
grant select on public.reportes_espera to anon;
grant select, insert, update, delete on public.reportes_espera to authenticated;
grant select on public.profiles to authenticated;
grant execute on function public.es_admin() to anon, authenticated;

update profiles set rol = 'admin'
where id = (select id from auth.users where email = 'tu@correo.com');

UPDATE auth.users 
SET email_confirmed_at = NOW() 
WHERE email = 'robinet.enrique.21@gmail.com';

update profiles set rol = 'admin'
where id = (select id from auth.users where email = 'robinet.enrique.21@gmail.com');

UPDATE auth.users 
SET encrypted_password = crypt('ClaveTemporal123', gen_salt('bf', 10))
WHERE email = 'robinet.enrique.21@gmail.com';

-- Ver todos los reportes
select * from reportes_espera order by creado desc;

-- Solo los pendientes
select id, fecha_visita, franja, minutos, comentario
from reportes_espera
where estado = 'pendiente';

-- Promedio de espera por momento del día (solo aprobados)
select franja, round(avg(minutos)) as promedio_min, count(*) as reportes
from reportes_espera
where estado = 'aprobado'
group by franja;

-- Reportes con el nombre y correo de quien los envió
select r.fecha_visita, r.minutos, r.estado, p.nombre, u.email
from reportes_espera r
join profiles p on p.id = r.usuario_id
join auth.users u on u.id = r.usuario_id;

-- Cuántos usuarios hay y quiénes son admin
select rol, count(*) from profiles group by rol;

-- Aprobar o borrar a mano
update reportes_espera set estado = 'aprobado' where id = 1;
delete from reportes_espera where estado = 'rechazado';