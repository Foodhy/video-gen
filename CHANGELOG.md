# Changelog

All notable changes to VIDEO—GEN are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-25

First tagged release. Fully local, CapCut-style Mac video editor — a Bun server
shells out to `ffmpeg` on native files; nothing leaves the machine.

### Added

- **Non-destructive EDL editor**: import, drag-reorder, split/trim with snapping.
- **Audio**: separate/extract/mute audio, multi audio lanes (A1/A2/A3…), live
  volume while playing, stem separation (demucs / spleeter — voz / batería /
  bajo / otros).
- **Transitions & effects**: fade in/out (video + audio), crossfade between
  clips, per-clip effects + color presets.
- **Overlays**: V2 overlay / picture-in-picture, text/title overlays with
  reusable text components.
- **Subtitles**: transcribe (whisper.cpp), translate (argostranslate), subtitle
  overlay + burn-in.
- **Export**: render timeline to MP4 via ffmpeg; choose save destination
  (Save As…), works in any webview via server-side copy.
- **UX**: undo/redo, resizable panels, in-app Console, project switcher.
- **Repo**: hero banner (`assets/hero.png`) built from real screenshots of the
  app's own UI.

### Notes

- Optional offline AI features degrade gracefully when their tools are absent
  (`/api/capabilities` reports `transcribe` / `translate` / `separate`).
- `drawtext` uses a hardcoded mac font (`TEXT_FONT` env to override).

[0.1.0]: https://github.com/Foodhy/video-gen/releases/tag/v0.1.0
