Quiero que desarrolles una PWA extremadamente simple para registrar mi rutina de entrenamiento con mancuernas. La voy a usar principalmente desde Firefox en Android.

## Objetivo

La aplicación debe servirme como un tracker durante el entrenamiento.

Quiero poder ver:

* qué ejercicio estoy haciendo;
* qué serie estoy haciendo;
* cuántas series completé y cuántas faltan;
* cuántas repeticiones hice realmente;
* qué peso utilicé;
* qué ejercicio/serie corresponde hacer después;
* mi historial de entrenamientos.

La aplicación debe registrar mis datos, pero **no debe tomar decisiones de entrenamiento por mí**.

---

# Rutina

La rutina tiene exactamente 5 ejercicios, 3 series cada uno:

| Orden | Ejercicio                        | Series | Repeticiones iniciales |
| ----- | -------------------------------- | -----: | ---------------------: |
| 1     | Dumbbell Squat                   |      3 |                     10 |
| 2     | Dumbbell Romanian Deadlift (RDL) |      3 |                     10 |
| 3     | Dumbbell Chest Press             |      3 |                     10 |
| 4     | One-arm Dumbbell Row             |      3 |                     10 |
| 5     | Dumbbell Lateral Raise           |      3 |                     16 |

Total: **15 series por sesión**.

Las repeticiones iniciales son solamente un valor de partida sugerido para el contador. **Deben poder modificarse libremente en cualquier serie** con los botones `+` y `−`. No hay rangos ni validaciones que impidan otro número.

---

# Regla fundamental de las sesiones

**El usuario controla completamente el ciclo de vida de una sesión.**

La aplicación NO debe decidir automáticamente cuándo:

* comienza una sesión;
* continúa una sesión;
* termina una sesión;
* se crea una nueva sesión;
* se descarta una sesión.

La fecha, hora, tiempo transcurrido, cierre de la aplicación o inactividad **no tienen ninguna función para determinar el estado de una sesión**.

## Nueva sesión

Debe existir un botón claramente visible:

**NUEVA SESIÓN**

Al presionarlo, se crea una nueva sesión y comienza en:

> Dumbbell Squat — Serie 1/3

Solo a partir de ese momento se pueden registrar series y repeticiones de esa sesión.

## Sesión en progreso

Mientras exista una sesión abierta:

* debe conservarse exactamente el estado actual;
* cerrar Firefox no debe cerrarla;
* reiniciar el teléfono no debe cerrarla;
* que pase un día, una semana o cualquier cantidad de tiempo no debe cerrarla;
* nunca debe iniciarse automáticamente una sesión nueva;
* nunca debe descartarse automáticamente;
* nunca debe reemplazarse por otra sesión.

Si vuelvo a abrir la aplicación, debe mostrar exactamente dónde estaba.

## Completar sesión

Debe existir un botón:

**COMPLETAR SESIÓN**

Este es el único mecanismo que cierra una sesión.

Al presionarlo:

1. la sesión actual se considera terminada;
2. sus datos se sincronizan con D1 (ver "Sincronización");
3. la sesión pasa al historial;
4. deja de ser la sesión activa;
5. queda disponible `NUEVA SESIÓN`.

Importante:

**Avanzar a la siguiente serie NO completa la sesión.**

Avanzar únicamente registra la serie actual y pasa a la siguiente.

---

# Registro de cada serie

Cada serie debe registrar como mínimo:

* ejercicio;
* número de serie;
* repeticiones realizadas;
* peso utilizado.

Ejemplo:

```text
Squat

Serie 1
Peso: 10 kg
Repeticiones: 10

Serie 2
Peso: 10 kg
Repeticiones: 10

Serie 3
Peso: 10 kg
Repeticiones: 9
```

## Peso

El peso debe poder registrarse para cada serie.

