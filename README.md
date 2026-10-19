# ERP TERCIO

ERP interno de TERCIO (CRM, operación CAE, facturación, tareas, procesos). Web estática (un solo `index.html`) publicada en Vercel, con **Supabase** como base de datos, login y almacén de archivos.

## Cómo está montado
| Pieza | Para qué sirve |
|---|---|
| `index.html` | El ERP completo (interfaz y lógica). |
| `supa.js` | Login, conexión con Supabase en tiempo real, archivos, usuarios y descargas. Imita lo que antes daba Claude para que `index.html` no haya cambiado. |
| `vendor/` | Librería oficial de Supabase (copia local, versión 2.45.4). |
| `supabase/schema.sql` | Tablas, roles y reglas de seguridad de la base de datos (ya aplicadas). |
| `vercel.json`, `robots.txt` | Cabeceras de seguridad y "no indexar": es una herramienta interna. |

## Seguridad
- La clave de `supa.js` es **pública** por diseño. Los datos los protegen las reglas de seguridad por filas (RLS) de Supabase.
- **Nunca** pongas en el código la clave secreta (`service_role`).
- Un usuario nuevo nace **sin roles** y no ve nada hasta que un admin se los asigna.
- Registro de nuevos usuarios desactivado en Supabase: solo entra quien se invita.

## Roles (se pueden sumar: una persona puede tener varios)
| Rol | Edita | Solo lectura |
|---|---|---|
| admin | Todo | — |
| comercial | Leads, interacciones, propuestas, tareas | Contratos, facturas, empresas, procesos |
| operativa | Empresas, trabajadores, máquinas, documentos, horas, procesos, tareas | Contratos, facturas |

## Alta de una persona
1. Supabase → Authentication → Users → *Add user* (email + contraseña temporal, "Auto Confirm User").
2. Asignar rol (SQL Editor): `update public.profiles set roles = array['comercial'], name = 'Nombre' where email = 'correo@dominio.es';`
3. La persona entra en la web y cambia su contraseña con "Cambiar contraseña".

## Qué no funciona fuera de Claude
Los botones "Claude" del editor de procesos (dibujar workflow desde texto y viceversa) están desactivados. Se podrían recuperar más adelante con una función en servidor que llame a la API de Claude.
