# Notas de seguridad

El sistema separa GitHub (fuentes/build), GitHub Pages (publicación) y Cloudflare Worker + KV (estados, usuarios, hashes y sesiones).

Protecciones incluidas:
- Apps nuevas desactivadas por defecto.
- Login contra el Worker.
- Contraseñas de usuarios con PBKDF2-SHA256 + sal en KV.
- Sesiones HMAC con expiración.
- Revalidación cada 30 segundos.
- Bloqueo de `file://`.
- Bloqueo disuasorio de clic derecho y atajos comunes.
- Programación de fecha/hora de apertura y cierre.

Límite: GitHub Pages es estático. Una persona técnicamente avanzada puede descargar el HTML/JS publicado aunque la interfaz esté bloqueada. Para impedir que el HTML sea entregado antes de autenticar, habría que servir los activos detrás de Cloudflare Workers/Access en lugar de Pages.

La política para IA es declarativa; no existe un antiprompt universal que obligue a servicios de IA de terceros.