* Unidad: kilogramos.
* Paso: **0,5 kg**.
* Valor inicial propuesto para una serie: el último peso registrado para ese mismo ejercicio, tomado del **historial global** (a través de todas las sesiones anteriores completadas más las series ya registradas en la sesión activa). Si no existe historial previo para ese ejercicio, el valor inicial queda vacío o en 0 y el usuario lo define.
* El usuario siempre puede modificarlo antes de avanzar.

No hacer recomendaciones automáticas de aumento o disminución de peso.

No implementar todavía progresión automática.

El objetivo es simplemente conservar el dato para poder analizarlo históricamente en el futuro.

## Repeticiones

Para cada serie quiero un contador de repeticiones.

Ejemplo:

```text
Repeticiones

      10

    −     +
```

Los botones `+` y `−` permiten modificar el número.

El contador comienza en el valor inicial del ejercicio (ver tabla "Rutina"):

* 10 para Squat, RDL, Chest Press y Row;
* 16 para Lateral Raise.

Debe permitirse registrar cualquier número razonable, sin bloquear al usuario. No debe requerir escritura manual: sólo `+` y `−`.

## Avance a la siguiente serie

**No existe un botón "Completar Serie".**

El registro de la serie se hace de forma implícita al avanzar a la siguiente. Debe existir una única acción visible, por ejemplo una flecha o botón grande:

**SIGUIENTE →**

Al presionarla:

1. se guardan peso y repeticiones actuales como la serie recién terminada;
2. la serie queda marcada como completada;
3. se avanza a la siguiente serie (o al primer set del siguiente ejercicio);
4. se actualiza el progreso.

Cuando se completan las 3 series de un ejercicio, se pasa al siguiente ejercicio.

En la última serie de la última sesión (`Lateral Raise 3/3`), presionar `SIGUIENTE →` debe registrar la serie y dejar la sesión con las 15 series completadas, **pero la sesión permanece abierta** hasta que el usuario presione `COMPLETAR SESIÓN`.

## Edición de series ya registradas

Cada serie ya completada dentro de la sesión activa debe mostrarse en un listado (por ejemplo, arriba o abajo de la serie actual) junto con un **botón con ícono de lápiz** que permita editarla.

Al presionar el lápiz:

* se puede modificar el peso y las repeticiones de esa serie ya completada;
* al confirmar la edición, se actualiza el valor guardado localmente;
* la posición dentro de la sesión no cambia;
* no se puede eliminar la serie, sólo modificarla.

La edición debe ser posible únicamente mientras la sesión esté activa (antes de `COMPLETAR SESIÓN`).

---

# Pantalla principal

La pantalla debe estar optimizada para utilizarse durante el entrenamiento desde un teléfono.

Mostrar claramente:

* ejercicio actual;
* serie actual, por ejemplo `Serie 2/3`;
* peso (con botones `−` / `+` en paso de 0,5 kg);
* contador de repeticiones con botones `−` y `+`;
* botón grande `SIGUIENTE →`;
* progreso general, por ejemplo `6/15 series`;
* próximo ejercicio/serie;
* series ya registradas de esta sesión, cada una con lápiz para editar;
* botón `COMPLETAR SESIÓN`.

El botón `COMPLETAR SESIÓN` debe diferenciarse claramente de `SIGUIENTE →` (color, ubicación y tamaño) para evitar pulsarlo accidentalmente.

---

# Historial y análisis futuro

El historial debe estar diseñado desde el principio para permitir análisis de performance posteriormente.

Cada sesión completada debe conservar datos estructurados, no texto concatenado.

Como mínimo:

```text
Session
- id           (UUID generado en el cliente)
- started_at
- completed_at

Set
- id           (UUID generado en el cliente)
- session_id
- exercise_id
- set_number
- reps
- weight
```

El sistema debe conservar cada serie individualmente.

Por ejemplo:

```text
Session #<uuid>
completed_at: 2026-09-10

Set 1
exercise: squat
set_number: 1
reps: 10
weight: 10

Set 2
exercise: squat
set_number: 2
reps: 10
weight: 10
```

