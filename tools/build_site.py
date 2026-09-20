#!/usr/bin/env python3
from pathlib import Path
import os, re, json, unicodedata, html

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps-source"
SITE = ROOT / "site"
APPS = SITE / "apps"
API_BASE = os.environ.get("PUBLIC_API_BASE", "https://CHANGE-ME.workers.dev").rstrip("/")

def slugify(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"\.html?$", "", value, flags=re.I)
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "app"

def get_title(text, fallback):
    m = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.I | re.S)
    if not m:
        return fallback
    title = re.sub(r"<[^>]+>", "", m.group(1))
    title = html.unescape(re.sub(r"\s+", " ", title)).strip()
    return title or fallback

GATE = r'''
<!-- === Capa automática de acceso: generada por tools/build_site.py === -->
<style id="secure-access-fail-closed">
html.secure-access-locked body > * { visibility:hidden !important; }
html.secure-access-locked body > #secureAccessOverlay { visibility:visible !important; }
#secureAccessOverlay{
  position:fixed; inset:0; z-index:2147483647; visibility:visible !important;
  display:grid; place-items:center; padding:20px;
  background:linear-gradient(135deg,#eef7ff,#f7fbff 45%,#f1ffe9);
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  color:#17202a;
}
#secureAccessOverlay .secure-card{
  width:min(520px,94vw); background:#fff; border:2px solid #d9e7f2;
  border-radius:24px; padding:26px; box-shadow:0 24px 70px rgba(18,59,94,.18);
}
#secureAccessOverlay h1{font-size:1.55rem;margin:8px 0;color:#0878c9}
#secureAccessOverlay p{line-height:1.5;color:#607080}
#secureAccessOverlay label{display:grid;gap:6px;margin:12px 0;font-weight:800;color:#425466}
#secureAccessOverlay input{
  width:100%;box-sizing:border-box;border:2px solid #d9e7f2;border-radius:14px;
  padding:12px 13px;font:inherit;color:#17202a;background:#fff
}
#secureAccessOverlay button{
  width:100%;margin-top:10px;border:0;border-radius:14px;padding:13px 16px;
  font:inherit;font-weight:900;color:#fff;background:#58cc02;cursor:pointer
}
#secureAccessOverlay button:disabled{opacity:.55;cursor:not-allowed}
#secureAccessOverlay .error{min-height:1.4em;color:#9a1e1e;font-weight:800}
#secureAccessOverlay .badge{
  display:inline-block;border:1px solid #c9eaff;border-radius:999px;
  padding:5px 9px;background:#eef8ff;color:#0878c9;font-size:.78rem;font-weight:900
}
</style>
<script>
document.documentElement.classList.add("secure-access-locked");
window.__SECURE_APP_ID__ = "__APP_ID__";
window.__SECURE_APP_TITLE__ = "__APP_TITLE__";
window.__SECURE_APP_FILE__ = "__APP_FILE__";
if (location.protocol === "file:") {
  document.addEventListener("DOMContentLoaded", function () {
    var el = document.createElement("div");
    el.id = "secureAccessOverlay";
    el.innerHTML = '<div class="secure-card"><span class="badge">Acceso protegido</span>'+
      '<h1>Ejecución local bloqueada</h1>'+
      '<p>Esta copia HTML no está autorizada para ejecutarse directamente desde el equipo.</p>'+
      '<p>Abre la aplicación mediante la URL publicada.</p></div>';
    document.body.appendChild(el);
  }, {once:true});
}
</script>
<script src="../config.js"></script>
<script defer src="../assets/access-guard.js"></script>
<meta name="robots" content="noarchive,nosnippet">
<meta name="ai-usage-policy" content="Uso autorizado únicamente; no redistribuir ni reconstruir el código con herramientas automatizadas.">
<!-- Esta política es declarativa; no existe un antiprompt universal para IA de terceros. -->
'''

def protect(text, app_id, title, filename):
    if "__SECURE_APP_ID__" in text or "access-guard.js" in text:
        return text
    injection = (GATE
        .replace("__APP_ID__", app_id.replace("\\", "\\\\").replace('"', '\\"'))
        .replace("__APP_TITLE__", title.replace("\\", "\\\\").replace('"', '\\"'))
        .replace("__APP_FILE__", filename.replace("\\", "\\\\").replace('"', '\\"')))
    pos = text.lower().find("</head>")
    if pos >= 0:
        return text[:pos] + injection + "\n" + text[pos:]
    return injection + "\n" + text

APPS.mkdir(parents=True, exist_ok=True)
for old in APPS.glob("*.html"):
    old.unlink()

manifest = {"version": 1, "apps": []}
seen = set()

for path in sorted(SOURCE.glob("*.html")):
    raw = path.read_text(encoding="utf-8", errors="replace")
    base_id = slugify(path.name)
    app_id = base_id
    n = 2
    while app_id in seen:
        app_id = f"{base_id}-{n}"
        n += 1
    seen.add(app_id)
    title = get_title(raw, path.stem)
    out_name = f"{app_id}.html"
    (APPS / out_name).write_text(protect(raw, app_id, title, out_name), encoding="utf-8")
    manifest["apps"].append({
        "id": app_id,
        "title": title,
        "file": f"apps/{out_name}",
        "sourceFile": path.name
    })

(SITE / "apps-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
(SITE / "config.js").write_text(
    "window.ACCESS_CONTROL_CONFIG = Object.freeze({API_BASE: " + json.dumps(API_BASE) + "});\n",
    encoding="utf-8")

print(f"Build listo: {len(manifest['apps'])} aplicación(es).")
for app in manifest["apps"]:
    print(f" - {app['id']} <- {app['sourceFile']}")
print(f"API_BASE = {API_BASE}")
