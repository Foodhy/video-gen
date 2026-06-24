import { useEffect, useState } from "react";
import { useEditor, FX_PRESETS, type Asset } from "../state/editor.ts";
import { separateAudio, transcribe, translateLines, getCapabilities } from "../lib/api.ts";
import { tc, bytes } from "../lib/format.ts";

const LANGS = [
  ["auto", "Auto-detect"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["zh", "Chinese"],
];

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="detail-row">
      <span className="k">{k}</span>
      <span className={"v" + (mono ? " mono" : "")}>{v}</span>
    </div>
  );
}

export default function Details() {
  const [busy, setBusy] = useState(false);
  const [txBusy, setTxBusy] = useState(false);
  const [trBusy, setTrBusy] = useState(false);
  const [lang, setLang] = useState("auto");
  const [target, setTarget] = useState("es");
  const [canTx, setCanTx] = useState(false);
  const [canTr, setCanTr] = useState(false);
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const segments = useEditor((s) => s.segments);
  const selSeg = useEditor((s) => s.selectedSegmentId);
  const selAsset = useEditor((s) => s.selectedAssetId);
  const addAsset = useEditor((s) => s.addAsset);
  const addSegmentForAsset = useEditor((s) => s.addSegmentForAsset);
  const setCaptions = useEditor((s) => s.setCaptions);
  const captions = useEditor((s) => s.captions);
  const captionLang = useEditor((s) => s.captionLang);
  const updateCaptionText = useEditor((s) => s.updateCaptionText);
  const clearCaptions = useEditor((s) => s.clearCaptions);
  const setFade = useEditor((s) => s.setFade);
  const setSpeed = useEditor((s) => s.setSpeed);
  const setFx = useEditor((s) => s.setFx);
  const clearFx = useEditor((s) => s.clearFx);
  const applyFxPreset = useEditor((s) => s.applyFxPreset);
  const setOverlayTransform = useEditor((s) => s.setOverlayTransform);
  const texts = useEditor((s) => s.texts);
  const selectedTextId = useEditor((s) => s.selectedTextId);
  const updateText = useEditor((s) => s.updateText);
  const deleteText = useEditor((s) => s.deleteText);
  const selText = texts.find((t) => t.id === selectedTextId);
  const textComponents = useEditor((s) => s.textComponents);
  const selectedComponentId = useEditor((s) => s.selectedComponentId);
  const updateTextComponent = useEditor((s) => s.updateTextComponent);
  const toggleTextLock = useEditor((s) => s.toggleTextLock);
  const deleteTextComponent = useEditor((s) => s.deleteTextComponent);
  const addTextChild = useEditor((s) => s.addTextChild);
  const playhead = useEditor((s) => s.playhead);
  const selComp = textComponents.find((c) => c.id === selectedComponentId);
  const showToast = useEditor((s) => s.showToast);

  useEffect(() => {
    getCapabilities().then((c) => {
      setCanTx(c.transcribe);
      setCanTr(c.translate);
    });
  }, []);

  // Prefer the selected timeline segment's asset, else the library selection.
  const seg = segments.find((s) => s.id === selSeg);
  const asset: Asset | undefined = seg ? assets[seg.clipId] : selAsset ? assets[selAsset] : undefined;

  async function onSeparate() {
    if (!asset || !projectId) return;
    setBusy(true);
    try {
      showToast("Separating audio…");
      const res = await separateAudio(projectId, asset.id);
      const a: Asset = { ...res.clip, mediaUrl: res.mediaUrl, thumbs: [] };
      addAsset(a);
      addSegmentForAsset(a.id);
      showToast("Audio track created");
    } catch (e: any) {
      showToast(e.message ?? "separate failed", true);
    } finally {
      setBusy(false);
    }
  }

  async function runTranscribe(translate: boolean) {
    if (!asset || !projectId) return;
    setTxBusy(true);
    try {
      showToast(translate ? "Transcribing + translating to English…" : "Transcribing…");
      const res = await transcribe(projectId, asset.id, {
        language: lang,
        translate,
      });
      setCaptions(asset.id, res.captions, res.language);
      showToast(`${res.captions.length} subtitle lines (${res.language})`);
    } catch (e: any) {
      showToast(e.message ?? "transcribe failed", true);
    } finally {
      setTxBusy(false);
    }
  }

  async function runTranslate() {
    if (!asset) return;
    const caps = captions[asset.id];
    if (!caps?.length) return;
    const from = captionLang[asset.id] ?? "en";
    if (from === target) {
      showToast("Captions already in that language");
      return;
    }
    setTrBusy(true);
    try {
      showToast(`Translating ${from} → ${target}… (first run downloads a model)`);
      const out = await translateLines(from, target, caps.map((c) => c.text));
      setCaptions(
        asset.id,
        caps.map((c, i) => ({ start: c.start, end: c.end, text: out[i] ?? c.text })),
        target,
      );
      showToast(`Translated to ${target}`);
    } catch (e: any) {
      showToast(e.message ?? "translate failed", true);
    } finally {
      setTrBusy(false);
    }
  }

  return (
    <aside className="panel details">
      <div className="panel-head">
        <span className="label">Details — {asset ? asset.kind : "Inspector"}</span>
      </div>
      <div className="panel-body">
        {selComp ? (
          <div className="text-edit-panel">
            <span className="label">Text component — {selComp.name}</span>
            <input
              className="select-line"
              value={selComp.name}
              onFocus={() => useEditor.getState().record()}
              onChange={(e) => updateTextComponent(selComp.id, { name: e.target.value })}
            />
            <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Placeholder text (does not change children):
            </span>
            <textarea
              className="text-edit-area"
              rows={2}
              value={selComp.text}
              onFocus={() => useEditor.getState().record()}
              onChange={(e) => updateTextComponent(selComp.id, { text: e.target.value })}
            />
            <div className="fade-row">
              <label>
                <span>Size {selComp.locks.size ? "🔒" : ""}</span>
                <input
                  type="number"
                  min={8}
                  max={400}
                  step={2}
                  value={selComp.size}
                  onChange={(e) => updateTextComponent(selComp.id, { size: Number(e.target.value) })}
                />
              </label>
              <label>
                <span>Color {selComp.locks.color ? "🔒" : ""}</span>
                <input
                  type="color"
                  value={selComp.color}
                  onChange={(e) => updateTextComponent(selComp.id, { color: e.target.value })}
                />
              </label>
            </div>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Locked props stay per-child; unlocked props propagate to all children.
            </span>
            <div className="fade-row">
              <button
                className={"fx-preset" + (selComp.locks.size ? " on" : "")}
                onClick={() => toggleTextLock(selComp.id, "size")}
              >
                {selComp.locks.size ? "🔒 Size" : "🔓 Size"}
              </button>
              <button
                className={"fx-preset" + (selComp.locks.color ? " on" : "")}
                onClick={() => toggleTextLock(selComp.id, "color")}
              >
                {selComp.locks.color ? "🔒 Color" : "🔓 Color"}
              </button>
            </div>
            <div className="detail-actions">
              <button className="btn-line" onClick={() => addTextChild(selComp.id, playhead)}>
                ＋ Place child at playhead
              </button>
              <button
                className="btn-line"
                onClick={() => deleteTextComponent(selComp.id)}
                style={{ borderColor: "#b04a4a", color: "#e08a8a" }}
              >
                🗑 Delete component
              </button>
            </div>
          </div>
        ) : selText ? (
          <div className="text-edit-panel">
            <span className="label">
              Text — {selText.componentId ? "child (of a component)" : "overlay"}
            </span>
            <textarea
              className="text-edit-area"
              value={selText.text}
              rows={2}
              onFocus={() => useEditor.getState().record()}
              onChange={(e) => updateText(selText.id, { text: e.target.value })}
            />
            <div className="fade-row">
              <label>
                <span>Start (s)</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={+selText.start.toFixed(2)}
                  onChange={(e) => updateText(selText.id, { start: Number(e.target.value) })}
                />
              </label>
              <label>
                <span>End (s)</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={+selText.end.toFixed(2)}
                  onChange={(e) => updateText(selText.id, { end: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="fade-row">
              <label>
                <span>Size</span>
                <input
                  type="number"
                  min={8}
                  max={400}
                  step={2}
                  value={selText.size}
                  onChange={(e) => updateText(selText.id, { size: Number(e.target.value) })}
                />
              </label>
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={selText.color}
                  onChange={(e) => updateText(selText.id, { color: e.target.value })}
                />
              </label>
            </div>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Drag on the player to position.
            </span>
            <div className="detail-actions">
              <button
                className="btn-line"
                onClick={() => deleteText(selText.id)}
                style={{ borderColor: "#b04a4a", color: "#e08a8a" }}
              >
                🗑 Delete Text
              </button>
            </div>
          </div>
        ) : !asset ? (
          <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
            Select a clip in the library or a segment on the timeline to inspect it.
          </p>
        ) : (
          <>
            <Row k="Name" v={asset.name} />
            <Row k="Kind" v={asset.kind} />
            <Row k="Duration" v={tc(asset.duration)} mono />
            {asset.width ? (
              <Row k="Resolution" v={`${asset.width}×${asset.height}`} mono />
            ) : null}
            {asset.fps ? <Row k="Frame rate" v={`${asset.fps} fps`} mono /> : null}
            {asset.vcodec ? <Row k="Video codec" v={asset.vcodec} /> : null}
            {asset.acodec ? <Row k="Audio codec" v={asset.acodec} /> : null}
            <Row k="Has audio" v={asset.hasAudio ? "yes" : "no"} />
            <Row k="Size" v={bytes(asset.size)} mono />

            {seg ? (
              <>
                <div style={{ height: 10 }} />
                <span className="label">Segment — trim</span>
                <Row k="In" v={tc(seg.in)} mono />
                <Row k="Out" v={tc(seg.out)} mono />
                <Row k="Length" v={tc(seg.out - seg.in)} mono />

                {seg.track === "overlay" ? (
                  <>
                    <div style={{ height: 8 }} />
                    <span className="label">Overlay — position &amp; size</span>
                    {(
                      [
                        ["X", "ox", 0, 1, 0.01, seg.ox ?? 0.5],
                        ["Y", "oy", 0, 1, 0.01, seg.oy ?? 0.5],
                        ["Scale", "oscale", 0.05, 1, 0.01, seg.oscale ?? 0.4],
                      ] as const
                    ).map(([label, key, min, max, step, val]) => (
                      <label key={key} className="fx-slider">
                        <span>
                          {label} <span className="mono">{(val as number).toFixed(2)}</span>
                        </span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={val as number}
                          onChange={(e) =>
                            setOverlayTransform(seg.id, { [key]: Number(e.target.value) })
                          }
                        />
                      </label>
                    ))}
                    <label className="fx-check">
                      <input
                        type="checkbox"
                        checked={!!seg.animate}
                        onChange={(e) => setOverlayTransform(seg.id, { animate: e.target.checked })}
                      />
                      Animate position (slide)
                    </label>
                    {seg.animate ? (
                      <>
                        {(
                          [
                            ["End X", "ox2", seg.ox2 ?? seg.ox ?? 0.5],
                            ["End Y", "oy2", seg.oy2 ?? seg.oy ?? 0.5],
                          ] as const
                        ).map(([label, key, val]) => (
                          <label key={key} className="fx-slider">
                            <span>
                              {label} <span className="mono">{(val as number).toFixed(2)}</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={val as number}
                              onChange={(e) =>
                                setOverlayTransform(seg.id, { [key]: Number(e.target.value) })
                              }
                            />
                          </label>
                        ))}
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          Slides from X/Y → End X/Y across the clip.
                        </span>
                      </>
                    ) : null}
                  </>
                ) : null}

                <div style={{ height: 8 }} />
                <span className="label">Speed — {(seg.speed ?? 1).toFixed(2)}×</span>
                <div className="fx-presets">
                  {[0.25, 0.5, 1, 1.5, 2, 4].map((v) => (
                    <button
                      key={v}
                      className={"fx-preset" + ((seg.speed ?? 1) === v ? " on" : "")}
                      onClick={() => setSpeed(seg.id, v)}
                    >
                      {v}×
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={seg.speed ?? 1}
                  onChange={(e) => setSpeed(seg.id, Number(e.target.value))}
                  style={{ width: "100%" }}
                />

                <div style={{ height: 8 }} />
                <span className="label">Transitions — fade (sec)</span>
                <div className="fade-row">
                  <label>
                    <span>Fade in ↗</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, seg.out - seg.in)}
                      step={0.1}
                      value={seg.fadeIn ?? 0}
                      onChange={(e) => setFade(seg.id, { fadeIn: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    <span>Fade out ↘</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, seg.out - seg.in)}
                      step={0.1}
                      value={seg.fadeOut ?? 0}
                      onChange={(e) => setFade(seg.id, { fadeOut: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  applies to video + audio
                </span>

                <div style={{ height: 8 }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="label">Effects</span>
                  <button className="cap-clear" onClick={() => clearFx(seg.id)} title="Reset effects">
                    reset
                  </button>
                </div>
                <div className="fx-presets">
                  {FX_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      className="fx-preset"
                      onClick={() => applyFxPreset(seg.id, p.fx)}
                      title={`Apply ${p.name} look`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                {(
                  [
                    ["Brightness", "brightness", -1, 1, 0.05, seg.fx?.brightness ?? 0],
                    ["Contrast", "contrast", 0, 2, 0.05, seg.fx?.contrast ?? 1],
                    ["Saturation", "saturation", 0, 2, 0.05, seg.fx?.saturation ?? 1],
                    ["Blur", "blur", 0, 20, 0.5, seg.fx?.blur ?? 0],
                  ] as const
                ).map(([label, key, min, max, step, val]) => (
                  <label key={key} className="fx-slider">
                    <span>
                      {label} <span className="mono">{(val as number).toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={val as number}
                      onChange={(e) => setFx(seg.id, { [key]: Number(e.target.value) })}
                    />
                  </label>
                ))}
                <label className="fx-check">
                  <input
                    type="checkbox"
                    checked={!!seg.fx?.grayscale}
                    onChange={(e) => setFx(seg.id, { grayscale: e.target.checked })}
                  />
                  Black &amp; white
                </label>
              </>
            ) : null}

            <div className="detail-actions">
              <button
                className="btn-line"
                onClick={onSeparate}
                disabled={busy || asset.kind !== "video" || !asset.hasAudio}
                title={
                  asset.kind !== "video"
                    ? "Audio-only asset"
                    : !asset.hasAudio
                      ? "No audio track in this clip"
                      : "Extract audio to its own track"
                }
              >
                {busy ? "Separating…" : "⎘ Separate Audio"}
              </button>
              <div style={{ height: 6 }} />
              <span className="label">Subtitles — whisper.cpp {canTx ? "" : "(model missing)"}</span>
              <select
                className="select-line"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                disabled={!canTx}
                title="Spoken language"
              >
                {LANGS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                className="btn-line"
                onClick={() => runTranscribe(false)}
                disabled={!canTx || txBusy || !asset.hasAudio}
                title={canTx ? "Transcribe in spoken language" : "Download a ggml model to models/"}
              >
                {txBusy ? "Working…" : "❝ Transcribe / Subtitles"}
              </button>
              <button
                className="btn-line"
                onClick={() => runTranscribe(true)}
                disabled={!canTx || txBusy || !asset.hasAudio}
                title="Transcribe and translate to English"
              >
                ⌘ Transcribe → English
              </button>
              {captions[asset.id]?.length ? (
                <>
                  <div style={{ height: 10 }} />
                  <span className="label">
                    Translate — {captionLang[asset.id] ?? "?"} → target {canTr ? "" : "(argos missing)"}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      className="select-line"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      disabled={!canTr}
                    >
                      {LANGS.filter(([v]) => v !== "auto").map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-line"
                      style={{ width: "auto", whiteSpace: "nowrap" }}
                      onClick={runTranslate}
                      disabled={!canTr || trBusy}
                    >
                      {trBusy ? "…" : "⌘ Translate"}
                    </button>
                  </div>

                  <div style={{ height: 10 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="label">Lines — {captions[asset.id].length} (editable)</span>
                    <button
                      className="cap-clear"
                      onClick={() => clearCaptions(asset.id)}
                      title="Remove captions"
                    >
                      clear
                    </button>
                  </div>
                  <div className="cap-list">
                    {captions[asset.id].map((c) => (
                      <input
                        key={c.id}
                        className="cap-edit"
                        value={c.text}
                        onFocus={() => useEditor.getState().record()}
                        onChange={(e) => updateCaptionText(asset.id, c.id, e.target.value)}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