Esto debe permitir posteriormente calcular, entre otras cosas:

* evolución de peso;
* evolución de repeticiones;
* volumen por ejercicio;
* volumen por sesión;
* mejores performances;
* promedio de repeticiones;
* frecuencia de entrenamiento;
* evolución temporal;
* comparación entre sesiones.

**No implementar todavía estos análisis.**

Solo asegurarse de que los datos necesarios quedan correctamente registrados.

---

# Cloudflare D1

El historial de sesiones completadas debe almacenarse en **Cloudflare D1**.

D1 será la fuente de verdad para el historial.

No utilizar KV como base de datos principal.

La arquitectura prevista es:

```text
Firefox Android
      ↓
    PWA
      ↓
Cloudflare Worker / API
      ↓
   Cloudflare D1
```

El Worker debe encargarse de las operaciones necesarias para:

* recibir una sesión completada con todas sus series en una única llamada;
* guardar la sesión y las series de forma idempotente;
* recuperar sesiones históricas;
* recuperar los datos necesarios para futuras funciones de análisis.

No exponer directamente las credenciales o mecanismos internos de D1 al navegador.

## Identificadores y unicidad

* `session_id` y `set_id` son **UUID v4 generados en el cliente**.
* El schema de D1 debe declararlos como PRIMARY KEY.
* Las inserciones en el Worker deben usar `INSERT OR IGNORE` (o `ON CONFLICT DO NOTHING`) para que un reintento con el mismo `session_id` / `set_id` no produzca duplicados.

## Autenticación mínima

* No hay cuentas de usuario.
* El endpoint del Worker está protegido por un **secreto compartido** enviado en un header (por ejemplo `X-App-Key`).
* El secreto se guarda como Cloudflare Worker Secret y se lee desde `env`.
* La PWA lo incluye en cada request. Se acepta que este secreto vive en el bundle del cliente; su propósito es evitar tráfico casual, no ofrecer seguridad fuerte.

---

# Sincronización

**La sincronización con D1 ocurre únicamente en `COMPLETAR SESIÓN`**, no serie por serie.

Flujo:

1. Durante la sesión, todas las series se guardan localmente (ver "Persistencia local").
2. Al presionar `COMPLETAR SESIÓN`:
   * se marca `completed_at` localmente;
   * la sesión pasa a un estado "pendiente de sincronizar";
   * se envía al Worker en un único POST con toda la sesión y sus series;
   * si la respuesta es OK, se marca como sincronizada;
   * si falla (offline o error), queda pendiente y se reintenta cuando haya conexión, sin volver a estar activa como sesión en progreso.
3. Los reintentos usan los mismos UUIDs, por lo que son seguros.

---

# Persistencia local y funcionamiento offline

La sesión activa y las sesiones completadas pendientes de sincronizar deben persistirse localmente.

* Se debe poder registrar una sesión completa **sin conexión**.
* Preferencia: **IndexedDB** (más apropiado para almacenar sesiones estructuradas y una cola de sincronización). Si por simplicidad conviene `localStorage` para el estado activo, es aceptable, pero la cola de sesiones pendientes de sincronizar debe estar en IndexedDB.
* La sesión activa debe sobrevivir a:
  * cierre de Firefox;
  * reinicio del teléfono;
  * pérdida temporal de conexión;
  * cualquier lapso de tiempo.
* Para el cálculo del "último peso usado" por ejercicio (valor inicial de la próxima serie), la app debe consultar:
  1. las series ya registradas en la sesión activa,
  2. si no hay, las sesiones completadas conservadas localmente,
  3. si no hay, D1.
  
  Alcanza con que este último peso esté disponible offline en base a lo que la app ya vio; no es necesario re-sincronizar historial completo al vuelo.

**La pérdida temporal de conexión nunca debe hacer que desaparezca la sesión ni debe provocar la creación de una nueva sesión.**

