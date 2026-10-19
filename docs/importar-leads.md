# Cómo preparar el Excel de leads para importarlo

Dónde se importa: **CRM → Datos → Importar desde Excel o CSV**.

## Regla de oro

**Todo lo que entra del Excel entra como OPORTUNIDAD.** No importa lo que ponga en la columna *Estado* (Pendiente, Contactado, vacío...). Si un estado concreto debe empezar en otra etapa, se cambia a mano en el resumen que aparece antes de guardar. Hasta que pulses **Importar** no se guarda nada.

## Formato del archivo

- Admite `.xlsx`, `.xls` y `.csv` (CSV con `;` o `,`).
- Una fila por empresa, una hoja con los datos. Si el libro tiene varias hojas, se usa la primera que tenga una columna *Empresa*.
- La **fila de títulos** debe estar entre las 15 primeras filas del archivo y debe incluir una columna que empiece por **Empresa**. Si no existe, el archivo se rechaza.
- No hace falta respetar el orden de las columnas, ni que estén todas. Se detectan por el **principio** del título (da igual mayúsculas o tildes).

## Columnas que se reconocen

| Columna | El título debe empezar por | Qué hace |
|---|---|---|
| Empresa | `Empresa` | **Obligatoria.** Sin nombre de empresa, la fila se ignora |
| Oficio | `Oficio`, `Sector` o `Actividad` | Tipo de negocio |
| Teléfono | `Tel` (Teléfono, Tel., Tlf...) | Se limpia y se formatea (600 111 222). Si hay varios, el primero es el principal y el resto va a Notas |
| Email | `Email`, `E-mail` o `Correo` | Se extrae el email aunque venga con texto alrededor. Si hay varios, el resto va a Notas |
| Ubicación | `Ubicaci` | Población o dirección |
| Zona | `Zona` | Zona comercial para organizar las rutas de llamadas |
| Web | `Web`, `Pagina`, `URL` o `Sitio` | Se le quitan los espacios |
| Encaje | `Encaje` o `ICP` | Alto / Medio / Bajo |
| Persona de contacto | `Persona` o `Contacto` | Nombre de la persona |
| Nota / Fiabilidad | `Nota` o `Fiabilidad` | Pasa a Notas como "Fiabilidad del dato: ..." |
| Comentarios | `Comentario` | Pasa tal cual a Notas |
| Estado | `Estado` | Se muestra en el resumen, pero **todo entra como Oportunidad** (ver regla de oro) |
| Fecha contacto | `Fecha` | Si hay fecha y dejas marcada la casilla, se crea una llamada en el historial con esa fecha |

Cualquier otra columna se ignora.

## Qué limpia el importador por ti

- **Teléfonos:** quita espacios y guiones, y el prefijo +34 / 0034. Separa varios teléfonos en la misma celda cuando van con `/`, `;`, `,`, `-` o "y". Si el teléfono no es válido, se guarda el original en Notas y te avisa.
- **Emails:** pasa a minúsculas y descarta los que no tienen formato de email (el original queda en Notas).
- **Fechas:** acepta fecha de Excel, `2026-10-19` y `19/10/2026`.
- **Duplicados:** una fila se omite si coincide con un lead que ya existe, o con otra fila del mismo archivo, en cualquiera de estos tres datos: los 9 últimos dígitos del teléfono, el email o el nombre de empresa + ubicación (sin "S.L.", "S.A.", etc.). El resumen indica cuántas se omiten.

## Consejos para que salga bien a la primera

1. Una sola fila de títulos, sin celdas combinadas y sin filas de totales al final.
2. Escribe los teléfonos y emails en su propia columna (no mezclados en Comentarios).
3. Usa siempre los mismos valores en *Encaje* (Alto, Medio, Bajo) para poder filtrar luego.
4. Rellena *Zona* si quieres usar la vista de llamadas por zonas.
5. Haz una **copia de seguridad** antes de importar un archivo grande (Ajustes → Copia y datos).
6. Importa un archivo pequeño de prueba (3-5 filas) la primera vez que cambies de plantilla de Excel.

## Plantilla mínima

| Empresa | Oficio | Teléfono | Email | Ubicación | Zona | Encaje | Estado | Fecha contacto |
|---|---|---|---|---|---|---|---|---|
| Ejemplo Instalaciones S.L. | Electricidad | 600 111 222 | info@ejemplo.es | Getafe | Sur | Alto | | |

## Si algo sale mal

- **"No encuentro una columna Empresa":** revisa que el título empiece por "Empresa" y esté en las 15 primeras filas.
- **Importé algo mal y quiero repetirlo:** elimina los leads (Eliminar lead, pulsando dos veces) o pide que se borren en bloque, y vuelve a importar.
- **No carga el archivo:** copia las celdas en Excel (Ctrl+A, Ctrl+C) y pégalas en el cuadro de texto de la propia pantalla de importación.
