-- ESQUEMA DE LA BASE DE DATOS DEL ERP (ya aplicado en Supabase, proyecto "ERP Tercio").
-- Se guarda aquí como documentación y para poder reconstruirla.

-- ===== 1) Fundamentos: perfiles y roles =====
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null default '',
  roles text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint profiles_roles_validos check (roles <@ array['admin','comercial','operativa']::text[])
);
alter table public.profiles enable row level security;

create or replace function private.has_role(wanted text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and (p.roles && wanted or 'admin' = any (p.roles)));
$$;
create or replace function private.has_any_role()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and cardinality(p.roles) > 0);
$$;
revoke execute on function private.has_role(text[]) from public, anon;
revoke execute on function private.has_any_role() from public, anon;
grant execute on function private.has_role(text[]) to authenticated;
grant execute on function private.has_any_role() to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

grant select, update on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.has_any_role()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select private.has_role('{}'::text[]))) with check ((select private.has_role('{}'::text[])));

-- ===== 2) Tablas del ERP y políticas por rol =====
create or replace function private.touch_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

do $$
declare t text; rec record;
begin
  foreach t in array array['leads','interacciones','propuestas','contratos','empresas','trabajadores','maquinas',
    'documentos','horas','facturas','gastos','tareas','procesos','procpartes','registro','config']
  loop
    execute format('create table public.%I (id text primary key, data jsonb not null default ''{}''::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      created_by uuid default auth.uid(), updated_by uuid)', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_row()', t || '_touch', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;

  for rec in select * from (values
    ('leads',         array['comercial']::text[],             array[]::text[]),
    ('interacciones', array['comercial']::text[],             array[]::text[]),
    ('propuestas',    array['comercial']::text[],             array[]::text[]),
    ('contratos',     array[]::text[],                        array['comercial','operativa']::text[]),
    ('empresas',      array['operativa']::text[],             array['comercial']::text[]),
    ('trabajadores',  array['operativa']::text[],             array[]::text[]),
    ('maquinas',      array['operativa']::text[],             array[]::text[]),
    ('documentos',    array['operativa']::text[],             array[]::text[]),
    ('horas',         array['operativa']::text[],             array[]::text[]),
    ('facturas',      array[]::text[],                        array['comercial','operativa']::text[]),
    ('gastos',        array[]::text[],                        array[]::text[]),
    ('tareas',        array['comercial','operativa']::text[], array[]::text[]),
    ('procesos',      array['operativa']::text[],             array['comercial']::text[]),
    ('procpartes',    array['operativa']::text[],             array['comercial']::text[])
  ) as v(tbl, w, r)
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.has_role(%L::text[])))', rec.tbl||'_sel', rec.tbl, rec.w || rec.r);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_role(%L::text[])))', rec.tbl||'_ins', rec.tbl, rec.w);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_role(%L::text[]))) with check ((select private.has_role(%L::text[])))', rec.tbl||'_upd', rec.tbl, rec.w, rec.w);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_role(%L::text[])))', rec.tbl||'_del', rec.tbl, rec.w);
  end loop;
end $$;

create policy registro_sel on public.registro for select to authenticated using ((select private.has_role('{}'::text[])));
create policy registro_ins on public.registro for insert to authenticated with check ((select private.has_any_role()));
create policy registro_upd on public.registro for update to authenticated using ((select private.has_role('{}'::text[]))) with check ((select private.has_role('{}'::text[])));
create policy registro_del on public.registro for delete to authenticated using ((select private.has_role('{}'::text[])));
create policy config_sel on public.config for select to authenticated using ((select private.has_any_role()));
create policy config_ins on public.config for insert to authenticated with check ((select private.has_role('{}'::text[])));
create policy config_upd on public.config for update to authenticated using ((select private.has_role('{}'::text[]))) with check ((select private.has_role('{}'::text[])));
create policy config_del on public.config for delete to authenticated using ((select private.has_role('{}'::text[])));

-- ===== 3) Almacén privado de archivos =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('adjuntos', 'adjuntos', false, 20971520) on conflict (id) do nothing;

create or replace function private.adjuntos_roles(carpeta text)
returns text[] language sql immutable set search_path = '' as $$
  select case carpeta
    when 'leads'      then array['comercial']::text[]
    when 'documentos' then array['operativa']::text[]
    else array[]::text[]
  end;
$$;
revoke execute on function private.adjuntos_roles(text) from public, anon;
grant execute on function private.adjuntos_roles(text) to authenticated;

create policy adjuntos_sel on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and (select private.has_role(private.adjuntos_roles((storage.foldername(name))[1]))));
create policy adjuntos_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and (select private.has_role(private.adjuntos_roles((storage.foldername(name))[1]))));
create policy adjuntos_upd on storage.objects for update to authenticated
  using (bucket_id = 'adjuntos' and (select private.has_role(private.adjuntos_roles((storage.foldername(name))[1]))))
  with check (bucket_id = 'adjuntos' and (select private.has_role(private.adjuntos_roles((storage.foldername(name))[1]))));
create policy adjuntos_del on storage.objects for delete to authenticated
  using (bucket_id = 'adjuntos' and (select private.has_role(private.adjuntos_roles((storage.foldername(name))[1]))));

-- ===== 4) Actualizar campos de un documento (respeta RLS) =====
create or replace function public.doc_merge(p_table text, p_id text, p_patch jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_table not in ('leads','interacciones','propuestas','contratos','empresas','trabajadores','maquinas',
                     'documentos','horas','facturas','gastos','tareas','procesos','procpartes','registro','config') then
    raise exception 'tabla no permitida: %', p_table;
  end if;
  execute format('update public.%I set data = data || $1 where id = $2', p_table) using p_patch, p_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.doc_merge(text, text, jsonb) from public, anon;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;
