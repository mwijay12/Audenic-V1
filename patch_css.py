DESLOP_CSS = """/* --------------------------------------------------------------------------
   Audenic AI Audio & Lyrics Studio (High-Craft AI Deslop Architecture)
   -------------------------------------------------------------------------- */

:root {
  --bg-main: #0b0e17;
  --bg-surface: #131826;
  --bg-elevated: #1a2238;
  --bg-active: #222d4a;
  --border-subtle: #202b44;
  --border-focus: #4deec8;
  --content-main: #f3f6f8;
  --content-soft: #9aa8c0;
  --content-muted: #5e6d87;
  --accent-cyan: #4deec8;
  --accent-blue: #2596ff;
  --status-ready: #4deec8;
  --status-err: #fc6a5d;
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* Header & Tabs */
.header {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  justify-content: center;
  padding: 16px 16px 8px;
  width: 100%;
}

.header-brand {
  display: flex;
  gap: 10px;
  align-items: center;
}

.nav-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-surface);
  padding: 4px;
  border-radius: 24px;
  border: 1px solid var(--border-subtle);
}

.nav-tab {
  background: transparent;
  color: var(--content-soft);
  border: none;
  padding: 6px 18px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.nav-tab:hover {
  color: var(--content-main);
}

.nav-tab.active {
  background: var(--bg-elevated);
  color: var(--accent-cyan);
  border: 1px solid rgba(77, 238, 200, 0.25);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

/* Master Card (R_outer = 16px, padding = 16px) */
.ai-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg-surface);
  border-radius: 16px;
  border: 1px solid var(--border-subtle);
  width: 100%;
  max-width: 620px;
  box-sizing: border-box;
}

.ai-header {
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 12px;
}

.ai-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.ai-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--content-main);
  margin: 0;
  text-wrap: balance;
}

.ai-subtitle {
  font-size: 12px;
  color: var(--content-soft);
  margin: 4px 0 0;
  text-wrap: pretty;
}

/* Status Pill */
.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.status-pill.ready {
  background: rgba(77, 238, 200, 0.12);
  color: var(--accent-cyan);
  border: 1px solid rgba(77, 238, 200, 0.25);
}

.status-pill.ready .status-dot {
  background: var(--accent-cyan);
  box-shadow: 0 0 6px var(--accent-cyan);
}

.status-pill.inactive {
  background: rgba(154, 168, 192, 0.1);
  color: var(--content-soft);
  border: 1px solid var(--border-subtle);
}

.status-pill.inactive .status-dot {
  background: var(--content-muted);
}

.status-pill.error {
  background: rgba(252, 106, 93, 0.12);
  color: var(--status-err);
  border: 1px solid rgba(252, 106, 93, 0.25);
}

.status-pill.error .status-dot {
  background: var(--status-err);
}

/* Provider Panel (Luminance shift: #1a2238, R = 12px, padding = 12px) */
.provider-panel {
  background: var(--bg-elevated);
  padding: 12px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border-subtle);
}

.provider-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.flex-grow {
  flex: 1;
}

.btn-align-bottom {
  align-self: flex-end;
}

.keys-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .keys-grid {
    grid-template-columns: 1fr;
  }
  .provider-row {
    flex-direction: column;
    align-items: stretch;
  }
}

.custom-panel {
  background: rgba(11, 14, 23, 0.4);
  padding: 10px;
  border-radius: 8px;
  border: 1px dashed var(--border-subtle);
}

.form-row-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

@media (max-width: 520px) {
  .form-row-3 {
    grid-template-columns: 1fr;
  }
}

/* Form Controls (R_inner = R_outer - padding = 12px - 8px = 4px) */
.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--content-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.label-link {
  color: var(--accent-cyan);
  text-decoration: none;
  font-size: 10px;
}

.label-link:hover {
  text-decoration: underline;
}

.ai-input,
.ai-select,
.ai-textarea {
  background: var(--bg-main);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--content-main);
  padding: 8px 12px;
  font-size: 13px;
  width: 100%;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
}

.ai-input:focus,
.ai-select:focus,
.ai-textarea:focus {
  border-color: var(--border-focus);
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 520px) {
  .form-row-2 {
    grid-template-columns: 1fr;
  }
}

/* Studio Sub-Navigation Tabs */
.studio-nav {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}

.studio-nav::-webkit-scrollbar {
  display: none;
}

.studio-subtab {
  background: var(--bg-elevated);
  border: 1px solid transparent;
  color: var(--content-soft);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}

.studio-subtab:hover {
  color: var(--content-main);
  background: var(--bg-active);
}

.studio-subtab.active {
  background: rgba(77, 238, 200, 0.1);
  color: var(--accent-cyan);
  border-color: rgba(77, 238, 200, 0.3);
}

/* Studio Forms */
.studio-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Buttons (px = 2.2 * py) */
.btn-primary {
  background: var(--accent-cyan);
  color: #0b0e17;
  border: none;
  border-radius: 4px;
  padding: 8px 18px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.22, 1, 0.36, 1);
  white-space: nowrap;
}

.btn-primary:hover {
  filter: brightness(1.1);
}

.btn-primary:active {
  transform: scale(0.98);
}

.btn-secondary {
  background: transparent;
  color: var(--content-main);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 8px 18px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.22, 1, 0.36, 1);
}

.btn-secondary:hover {
  background: var(--bg-elevated);
  border-color: var(--content-soft);
}

.btn-secondary:active {
  transform: scale(0.98);
}

.btn-action {
  background: var(--accent-cyan);
  color: #0b0e17;
  border: none;
  border-radius: 6px;
  padding: 12px 26px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  width: 100%;
  transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  margin-top: 4px;
}

.btn-action:hover {
  filter: brightness(1.08);
  box-shadow: 0 4px 16px rgba(77, 238, 200, 0.25);
}

.btn-action:active {
  transform: scale(0.985);
}

.btn-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  filter: grayscale(0.5);
}

/* Outputs & Results */
.output-container {
  background: var(--bg-elevated);
  border-radius: 8px;
  padding: 14px;
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.output-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.output-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--content-main);
}

.output-actions {
  display: flex;
  gap: 8px;
}

.microcopy {
  font-size: 11px;
  color: var(--content-soft);
  margin: 0;
  line-height: 1.4;
  text-wrap: pretty;
}

/* Metrics & Tags Grid (Fluid 2-4 column) */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}

.metric-block {
  background: var(--bg-main);
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-label {
  font-size: 10px;
  color: var(--content-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.metric-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--content-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-value.highlight {
  color: var(--accent-cyan);
}

.metric-summary {
  font-size: 12px;
  color: var(--content-soft);
  margin: 0;
  line-height: 1.45;
}

.metric-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  background: var(--bg-main);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  color: var(--content-soft);
}

/* Playlist List */
.playlist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 280px;
  overflow-y: auto;
}

.playlist-track-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  background: var(--bg-main);
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
}

.track-num {
  font-size: 11px;
  color: var(--content-muted);
  width: 20px;
  text-align: center;
  font-weight: 600;
}

.track-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.track-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--content-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-artist {
  font-size: 11px;
  color: var(--content-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-mood {
  font-size: 10px;
  color: var(--accent-cyan);
  background: rgba(77, 238, 200, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Equalizer Visualizer */
.eq-visualizer-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  background: var(--bg-main);
  padding: 12px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  min-height: 120px;
}

.eq-band-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
}

.eq-db-label {
  font-size: 10px;
  color: var(--accent-cyan);
  font-weight: 600;
}

.eq-bar-track {
  flex: 1;
  width: 8px;
  background: var(--bg-surface);
  border-radius: 4px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
  min-height: 60px;
}

.eq-bar-fill {
  width: 100%;
  background: linear-gradient(to top, var(--accent-blue), var(--accent-cyan));
  border-radius: 4px;
  transition: height 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.eq-freq-label {
  font-size: 10px;
  color: var(--content-muted);
  font-weight: 600;
}

/* Radio DJ Speech Quote */
.dj-speech-quote {
  font-style: normal;
  font-size: 13px;
  line-height: 1.5;
  color: var(--content-main);
  background: var(--bg-main);
  padding: 12px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  margin: 0;
}

/* Karaoke Display */
.karaoke-box {
  background: var(--bg-main);
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  padding: 14px;
  max-height: 160px;
  overflow-y: auto;
  text-align: center;
  scroll-behavior: smooth;
}

.karaoke-line {
  margin: 8px 0;
  font-size: 13px;
  color: var(--content-muted);
  transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.karaoke-line.active {
  color: var(--accent-cyan);
  font-size: 16px;
  font-weight: 700;
  text-shadow: 0 0 12px rgba(77, 238, 200, 0.4);
}
"""

with open(r"C:\Users\Administrator\Desktop\LARK\assets\transfer_web\app.css", "r", encoding="utf-8") as fp:
    orig = fp.read()

idx = orig.find("/* --------------------------------------------------------------------------\n   Gemini AI Audio & Lyrics Studio")
if idx == -1:
    idx = orig.find("Gemini AI Audio & Lyrics Studio")
    if idx != -1:
        # find line start
        idx = orig.rfind("/*", 0, idx)

if idx != -1:
    base_css = orig[:idx].rstrip() + "\n\n"
    new_css = base_css + DESLOP_CSS
    with open(r"C:\Users\Administrator\Desktop\LARK\assets\transfer_web\app.css", "w", encoding="utf-8") as fp:
        fp.write(new_css)
    print("Successfully replaced studio CSS with Deslop Architecture! New length:", len(new_css))
else:
    print("Could not find insertion marker in app.css!")
