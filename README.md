# Sistema HTML controlado — GitHub + Cloudflare

Flujo final:

`copiar HTML → push → detección automática → publicación → registro DESACTIVADO → activar desde panel`

## Carpetas
- `apps-source/`: coloca aquí nuevos HTML.
- `tools/build_site.py`: detecta y protege todos los HTML.
- `site/`: salida publicada en GitHub Pages.
- `site/control-activacion.html`: panel de activación y usuarios.
- `worker/`: API segura y almacenamiento en Cloudflare KV.
- `.github/workflows/`: automatización.

## Configuración inicial de Cloudflare

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create STATE
```

Pega el ID devuelto en `worker/wrangler.toml`, reemplazando `REEMPLAZAR_KV_NAMESPACE_ID`.

Cambia también:

```toml
ALLOWED_ORIGINS = "https://CHANGE-ME.github.io"
```

por tu origen real de GitHub Pages, por ejemplo `https://usuario.github.io`.

Crea los secretos:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SYNC_SECRET
```

Después:

```bash
npx wrangler deploy
```

Guarda la URL del Worker.

## Configuración de GitHub

En **Settings → Pages**, selecciona **GitHub Actions**.

En **Settings → Secrets and variables → Actions**:

Variable:
- `PUBLIC_API_BASE` = URL del Worker.

Secrets:
- `SYNC_SECRET` = el mismo del Worker.
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Los dos últimos permiten desplegar el Worker desde GitHub cuando cambies su código.

## Primer push

Al hacer push a `main`, el workflow:
1. detecta `apps-source/*.html`;
2. genera IDs estables;
3. inserta la capa común de acceso;
4. genera `site/apps-manifest.json`;
5. sincroniza el manifest con el Worker;
6. publica GitHub Pages.

Toda app nueva queda desactivada automáticamente.

## Panel

Abre:

`https://TU-USUARIO.github.io/TU-REPOSITORIO/control-activacion.html`

Ingresa `ADMIN_PASSWORD`.

Desde allí puedes:
- activar/desactivar aplicaciones;
- programar inicio/fin;
- crear usuarios;
- bloquear usuarios;
- cambiar contraseñas;
- asignar apps por usuario.

## Agregar un HTML nuevo

Copia:

`apps-source/Mi-Nueva-Practica.html`

y luego:

```bash
git add .
git commit -m "Agregar nueva práctica"
git push
```

No edites `access-guard.js`, `apps-manifest.json` ni `site/apps/`.

La nueva app aparecerá automáticamente en el panel como **DESACTIVADA**.

## Revocación

Una app abierta revalida su acceso cada 30 segundos. Si la desactivas, bloqueas al usuario, quitas el permiso o finaliza la ventana horaria, se cierra en la siguiente revalidación.

## Desarrollo local

```bash
cd worker
cp .dev.vars.example .dev.vars
npm install
npx wrangler dev
```

En otra terminal:

```bash
PUBLIC_API_BASE=http://127.0.0.1:8787 python tools/build_site.py
python -m http.server 8000 -d site
```

Consulta `SECURITY_NOTES.md` para las limitaciones del hosting estático.
