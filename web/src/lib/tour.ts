import { driver } from "driver.js";
import "driver.js/dist/driver.css";

// Guided onboarding tour over the main UI regions. Steps skip gracefully if a
// target element is not present (e.g. panels that only render with content).
export function startTour() {
  const steps = [
    {
      element: "[data-tour='projects']",
      popover: {
        title: "Proyectos",
        description: "Crea, cambia y abre proyectos. Todo se autoguarda localmente.",
      },
    },
    {
      element: "[data-tour='undo']",
      popover: { title: "Deshacer / Rehacer", description: "⌘Z / ⌘⇧Z. Cubre cortes, fades, efectos, textos." },
    },
    {
      element: ".btn-import",
      popover: {
        title: "Importar media",
        description: "Sube video/audio nativo del Mac. Aparece aquí y cae en el timeline. Click derecho en un clip para más acciones.",
      },
    },
    {
      element: ".player",
      popover: {
        title: "Reproductor",
        description: "Previsualiza. Controles: inicio ⏮, ±5s ⏪⏩, fin ⏭, play/pausa (espacio). Arrastra textos para colocarlos.",
      },
    },
    {
      element: ".details",
      popover: {
        title: "Detalles / Inspector",
        description: "Metadata del clip + Separar audio, Transcribir/Subtítulos, Traducir, fades, efectos, presets, overlay PiP.",
      },
    },
    {
      element: ".timeline",
      popover: {
        title: "Timeline",
        description: "Pistas V2 (overlay), V1 (video), A1 (audio). Arrastra para reordenar, bordes para recortar. Split, Snap 🧲, saltar a cortes con , / .",
      },
    },
    {
      element: "[data-tour='logs']",
      popover: { title: "Consola", description: "Logs de acciones, llamadas y errores — para depurar sin abrir DevTools." },
    },
    {
      element: "[data-tour='export']",
      popover: {
        title: "Exportar",
        description: "Renderiza el timeline a MP4 (cortes, fades, crossfade, efectos, overlay, texto, subtítulos quemados).",
      },
    },
  ];

  const d = driver({
    showProgress: true,
    nextBtnText: "Siguiente",
    prevBtnText: "Atrás",
    doneBtnText: "Listo",
    steps: steps.filter((s) => document.querySelector(s.element)),
  });
  d.drive();
}
