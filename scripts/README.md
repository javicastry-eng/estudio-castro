# Scripts — Motor Jurisprudencial

## completar_resumenes_supabase.py

Automatiza la generación de resúmenes para registros de jurisprudencia que tienen `resumen_doctrina` vacío o con texto genérico ("Documento cargado desde Telegram").

### Instalación

```bash
pip install requests
```

### Uso

```bash
python3 scripts/completar_resumenes_supabase.py \
  --sb-url https://TU_PROJECT.supabase.co \
  --sb-key sb_secret_TU_SERVICE_ROLE_KEY \
  --ant-key sk-ant-api03-TU_ANTHROPIC_KEY
```

O con variables de entorno:

```bash
export SUPABASE_URL=https://TU_PROJECT.supabase.co
export SUPABASE_KEY=sb_secret_...
export ANTHROPIC_KEY=sk-ant-...
python3 scripts/completar_resumenes_supabase.py
```

### Qué hace

1. Lee todos los registros de la tabla `jurisprudencia` en Supabase
2. Filtra los que tienen `resumen_doctrina` vacío o con texto genérico
3. Si el registro tiene `DRIVE_URL`, intenta leer el contenido del documento
4. Genera un resumen jurídico con Claude (máx. 200 caracteres)
5. Actualiza `resumen_doctrina` en Supabase

### Cuándo ejecutarlo

Cada vez que se carguen nuevos fallos desde Telegram que queden con resumen vacío.

---

Estudio Castro — Dr. Javier Horacio Castro (CPACF T°102 F°174)
