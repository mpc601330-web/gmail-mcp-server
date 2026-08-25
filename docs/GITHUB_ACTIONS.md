# Despliegue de Auren Mail con GitHub Actions

Esta modalidad no necesita Oracle, Hugging Face ni un servidor encendido. GitHub crea un runner temporal, restaura el estado cifrado, ejecuta Auren Mail, actualiza el estado cifrado y destruye el runner.

## Decisión de persistencia

Hay dos clases de datos claramente separadas:

* **Secrets Gmail:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`, `TOKENS_DATA`, destinatario y remitente solo viven en GitHub Actions Secrets. `TOKENS_DATA` reutiliza exactamente la exportación multicuenta cifrada de `TokenStore`; contiene un JSON serializado en Base64 cuyos refresh tokens ya están cifrados con `ENCRYPTION_KEY`.
* **Estado operativo:** checkpoint, digest pendiente, partes y cuerpos pendientes se cifran con AES-256-GCM y una clave independiente antes de guardarse como `auren-state.enc` en la rama `auren-state`. El workflow reemplaza la rama con un commit raíz usando `force-with-lease`: no conserva intencionadamente un historial de estados y detecta escrituras concurrentes inesperadas.

No se usa cache porque no ofrece persistencia garantizada; tampoco artifacts porque caducan. Las variables del repositorio son texto visible y no son apropiadas. La rama es nativa de GitHub, recuperable y duradera. Aunque el ciphertext sea visible en un repositorio público, los datos privados quedan protegidos por cifrado autenticado. Perder `AUREN_STATE_ENCRYPTION_KEY` hace irrecuperable el estado. No reutilice esa clave para OAuth.

`concurrency` mantiene una única ejecución y **no cancela** una ejecución activa. Si una parte falla, los pasos `always()` cifran y publican el estado local actualizado; el siguiente workflow reanuda el mismo digest. Si Gmail aceptó una parte pero la respuesta o la persistencia falló, puede duplicarse: nunca se avanza el checkpoint para evitar ese duplicado.

## Configuración para María

### 1. Crear el entorno y los Secrets

1. Entre en la página del repositorio en GitHub.
2. Abra **Settings → Environments → New environment**, escriba exactamente `auren-mail-production` y créelo. No configure aprobación obligatoria, porque impediría las ejecuciones automáticas.
3. Dentro del entorno, en **Environment secrets**, cree estos nombres exactos:

| Secret | Cómo obtenerlo |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID de la credencial OAuth Web en Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | Client secret de esa misma credencial OAuth. |
| `ENCRYPTION_KEY` | La misma clave de 32+ caracteres usada al autorizar las cuentas y generar `TOKENS_DATA`. |
| `TOKENS_DATA` | El valor de exportación multicuenta mostrado en `/setup`; ya contiene tokens cifrados, no JSON en claro. |
| `AUREN_STATE_ENCRYPTION_KEY` | Una clave aleatoria nueva, distinta, de al menos 32 caracteres. |
| `AUREN_DIGEST_RECIPIENT` | Dirección del Gmail central que recibirá los digests. |
| `AUREN_SENDER_ACCOUNT` | Dirección exacta de una de las cuentas incluidas en `TOKENS_DATA`. |

Los valores nunca deben escribirse en un issue, commit, variable no secreta o log.

### 2. Añadir Gmail 1, Gmail 2 y Gmail 3

La autorización puede realizarse completamente en local, sin desplegar `/setup` ni exponer un callback público. Cree en Google Cloud un OAuth Client de tipo **Desktop app**, configure `.env` y ejecute `npm run oauth:authorize`. El comando usa PKCE y un callback temporal que solo escucha en `127.0.0.1`:

1. Ejecute `npm run oauth:authorize`, abra la URL mostrada y autorice Gmail 1.
2. Conserve el `data/accounts.json` local cifrado y mantenga siempre la misma `ENCRYPTION_KEY`. Si decide definir `TOKENS_DATA` localmente, actualícelo después de cada cuenta porque tiene prioridad sobre el archivo.
3. Repita `npm run oauth:authorize` para Gmail 2 y después Gmail 3. Puede comprobar el resultado con `npm run oauth:list`.
4. Copie el último valor completo de `TOKENS_DATA` al Secret del mismo nombre. Cada exportación contiene todas las cuentas; no cree un Secret por cuenta.

Google puede exigir consentimiento, 2FA y que cada dirección sea test user si la aplicación OAuth está en modo Testing. Esas acciones solo puede realizarlas la propietaria de las cuentas.

### 3. Probar y comprobar

1. Abra **Actions → Auren Mail Collector → Run workflow → Run workflow**.
2. Abra la ejecución. Los logs permitidos muestran únicamente cantidades, números de parte y éxito/fallo; nunca direcciones, tokens ni cuerpos.
3. En Gmail central busque `[AUREN MAIL RAW]`. Compruebe que para el `DIGEST_ID` más reciente existen todas las partes desde `Parte 1/N` hasta `Parte N/N`.
4. En GitHub, la rama `auren-state` debe contener solo `auren-state.enc`. No intente abrir ni editar el ciphertext.

## Horario Europe/Madrid

GitHub cron solo entiende UTC. El workflow se despierta al minuto 07 de cada hora y un gate calcula la hora usando `TZ=Europe/Madrid`. Solo ejecuta el collector a las horas locales `09`, `18` y `20`; así se adapta automáticamente a CET y CEST. `workflow_dispatch` omite el gate horario. GitHub advierte que los schedules pueden empezar con retraso bajo carga, por eso la hora es aproximada.

## Errores comunes

* **`Run failed` en collector:** no borre la rama de estado. Revise que todos los Secrets existan y vuelva a ejecutar manualmente; el digest pendiente se reanudará.
* **Fallo al descifrar estado:** `AUREN_STATE_ENCRYPTION_KEY` no coincide o el archivo fue modificado. Restaure la clave original; no inicialice un checkpoint vacío.
* **`TOKENS_DATA` inválido:** vuelva a copiar la exportación completa y confirme que `ENCRYPTION_KEY` es la original.
* **Google `invalid_grant`:** el refresh token fue revocado o caducó; vuelva a autorizar esa cuenta y actualice la exportación multicuenta.
* **Push rechazado:** compruebe **Settings → Actions → General → Workflow permissions** y permita Read and write permissions. No active protección que prohíba al workflow actualizar `auren-state`.
* **Partes duplicadas:** es el comportamiento seguro tras una respuesta Gmail perdida. Verifique el mismo `DIGEST_ID` y conserve una copia; duplicar tiene prioridad sobre perder correo.

## Seguridad del workflow

El collector solo se activa por `schedule` o `workflow_dispatch` desde la rama de confianza, nunca por `pull_request` ni `pull_request_target`. Los PR externos pueden ejecutar tests en un workflow CI separado sin Secrets. El workflow concede `contents: read` globalmente y solo el job real recibe `contents: write` para reemplazar el estado cifrado. npm cache solo almacena dependencias, nunca `data/`, `.env`, tokens o estado.
