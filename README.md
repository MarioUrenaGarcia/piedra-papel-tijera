# Piedra / Papel / Tijera

Juego de piedra, papel o tijera contra una máquina que nunca pierde. Usa la cámara para ver tu mano en tiempo real y responde con la jugada ganadora antes de que alcances a notarlo.

Todo corre en el navegador: el video no sale de tu equipo.

## Cómo gana siempre

1. La cuenta regresiva dice **Piedra, Papel, Tijera, Ya!**
2. Al llegar a **Ya!** la máquina observa tu mano cuadro por cuadro.
3. En cuanto tu gesto se mantiene igual durante 3 cuadros seguidos, elige la jugada que lo vence.

Eso tarda alrededor de 100 ms. Una persona necesita más de 200 ms para notar un cambio, así que a simple vista parece que ambos jugaron al mismo tiempo.

## Cómo reconoce el gesto

[MediaPipe Hands](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) encuentra 21 puntos de la mano. Un dedo cuenta como estirado si su punta queda bastante más lejos de la muñeca que su nudillo medio:

| Dedos estirados (sin contar el pulgar) | Gesto  |
| -------------------------------------- | ------ |
| Ninguno                                | Piedra |
| Índice y medio                         | Tijera |
| Tres o cuatro                          | Papel  |

Medir distancias a la muñeca, en lugar de alturas, permite que funcione con la mano girada o de lado.

## Controles

| Tecla    | Acción                   |
| -------- | ------------------------ |
| Espacio  | Jugar una ronda          |
| A        | Modo automático          |
| R        | Reiniciar marcador       |
| M        | Activar o quitar sonido  |

## Correrlo en tu equipo

La cámara solo funciona en `https` o en `localhost`, así que abrir el archivo con doble clic no sirve. Levanta un servidor local en la carpeta del proyecto:

```bash
python -m http.server 5500
```

y abre `http://localhost:5500`.

## Publicarlo en GitHub Pages

1. Sube el repositorio a GitHub.
2. En **Settings > Pages**, elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
3. En un minuto queda publicado en `https://<tu-usuario>.github.io/<repositorio>/`.

No hay paso de compilación: son archivos estáticos.

## Estructura

```
index.html        estructura de la página e iconos SVG
css/styles.css    estilos
js/app.js         cámara, modelo, bucle del juego e interfaz
js/logic.js       clasificación del gesto y reglas, sin dependencias del navegador
assets/           favicon
```

## Ajustes

- Si confunde gestos con dedos medio doblados, sube `EXTEND_RATIO` en `js/logic.js`.
- Si responde antes de que termines de formar la mano, sube `STABLE_FRAMES` en `js/app.js`.
- La velocidad de la cuenta regresiva está en `STEP_MS`.
