# Arbitration Agreement Builder

Herramienta web que arma una cláusula de arbitraje ICC a partir de un cuestionario con lógica condicional. La construí durante una pasantía, entre julio y agosto de 2026, y se publicó el 1 de noviembre de 2026, anonimizada: sin el nombre de la firma ni de sus integrantes.

## Cómo está hecho

- **El contenido es dato.** `content/builder_content_model.json` guarda preguntas, opciones, condiciones, fragmentos de cláusula, parámetros y textos de la interfaz. Cambiar una redacción, una opción o una condición es editar el modelo, no el motor.
- **Un motor genérico.** `src/engine_core.js` y `src/engine_ui.js` no saben nada de ninguna institución arbitral: interpretan el modelo con un vocabulario cerrado de acciones (`include_fragment`, `omit_fragment`, `set_param`, `show_advisory`, `none`), de condiciones (`equals`, `not_equals`, `in`, `answered`, `all_of`, `any_of`, `gte`, `lt`) y de lugares donde va cada texto (`replaces_base`, `paragraph_before`, `in_clause`, `paragraph_after`, `advisory`).
- **Validación antes de construir.** `scripts/build.py` valida el modelo contra su esquema (referencias, acciones, alcanzabilidad, paridad EN/DE) y arma `prototype/index.html` con el modelo incrustado tal cual.
- **Pruebas golden.** `tests/golden.spec.js` recorre en un navegador real combinaciones canónicas de respuestas y fija cada una a su cláusula exacta. Un cambio de redacción tiene que romperlas: revisar esa diferencia es el paso de aprobación.
- **Estatus por texto.** Cada fragmento lleva su estado (`settled_spec`, `signoff_required`, `phase2`, `assumption`, `tbd`) y el modo de revisión del prototipo lo muestra encima de la página.

## Probarlo

```
python3 scripts/build.py          # valida el modelo y regenera prototype/index.html
npm install                       # Playwright, para las pruebas
npx playwright install chromium
npm test                          # 45 comprobaciones golden
```

El prototipo también abre con doble clic en `prototype/index.html`, sin servidor. El CI corre la validación, comprueba que el prototipo esté al día y corre las pruebas en cada push.

## Lo que no está aquí

- La especificación del proyecto y la bitácora de decisiones de la firma no se publican. Los comentarios del código citan secciones (§) de esa especificación.
- Las decisiones de redacción de las cláusulas eran del dueño del proyecto; varios fragmentos siguen marcados `signoff_required` porque no se aprobaron para publicación. Los textos siguen las cláusulas modelo que publica la ICC; la herramienta no está afiliada a la ICC ni avalada por ella.
- Sin licencia de uso: el código se publica para leerse, no para reutilizarse.

## Cómo se hizo

Implementé el modelo de contenido a partir de la especificación, el motor, el validador y las pruebas, con asistencia de IA (Claude).