El diseño debe evitar duplicar sesiones o series gracias a los UUIDs y a `INSERT OR IGNORE` en el Worker.

---

# Importante: control manual del usuario

No implementar ningún tipo de lógica heurística.

NO hacer:

* "si cambió el día → nueva sesión";
* "si pasaron X horas → nueva sesión";
* "si hace mucho que no entrenás → nueva sesión";
* "si cerraste la app → nueva sesión";
* "si hay una sesión vieja → descartarla";
* "si la sesión parece terminada → completarla";
* "si completaste las 15 series → completar automáticamente la sesión".

Incluso después de completar las 15 series, la sesión **permanece abierta** hasta que el usuario presione:

**COMPLETAR SESIÓN**

Esto es deliberado.

La aplicación debe ser un **registrador**, no un entrenador que tome decisiones.

---

# Historial

Agregar una pantalla sencilla de historial.

Cada sesión debe mostrar:

* fecha de finalización;
* ejercicios;
* peso por serie;
* repeticiones por serie.

Ejemplo:

```text
10/09/2026

Squat
10 kg — 10 / 10 / 9

RDL
12 kg — 10 / 10 / 10

Chest Press
10 kg — 12 / 11 / 10

Row
10 kg — 10 / 10 / 9

Lateral Raise
5 kg — 15 / 14 / 13
```

Si el peso cambia entre series dentro de un mismo ejercicio, mostrarlo individualmente.

El historial se lee desde D1 vía el Worker. No hace falta cachear todo el historial localmente (más allá de lo necesario para el "último peso usado").

---

# Sin temporizadores

**NO implementar ningún temporizador.**

No necesito:

* timer de descanso;
* countdown;
* cronómetro;
* medición del tiempo entre series;
* duración del entrenamiento;
* recomendaciones basadas en tiempo.

Los únicos datos de tiempo necesarios son los timestamps técnicos de la sesión (`started_at` y `completed_at`) para identificar y ordenar históricamente las sesiones.

No mostrar ni utilizar estos tiempos como funcionalidad de entrenamiento.

---

# PWA

La aplicación debe ser una PWA funcional en Firefox para Android.

Debe incluir:

* Web App Manifest;
* Service Worker;
* cache de los assets necesarios;
* funcionamiento offline de la interfaz y del registro de una sesión;
* posibilidad de instalarla desde el navegador;
* diseño mobile-first;
* botones grandes;
* interfaz rápida y sencilla.

---

# Tecnología

Frontend:

* HTML, CSS y JavaScript vanilla.
* Sin React, Vue, Angular, Tailwind ni frameworks pesados.
* Se permite un build step mínimo si es útil (por ejemplo para inyectar el endpoint del Worker en tiempo de deploy).

Backend:

* Cloudflare Workers (único) para exponer la API hacia D1.
* Cloudflare D1 para persistencia histórica.
* Autenticación por secreto compartido en header.

No utilizar:

* KV;
* R2;
* APIs externas;
* cuentas de usuario o login real.

Usa tu mejor criterio para elegir librerías puntuales (por ejemplo, un helper mínimo de routing en el Worker si conviene). Justificar brevemente cualquier dependencia agregada.

---

# Diseño

Mantener el diseño extremadamente simple, pero prolijo.

Guías:

* estética limpia, mobile-first;
* botones grandes con **bordes redondeados**;
* paleta de **colores suaves** (por ejemplo tonos pastel o neutros), evitando colores estridentes;
* tipografía legible y bien espaciada;
* jerarquía visual clara: la serie actual y el botón `SIGUIENTE →` son los elementos más destacados;
* `COMPLETAR SESIÓN` visualmente diferenciado (por ejemplo, un color de acento distinto y ubicación separada) para evitar toques accidentales;
* transiciones suaves al avanzar de serie, sin animaciones excesivas.

Prioridad de la interfaz:

