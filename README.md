<p align="center">
  <img src="assets/readme/banner.svg" alt="Piedra, papel o tijera: la máquina no pierde, nunca" width="100%">
</p>

<p align="center">
  <a href="https://mariourenagarcia.github.io/piedra-papel-tijera/">
    <img src="assets/readme/play.svg" alt="Jugar ahora" width="340">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/MediaPipe-Hands-ff1f3d?style=for-the-badge&labelColor=050102" alt="MediaPipe Hands">
  <img src="https://img.shields.io/badge/JavaScript-Vanilla-ff1f3d?style=for-the-badge&labelColor=050102&logo=javascript&logoColor=ff1f3d" alt="JavaScript">
  <img src="https://img.shields.io/badge/GitHub-Pages-ff1f3d?style=for-the-badge&labelColor=050102&logo=github&logoColor=ff1f3d" alt="GitHub Pages">
  <img src="https://img.shields.io/badge/Video-100%25%20local-ff1f3d?style=for-the-badge&labelColor=050102" alt="Video 100% local">
</p>

<p align="center">
  Juega piedra, papel o tijera con tu cámara contra una máquina que ve tu mano en tiempo real<br>
  y responde con la jugada ganadora antes de que alcances a notarlo.
</p>

<img src="assets/readme/divider.svg" width="100%" alt="">

## Cómo gana siempre

<p align="center">
  <img src="assets/readme/duel.svg" alt="Cuenta regresiva, detección del gesto y respuesta de la máquina" width="100%">
</p>

1. La cuenta regresiva dice **Piedra, Papel, Tijera, Ya!**
2. Al llegar a **Ya!** la máquina observa tu mano cuadro por cuadro.
3. En cuanto tu gesto se mantiene igual durante **3 cuadros seguidos**, elige la jugada que lo vence.

<p align="center">
  <img src="assets/readme/reaction.svg" alt="La máquina reacciona en unos 94 ms; una persona en unos 250 ms" width="100%">
</p>

Todo eso tarda alrededor de 100 ms. Una persona necesita más de 200 ms para notar un cambio, así que a simple vista parece que ambos jugaron al mismo tiempo.

<img src="assets/readme/divider.svg" width="100%" alt="">

## Cómo reconoce el gesto

<p align="center">
  <img src="assets/readme/gestures.svg" alt="Piedra: ningún dedo. Tijera: índice y medio. Papel: tres o cuatro dedos." width="100%">
</p>

[MediaPipe Hands](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) encuentra 21 puntos de la mano. Un dedo cuenta como estirado si su punta queda bastante más lejos de la muñeca que su nudillo medio. Medir distancias a la muñeca, en lugar de alturas, permite que funcione con la mano girada o de lado. El pulgar se ignora porque cada persona lo pone distinto y no cambia cuál de los tres gestos es.

| Dedos estirados (sin contar el pulgar) | Gesto      |
| :------------------------------------- | :--------- |
| Ninguno                                | **Piedra** |
| Índice y medio                         | **Tijera** |
| Tres o cuatro                          | **Papel**  |

<img src="assets/readme/divider.svg" width="100%" alt="">

## Controles

| Tecla     | Acción                  |
| :-------- | :---------------------- |
| `Espacio` | Jugar una ronda         |
| `A`       | Modo automático         |
| `R`       | Reiniciar marcador      |
| `M`       | Activar o quitar sonido |

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
assets/           favicon e imágenes de este README
```

## Ajustes

| Qué pasa                                          | Qué cambiar                          |
| :------------------------------------------------ | :----------------------------------- |
| Confunde gestos con dedos medio doblados          | Sube `EXTEND_RATIO` en `js/logic.js` |
| Responde antes de que termines de formar la mano  | Sube `STABLE_FRAMES` en `js/app.js`  |
| La cuenta regresiva va muy rápida o muy lenta     | Cambia `STEP_MS` en `js/app.js`      |

<img src="assets/readme/divider.svg" width="100%" alt="">

<p align="center">
  <a href="https://mariourenagarcia.github.io/piedra-papel-tijera/">
    <img src="assets/readme/play.svg" alt="Jugar ahora" width="280">
  </a>
</p>
