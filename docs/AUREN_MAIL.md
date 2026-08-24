# Auren Mail Collector

Auren Mail recopila el correo completo de varias cuentas Gmail, conserva contexto de hilo y metadatos de adjuntos, y lo reenvía **sin IA** a un Gmail central. Selecciona la unión de mensajes recibidos tras el último checkpoint y todos los mensajes que aún estén sin leer; por tanto, marcar un mensaje como leído no lo hace desaparecer.

## Arquitectura y fiabilidad

`gmail-client` pagina Gmail, descarga mensajes/hilos y normaliza MIME; `digest` serializa y divide por bytes; `sender` está implementado por el gateway Gmail; `state` persiste atómicamente el checkpoint y las partes; `runner` orquesta la operación. Un estado `pending` se escribe antes de enviar. Cada parte confirmada se registra inmediatamente. Un reinicio reanuda la primera parte no confirmada. El checkpoint solo avanza después de todas las partes. Se prefiere un posible duplicado (una respuesta Gmail perdida tras aceptar un envío) a perder correo.

Los mensajes enormes se fragmentan como `base64-utf8`, con número y total explícitos; no se truncan. El manifest enumera unidades y la validación exige que cada clave cuenta/mensaje seleccionada aparezca. Los adjuntos se representan mediante nombre, MIME, tamaño e identificador Gmail; no se descarga su binario.

## Instalación local

1. Instale Node.js 20+, ejecute `npm ci`, copie `.env.example` a `.env` y complete las variables.
2. Ejecute `npm run build` y `npm start`. Abra `/setup?key=SU_ADMIN_PASSWORD`, pulse **Add Gmail Account**, acepte OAuth y repita para cuentas adicionales.
3. Configure `AUREN_DIGEST_RECIPIENT` y `AUREN_SENDER_ACCOUNT` (esta última debe ser una cuenta conectada).
4. Pruebe con `npm test` y ejecute manualmente `npm run collect`. Confirme que Gmail central contiene todas las partes `1/N` con el mismo `DIGEST_ID`.

La autorización solicita `gmail.readonly`, `gmail.modify`, `gmail.send` y `userinfo.email` porque el servidor MCP original también modifica etiquetas; el collector solo usa lectura y envío. Para una instalación dedicada se recomienda retirar `gmail.modify` y separar cuentas fuente (`gmail.readonly`) de remitente (`gmail.send`) en una evolución futura. Los refresh tokens se cifran en disco con AES-256-GCM. Proteja `ENCRYPTION_KEY`, el volumen `DATA_DIR`, `GOOGLE_CLIENT_SECRET` y `TOKENS_DATA` como secretos. Nunca se registran cuerpos ni tokens.

## Horarios y despliegue

La operación no depende del scheduler. Configure el scheduler del proveedor con zona `Europe/Madrid` para ejecutar `npm run collect` a `0 9,18,20 * * *`. En hosts cuyo cron opera en UTC, use un scheduler con soporte IANA (el cambio CET/CEST impide expresar Madrid correctamente con un único cron UTC). Evite ejecutar dos instancias simultáneas contra el mismo archivo de estado.

Construya con `docker build -t auren-mail .`. Monte `/app/data` como volumen persistente y suministre secretos mediante el panel del host. El contenedor conserva el servicio web `/health`; el collector puede ejecutarse con `docker run ... auren-mail npm run collect` compartiendo el mismo volumen. Como alternativa sin servidor persistente, consulte el [despliegue seguro con GitHub Actions](GITHUB_ACTIONS.md).

Hugging Face Spaces está pensado para aplicaciones persistentes y puede dormir; no es una garantía de cron. Use un Space Docker únicamente para OAuth/health con almacenamiento persistente de pago, y un Scheduled Job externo que invoque la misma imagen/comando. Los secretos se configuran en Settings, nunca en Git. Si Jobs o almacenamiento persistente no están disponibles en su plan, despliegue sin cambios en Railway, Cloud Run Jobs, GitHub Actions con estado externo, o un servidor con volumen.

## Diagnóstico

* `No token for ...`: vuelva a autorizar esa cuenta desde `/setup`.
* `AUREN_... required`: configure destinatario y remitente.
* Error Gmail/rate limit: no borre `state.json`; la siguiente ejecución reanudará las partes pendientes.
* Compruebe `data/auren/state.json`: la ausencia de `pending` y la presencia de `lastSuccessfulRun` indican finalización. Si existe `pending`, compare `sentParts` con el total.
* No publique `.env`, `data/`, logs ni dumps. Haga backups cifrados del volumen; el estado contiene cuerpos de correo durante una ejecución pendiente.