1. poder usarla rápidamente durante el entrenamiento;
2. saber inmediatamente qué tengo que hacer;
3. registrar peso y repeticiones rápidamente;
4. saber cuánto falta;
5. no tener que navegar por menús innecesarios.

No agregar funcionalidades que no fueron solicitadas.

---

# Repositorio y entorno local

* Crear un repositorio de GitHub llamado **`Workout-PWA`**, **público**.
* Clonar / inicializar el proyecto localmente en `C:\dev\git\Workout-PWA` (Windows).
* Estructura sugerida:

  ```
  Workout PWA/
    /pwa           # frontend (HTML/CSS/JS, manifest, service worker)
    /worker        # Cloudflare Worker + wrangler config
    /db            # migraciones SQL de D1
    README.md
  ```
* El repo debe incluir un `README.md` con instrucciones claras y reproducibles para:
  * crear la D1;
  * aplicar las migraciones (`schema.sql`);
  * configurar el secreto (`wrangler secret put APP_KEY`);
  * hacer deploy del Worker (`wrangler deploy`);
  * hacer deploy de la PWA en Cloudflare Pages;
  * apuntar la PWA al endpoint del Worker.

---

# Deployment

* GitHub como repositorio.
* Cloudflare Pages como deployment de la PWA.
* Cloudflare Worker para la API.
* Cloudflare D1 para la base de datos.

El agente tiene acceso a GitHub y a Cloudflare a través de Chrome Playwright y puede realizar las acciones necesarias en ambos (crear repo, crear D1, crear Worker, configurar secretos, hacer deploy). Puede pedirme confirmación antes de acciones destructivas o costosas.

---

# Criterios de aceptación

La aplicación debe cumplir como mínimo:

1. Puedo presionar `NUEVA SESIÓN` y comenzar desde Squat 1/3.
2. Puedo modificar el peso de cada serie en pasos de 0,5 kg.
3. Puedo modificar las repeticiones con `+` y `−`, partiendo del valor inicial del ejercicio (10 o 16).
4. Puedo avanzar a la siguiente serie con un único botón `SIGUIENTE →`, sin un botón separado "Completar Serie".
5. Puedo editar cualquier serie ya registrada en la sesión activa mediante un botón con ícono de lápiz.
6. Puedo ver el progreso `X/15`.
7. Completar las 15 series NO completa automáticamente la sesión.
8. La sesión solo termina cuando presiono `COMPLETAR SESIÓN`.
9. Una sesión en progreso sobrevive al cierre de Firefox.
10. Una sesión en progreso sobrevive al reinicio del teléfono.
11. Una sesión en progreso sigue abierta aunque pasen días.
12. La aplicación nunca inicia una sesión nueva automáticamente.
13. La aplicación nunca termina una sesión automáticamente.
14. La sincronización con D1 sólo ocurre al presionar `COMPLETAR SESIÓN`.
15. Cada sesión y cada serie tienen un UUID v4 generado en el cliente.
16. Un reintento de sincronización con los mismos UUIDs no genera duplicados en D1.
17. Una sesión completada se guarda correctamente en D1.
18. Cada serie queda almacenada individualmente con ejercicio, número de serie, peso y repeticiones.
19. El historial puede recuperarse desde D1 vía el Worker.
20. La pérdida temporal de conexión no hace perder una sesión activa ni bloquea el registro.
21. La aplicación funciona offline para el registro de una sesión completa.
22. El endpoint del Worker está protegido por un secreto compartido en header.
23. El "último peso usado" por ejercicio se toma del historial global (todas las sesiones completadas + serie previa de la sesión activa).
24. No existe ninguna funcionalidad relacionada con temporizadores o medición de tiempo de entrenamiento.
25. La estructura de datos permite implementar análisis históricos de performance posteriormente.

**Regla de diseño más importante: el usuario controla el estado de la sesión. La aplicación registra exactamente lo que el usuario le indica y no intenta inferir sus intenciones.**
