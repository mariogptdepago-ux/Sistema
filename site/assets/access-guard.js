(() => {
"use strict";

const APP_ID = String(window.__SECURE_APP_ID__ || "");
const APP_TITLE = String(window.__SECURE_APP_TITLE__ || "Aplicación");
const API = String(window.ACCESS_CONTROL_CONFIG?.API_BASE || "").replace(/\/+$/, "");
const TOKEN_KEY = `secure_app_token:${APP_ID}`;
let timer = null;

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function overlay() {
  let el = document.getElementById("secureAccessOverlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "secureAccessOverlay";
    document.body.appendChild(el);
  }
  return el;
}
function lock(title, message, showReload=false) {
  document.documentElement.classList.add("secure-access-locked");
  const el = overlay();
  el.innerHTML = `<div class="secure-card">
    <span class="badge">Acceso protegido</span>
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    ${showReload ? '<button type="button" id="secureReload">Recargar</button>' : ''}
  </div>`;
  if (showReload) document.getElementById("secureReload")?.addEventListener("click", () => location.reload());
}
function unlock() {
  document.getElementById("secureAccessOverlay")?.remove();
  document.documentElement.classList.remove("secure-access-locked");
}
function installDeterrents() {
  document.addEventListener("contextmenu", e => e.preventDefault(), true);
  document.addEventListener("keydown", e => {
    const k = String(e.key || "").toLowerCase();
    const blocked = k === "f12" ||
      (e.shiftKey && k === "f10") ||
      (e.ctrlKey && ["u","s"].includes(k)) ||
      (e.ctrlKey && e.shiftKey && ["i","j","c","k"].includes(k));
    if (blocked) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}
async function api(path, options={}) {
  if (!API || API.includes("CHANGE-ME")) throw new Error("La URL del servicio de acceso no está configurada.");
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  return fetch(API + path, {...options, headers, cache:"no-store"});
}
async function verifyExistingToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  try {
    const r = await api("/api/auth/verify", {
      method:"POST",
      headers:{"Authorization":"Bearer " + token},
      body:JSON.stringify({appId:APP_ID})
    });
    if (!r.ok) {
      sessionStorage.removeItem(TOKEN_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
function showLogin(message="") {
  document.documentElement.classList.add("secure-access-locked");
  const el = overlay();
  el.innerHTML = `<div class="secure-card">
    <span class="badge">Acceso protegido</span>
    <h1>${esc(APP_TITLE)}</h1>
    <p>Ingresa un usuario autorizado para esta aplicación.</p>
    <form id="secureLoginForm" autocomplete="off">
      <label>Usuario<input id="secureUser" maxlength="80" required autocomplete="username"></label>
      <label>Contraseña<input id="securePassword" type="password" maxlength="256" required autocomplete="current-password"></label>
      <p id="secureError" class="error" role="alert">${esc(message)}</p>
      <button id="secureLoginButton" type="submit">Ingresar</button>
    </form>
  </div>`;
  const form = document.getElementById("secureLoginForm");
  const user = document.getElementById("secureUser");
  const pass = document.getElementById("securePassword");
  const error = document.getElementById("secureError");
  const button = document.getElementById("secureLoginButton");
  user.focus();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = "";
    try {
      const r = await api("/api/auth/login", {
        method:"POST",
        body:JSON.stringify({appId:APP_ID,username:user.value.trim(),password:pass.value})
      });
      const data = await r.json().catch(() => ({}));
      pass.value = "";
      if (!r.ok || !data.token) {
        error.textContent = data.error || "Acceso denegado.";
        return;
      }
      sessionStorage.setItem(TOKEN_KEY, data.token);
      unlock();
      window.dispatchEvent(new CustomEvent("secure-access-granted", {
        detail:{appId:APP_ID, username:data.username, displayName:data.displayName}
      }));
      beginRevalidation();
    } catch (err) {
      error.textContent = err?.message || "No fue posible validar el acceso.";
    } finally {
      button.disabled = false;
    }
  });
}
function beginRevalidation() {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    const ok = await verifyExistingToken();
    if (!ok) {
      clearInterval(timer);
      timer = null;
      sessionStorage.removeItem(TOKEN_KEY);
      lock("Acceso revocado", "La aplicación fue desactivada, el permiso cambió o la sesión venció.", true);
    }
  }, 30000);
}
async function boot() {
  installDeterrents();
  if (location.protocol === "file:") return;
  if (!APP_ID) return lock("Configuración incompleta", "Este HTML no tiene un identificador de aplicación.");
  if (!["https:","http:"].includes(location.protocol)) return lock("Origen no permitido", "Abre la aplicación desde el sitio publicado.");

  lock("Comprobando acceso", "Validando el estado de la aplicación…");
  if (await verifyExistingToken()) {
    unlock();
    beginRevalidation();
    return;
  }
  try {
    const r = await api("/api/apps/" + encodeURIComponent(APP_ID));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return lock("Aplicación no disponible", data.error || "No fue posible comprobar el estado.");
    if (!data.available) return lock("Aplicación desactivada", data.reason || "El administrador no ha habilitado esta aplicación.");
    showLogin();
  } catch (err) {
    lock("No se pudo validar el acceso", err?.message || "Error de conexión con el servicio de autorización.");
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
else boot();
})();