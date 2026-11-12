MOTION_CSS = """/* --------------------------------------------------------------------------
   Premium Music Motion Choreography (Depth-of-Field Lyrics & Waveforms)
   -------------------------------------------------------------------------- */

/* Depth-of-Field Synced Lyrics Stage */
.karaoke-box {
  background: radial-gradient(circle at 50% 30%, rgba(37, 150, 255, 0.08), transparent 70%), var(--bg-main);
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  padding: 24px 16px;
  max-height: 200px;
  overflow-y: auto;
  text-align: center;
  scroll-behavior: smooth;
  perspective: 800px;
}

.karaoke-line {
  margin: 12px 0;
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  opacity: 0.25;
  filter: blur(1.8px);
  transform: scale(0.92);
  transform-origin: center center;
  cursor: pointer;
  transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              filter 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.45s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity, filter;
  text-wrap: balance;
}

.karaoke-line.near {
  opacity: 0.52;
  filter: blur(0.7px);
  transform: scale(0.97);
}

.karaoke-line.active {
  opacity: 1.0;
  filter: blur(0px);
  transform: scale(1.06);
  color: #ffffff;
  text-shadow: 0 0 16px rgba(77, 238, 200, 0.75), 0 0 32px rgba(77, 238, 200, 0.3);
}

/* Interactive Waveform Scrubber */
.waveform-stage {
  background: var(--bg-main);
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  padding: 12px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.waveform-bars {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  gap: 3px;
  cursor: pointer;
}

.wave-bar {
  flex: 1;
  max-width: 5px;
  min-width: 2.5px;
  border-radius: 3px;
  background: rgba(243, 246, 248, 0.16);
  transition: height 0.22s cubic-bezier(0.16, 1, 0.3, 1),
              background 0.15s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.wave-bar.played {
  background: linear-gradient(to top, var(--accent-blue), var(--accent-cyan));
  box-shadow: 0 0 8px rgba(77, 238, 200, 0.4);
}

.waveform-timecodes {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--content-soft);
}

.timecode-elapsed {
  color: var(--accent-cyan);
}
"""

with open(r"C:\Users\Administrator\Desktop\LARK\assets\transfer_web\app.css", "r", encoding="utf-8") as fp:
    css = fp.read()

marker = "/* Karaoke Display */"
idx = css.find(marker)
if idx != -1:
    new_css = css[:idx] + MOTION_CSS
    with open(r"C:\Users\Administrator\Desktop\LARK\assets\transfer_web\app.css", "w", encoding="utf-8") as fp:
        fp.write(new_css)
    print("Updated app.css with Premium Music Motion styles! New length:", len(new_css))
else:
    print("Marker not found!")
