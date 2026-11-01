# Arbitration Agreement Builder

Herramienta web que arma una cláusula de arbitraje a partir de un cuestionario con lógica condicional. La construí durante una pasantía, entre julio y agosto de 2026; este repositorio se publicó el 1 de noviembre de 2026. El código, la especificación y los textos de las cláusulas pertenecen a quien encargó el proyecto, así que este repositorio describe el trabajo sin publicarlo.

## El problema

Redactar una cláusula de arbitraje es una cadena de decisiones: sede, número de árbitros, idioma, procedimiento abreviado según el monto en disputa. Cada respuesta incluye, omite o modifica fragmentos del texto. Si esas reglas viven dentro del código de la interfaz, un abogado no puede revisarlas ni cambiarlas sin un programador.

## Cómo está hecho

- **El contenido es dato, no código.** Un modelo declarativo en JSON guarda preguntas, opciones, condiciones, fragmentos de cláusula, parámetros y textos de la interfaz. Cambiar una redacción, una opción o una condición es editar el modelo, no el motor.
- **Un motor genérico.** El motor no sabe nada de ninguna institución arbitral: interpreta el modelo con un vocabulario cerrado de acciones (incluir u omitir un fragmento, fijar un parámetro, mostrar una advertencia), de condiciones (igual, distinto, dentro de una lista, contestada, todas o alguna, mayor o igual y menor que sobre valores numéricos) y de lugares donde va cada texto.
- **Validación antes de construir.** Un script valida el modelo contra su esquema y arma un prototipo estático con el modelo incrustado.
- **Pruebas golden.** Combinaciones canónicas de respuestas fijadas a su cláusula exacta. Un cambio de redacción tiene que romper la prueba: revisar esa diferencia es el paso de aprobación.
- **Estatus por fragmento.** Cada texto lleva su estado (definido, pendiente de aprobación, segunda fase, supuesto por confirmar) y un modo de revisión lo muestra encima de la página.
- **Privacidad.** La página es estática: lo que el visitante escribe no sale de su navegador, y la medición solo cuenta pasos del recorrido, nunca respuestas.

## En números

- Modelo de contenido v0.4: 14 preguntas, 16 fragmentos de cláusula, 4 advertencias y 2 modos.
- Motor v0.3: unas 870 líneas de JavaScript entre núcleo e interfaz, y un validador de esquema en Python.
- 45 comprobaciones golden en verde en la última versión.

## Mi papel

Implementé el modelo de contenido a partir de la especificación del proyecto, el motor, el validador y las pruebas, y llevé el registro de decisiones.

## Lo que no está aquí

No se publican el código, la especificación ni los textos de las cláusulas, porque no son míos. Tampoco se nombra a la firma ni a sus integrantes.
