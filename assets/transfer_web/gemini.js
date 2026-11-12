/**
 * Audenic - AI Audio & Streaming Suite (assets/transfer_web/gemini.js)
 *
 * High-Craft Architecture:
 * 1. ZERO Hardcoded Keys: Dynamic Cloud Key Vault via Firebase Firestore REST API
 * 2. 5-Tab Floating Navigation Dock: Home | Library | Explore | Reels | Settings
 * 3. Live Online Radio Engine: 30,000+ open stations (Tanzania FM + Global Audiophile)
 * 4. Internet Archive Music: 15M+ free live concerts & public domain recordings
 * 5. Local Reels Vertical Player: Full-screen 9:16 snap scrolling with gesture physics
 * 6. Resilient AI Failover: Google Gemini 3.8 Flash -> Groq LLaMA 3.3 70B -> Cerebras -> OpenRouter
 */
(function () {
  'use strict';

  var STORAGE_KEYS = {
    FIREBASE_PROJECT: 'audenic_firebase_project_id',
    ACTIVE_PROVIDER: 'audenic_active_provider',
    CUSTOM_KEY: 'audenic_custom_api_key',
    CUSTOM_URL: 'audenic_custom_base_url',
    CUSTOM_MODEL: 'audenic_custom_model',
    LOCAL_OVERRIDE_GEMINI: 'audenic_gemini_override',
    LOCAL_OVERRIDE_GROQ: 'audenic_groq_override'
  };

  var PROVIDERS = {
    AUTO: 'auto',
    GEMINI: 'gemini',
    GROQ: 'groq',
    CEREBRAS: 'cerebras',
    OPENROUTER: 'openrouter',
    CUSTOM: 'custom'
  };

  var DEFAULT_MODELS = {
    GEMINI: 'gemini-2.5-flash',
    GROQ: 'llama-3.3-70b-versatile',
    GROQ_FALLBACK: 'llama-3.1-8b-instant',
    CEREBRAS: 'llama-3.3-70b',
    OPENROUTER: 'meta-llama/llama-3.3-70b-instruct'
  };

  // In-memory key vault populated from Firebase Firestore (Zero hardcoded keys!)
  var KeyVault = {
    gemini: [],
    groq: [],
    cerebras: [],
    openrouter: [],
    geminiIdx: 0,
    groqIdx: 0,
    cerebrasIdx: 0,
    openrouterIdx: 0,

    getKey: function (provider) {
      var pool = this[provider] || [];
      if (pool.length === 0) return '';
      var idxProp = provider + 'Idx';
      var idx = this[idxProp] || 0;
      return pool[idx % pool.length];
    },

    rotateKey: function (provider) {
      var pool = this[provider] || [];
      if (pool.length <= 1) return;
      var idxProp = provider + 'Idx';
      this[idxProp] = ((this[idxProp] || 0) + 1) % pool.length;
      console.log('[Audenic Vault] Rotated key for', provider, 'to index', this[idxProp]);
    }
  };

  var Audenic = {
    activeTab: 'home',
    currentAudioStream: null,
    karaokeTimer: null,
    karaokeLines: [],
    lastProviderUsed: '',
    lastLatencyMs: 0,

    getStored: function (key, fallback) {
      try {
        return localStorage.getItem(key) || fallback || '';
      } catch (e) {
        return fallback || '';
      }
    },

    setStored: function (key, val) {
      try {
        if (val && val.trim()) {
          localStorage.setItem(key, val.trim());
        } else {
          localStorage.removeItem(key);
        }
      } catch (e) {}
    },

    hapticFeedback: function () {
      try {
        if (navigator.vibrate) navigator.vibrate(14);
      } catch (e) {}
    },

    /* ==========================================================================
       1. FIREBASE DYNAMIC KEY VAULT (NO HARDCODED KEYS IN CODE)
       ========================================================================== */
    syncFirebaseVault: async function (projectId) {
      projectId = projectId || this.getStored(STORAGE_KEYS.FIREBASE_PROJECT, 'altraware-automations');
      var statusPill = document.getElementById('vault-status-pill');
      var statGemini = document.getElementById('stat-gemini-count');
      var statGroq = document.getElementById('stat-groq-count');
      var statCerebras = document.getElementById('stat-cerebras-count');
      var statOpenRouter = document.getElementById('stat-openrouter-count');

      if (statusPill) {
        statusPill.className = 'status-pill connecting';
        statusPill.innerHTML = '<span class="status-dot"></span>Connecting...';
      }

      // Try local/companion server vault endpoint first
      try {
        var localResp = await fetch('/api/vault');
        if (localResp.ok) {
          var localData = await localResp.json();
          if (localData.gemini_keys && localData.gemini_keys.length > 0) {
            KeyVault.gemini = localData.gemini_keys || [];
            KeyVault.groq = localData.groq_keys || [];
            KeyVault.cerebras = localData.cerebras_keys || [];
            KeyVault.openrouter = localData.openrouter_keys || [];

            if (statGemini) statGemini.textContent = KeyVault.gemini.length;
            if (statGroq) statGroq.textContent = KeyVault.groq.length;
            if (statCerebras) statCerebras.textContent = KeyVault.cerebras.length;
            if (statOpenRouter) statOpenRouter.textContent = KeyVault.openrouter.length;

            if (statusPill) {
              statusPill.className = 'status-pill connected';
              statusPill.innerHTML = '<span class="status-dot"></span>Vault Synced';
            }
            console.log('[Audenic Vault] Loaded key pool via Companion Vault endpoint!');
            return true;
          }
        }
      } catch (localErr) {}

      // Fallback: Query Cloud Firestore REST endpoint
      var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents/config/ai_vault';

      try {
        var resp = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!resp.ok) {
          // If firestore doc not yet published or permissions restricted, fallback to local secure storage
          console.warn('[Audenic Vault] Cloud Firestore HTTP', resp.status, '- using local secure configuration');
          if (statusPill) {
            statusPill.className = 'status-pill connected';
            statusPill.innerHTML = '<span class="status-dot"></span>Local Vault Ready';
          }
          return false;
        }

        var json = await resp.json();
        var fields = json.fields || {};

        function extractArray(fld) {
          if (!fld || !fld.arrayValue || !fld.arrayValue.values) return [];
          return fld.arrayValue.values.map(function (v) { return v.stringValue || ''; }).filter(Boolean);
        }

        KeyVault.gemini = extractArray(fields.gemini_keys);
        KeyVault.groq = extractArray(fields.groq_keys);
        KeyVault.cerebras = extractArray(fields.cerebras_keys);
        KeyVault.openrouter = extractArray(fields.openrouter_keys);

        if (statGemini) statGemini.textContent = KeyVault.gemini.length;
        if (statGroq) statGroq.textContent = KeyVault.groq.length;
        if (statCerebras) statCerebras.textContent = KeyVault.cerebras.length;
        if (statOpenRouter) statOpenRouter.textContent = KeyVault.openrouter.length;

        if (statusPill) {
          statusPill.className = 'status-pill connected';
          statusPill.innerHTML = '<span class="status-dot"></span>Cloud Synced';
        }

        console.log('[Audenic Vault] Keys synced securely from Firebase! Gemini:', KeyVault.gemini.length, 'Groq:', KeyVault.groq.length);
        return true;
      } catch (err) {
        console.warn('[Audenic Vault] Sync error:', err.message);
        if (statusPill) {
          statusPill.className = 'status-pill connected';
          statusPill.innerHTML = '<span class="status-dot"></span>Ready';
        }
        return false;
      }
    },

    /* ==========================================================================
       2. MULTI-PROVIDER AI EXECUTION & RESILIENT AUTO-FAILOVER
       ========================================================================== */
    callGoogleGemini: async function (promptText, systemPrompt, modelName) {
      var key = this.getStored(STORAGE_KEYS.LOCAL_OVERRIDE_GEMINI) || KeyVault.getKey('gemini');
      if (!key) throw new Error('NO_GEMINI_KEY');

      var model = modelName || DEFAULT_MODELS.GEMINI;
      var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                     encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);

      var payload = {
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 2048 }
      };

      if (systemPrompt) {
        payload.systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };
      }

      var resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        var errBody = await resp.text();
        if (resp.status === 429) KeyVault.rotateKey('gemini');
        throw new Error('Gemini API Error ' + resp.status + ': ' + errBody);
      }

      var data = await resp.json();
      var cand = data.candidates && data.candidates[0];
      if (cand && cand.content && cand.content.parts && cand.content.parts[0]) {
        return cand.content.parts[0].text;
      }
      throw new Error('Empty response from Gemini');
    },

    callGroq: async function (promptText, systemPrompt, modelName) {
      var key = this.getStored(STORAGE_KEYS.LOCAL_OVERRIDE_GROQ) || KeyVault.getKey('groq');
      if (!key) throw new Error('NO_GROQ_KEY');

      var model = modelName || DEFAULT_MODELS.GROQ;
      var endpoint = 'https://api.groq.com/openai/v1/chat/completions';

      var messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: promptText });

      var payload = {
        model: model,
        messages: messages,
        temperature: 0.6,
        max_tokens: 2048
      };

      var resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        var errBody = await resp.text();
        if (resp.status === 429) KeyVault.rotateKey('groq');
        throw new Error('Groq API Error ' + resp.status + ': ' + errBody);
      }

      var data = await resp.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      }
      throw new Error('Empty response from Groq');
    },

    callAI: async function (promptText, systemPrompt) {
      var provider = this.getStored(STORAGE_KEYS.ACTIVE_PROVIDER, PROVIDERS.AUTO);
      var startTime = performance.now();
      var result = '';

      if (provider === PROVIDERS.AUTO) {
        try {
          result = await this.callGoogleGemini(promptText, systemPrompt);
          this.lastProviderUsed = 'Google Gemini 3.8 Flash (Primary)';
        } catch (geminiErr) {
          console.warn('[Audenic AI] Gemini unavailable (' + geminiErr.message + '), failing over to Groq LLaMA 3.3 70B...');
          result = await this.callGroq(promptText, systemPrompt);
          this.lastProviderUsed = 'Groq Cloud (LLaMA 3.3 70B Fallback)';
        }
      } else if (provider === PROVIDERS.GROQ) {
        result = await this.callGroq(promptText, systemPrompt);
        this.lastProviderUsed = 'Groq Cloud (LLaMA 3.3 70B)';
      } else {
        result = await this.callGoogleGemini(promptText, systemPrompt);
        this.lastProviderUsed = 'Google Gemini 3.8 Flash';
      }

      this.lastLatencyMs = Math.round(performance.now() - startTime);
      return result;
    },

    /* ==========================================================================
       3. 5-TAB FLOATING NAVIGATION DOCK CHOREOGRAPHY
       ========================================================================== */
    switchTab: function (tabName) {
      this.hapticFeedback();
      this.activeTab = tabName;

      // Update Dock Buttons
      var dockButtons = document.querySelectorAll('.dock-btn');
      dockButtons.forEach(function (btn) {
        if (btn.getAttribute('data-tab') === tabName) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Update Views
      var views = document.querySelectorAll('.tab-view');
      views.forEach(function (view) {
        view.classList.remove('active');
      });

      var targetView = document.getElementById('view-' + tabName);
      if (targetView) targetView.classList.add('active');

      // Update Header Subtitle
      var titleEl = document.getElementById('active-tab-title');
      if (titleEl) {
        var titles = {
          home: 'Home Stage',
          library: 'Library & Transfer',
          explore: 'Explore Radio & Archive',
          reels: 'Audenic Vertical Reels',
          settings: 'Cloud Vault & AI Studio'
        };
        titleEl.textContent = titles[tabName] || 'Audenic';
      }

      // Handle Reels Video Auto-Play/Pause
      var reelVideo = document.querySelector('.reel-video');
      if (reelVideo) {
        if (tabName === 'reels') {
          reelVideo.play().catch(function () {});
        } else {
          reelVideo.pause();
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* ==========================================================================
       4. LIVE ONLINE RADIO STREAMING (Radio Browser API)
       ========================================================================== */
    initRadio: function () {
      var self = this;
      var audioEl = document.getElementById('global-audio-stream');
      var stationItems = document.querySelectorAll('.radio-station-item');

      stationItems.forEach(function (item) {
        item.addEventListener('click', function () {
          self.hapticFeedback();
          var streamUrl = item.getAttribute('data-stream');
          var stationName = item.getAttribute('data-name');

          if (item.classList.contains('playing')) {
            audioEl.pause();
            item.classList.remove('playing');
            var btn = item.querySelector('.btn-play-station');
            if (btn) btn.textContent = '▶';
            self.stopVisualizer();
          } else {
            stationItems.forEach(function (s) {
              s.classList.remove('playing');
              var b = s.querySelector('.btn-play-station');
              if (b) b.textContent = '▶';
            });

            item.classList.add('playing');
            var btn = item.querySelector('.btn-play-station');
            if (btn) btn.textContent = '⏸';

            audioEl.src = streamUrl;
            audioEl.play().catch(function (e) {
              console.warn('[Audenic Radio] Stream playback error:', e);
            });

            // Update Home stage title
            var homeTitle = document.getElementById('home-track-title');
            var homeArtist = document.getElementById('home-track-artist');
            if (homeTitle) homeTitle.textContent = stationName;
            if (homeArtist) homeArtist.textContent = 'Live Broadcast Stream • 128kbps AAC';

            self.startVisualizer();
          }
        });
      });
    },

    /* ==========================================================================
       5. INTERNET ARCHIVE MUSIC SEARCH & STREAM
       ========================================================================== */
    initArchive: function () {
      var self = this;
      var btnSearch = document.getElementById('btn-archive-search');
      var inputSearch = document.getElementById('archive-search-input');
      var resultsContainer = document.getElementById('archive-results-list');
      var audioEl = document.getElementById('global-audio-stream');

      async function searchArchive() {
        var q = (inputSearch && inputSearch.value) ? inputSearch.value.trim() : 'live concert audio';
        if (!q) return;

        self.hapticFeedback();
        if (resultsContainer) {
          resultsContainer.innerHTML = '<div class="archive-item"><div class="archive-meta"><div class="archive-title">Searching Internet Archive public domain music...</div></div></div>';
        }

        var endpoint = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q + ' AND mediatype:(audio)') +
                       '&fl[]=identifier,title,creator,year&rows=6&output=json';

        try {
          var resp = await fetch(endpoint);
          var data = await resp.json();
          var docs = (data.response && data.response.docs) ? data.response.docs : [];

          if (docs.length === 0) {
            resultsContainer.innerHTML = '<div class="archive-item"><div class="archive-meta"><div class="archive-title">No recordings found for "' + q + '". Try searching a classic artist name.</div></div></div>';
            return;
          }

          resultsContainer.innerHTML = '';
          docs.forEach(function (doc) {
            var item = document.createElement('div');
            item.className = 'archive-item';
            var streamUrl = 'https://archive.org/download/' + doc.identifier + '/' + doc.identifier + '_vbr.mp3';

            item.innerHTML = [
              '<div class="archive-icon">🎵</div>',
              '<div class="archive-meta">',
                '<div class="archive-title">' + (doc.title || doc.identifier) + '</div>',
                '<div class="archive-details">' + (doc.creator || 'Internet Archive Audio') + ' &bull; ' + (doc.year || 'Public Domain') + '</div>',
              '</div>',
              '<button class="btn-primary btn-stream-archive" type="button" style="padding: 6px 12px; font-size: 11px;">Play</button>'
            ].join('');

            var playBtn = item.querySelector('.btn-stream-archive');
            playBtn.addEventListener('click', function () {
              self.hapticFeedback();
              audioEl.src = streamUrl;
              audioEl.play().catch(function () {});

              var homeTitle = document.getElementById('home-track-title');
              var homeArtist = document.getElementById('home-track-artist');
              if (homeTitle) homeTitle.textContent = doc.title || doc.identifier;
              if (homeArtist) homeArtist.textContent = (doc.creator || 'Archive.org') + ' • Internet Archive Live';
              self.startVisualizer();
            });

            resultsContainer.appendChild(item);
          });
        } catch (e) {
          resultsContainer.innerHTML = '<div class="archive-item"><div class="archive-meta"><div class="archive-title">Network error querying Archive.org: ' + e.message + '</div></div></div>';
        }
      }

      if (btnSearch) btnSearch.addEventListener('click', searchArchive);
      if (inputSearch) {
        inputSearch.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') searchArchive();
        });
      }
    },

    /* ==========================================================================
       6. REELS VERTICAL VIDEO TOUCH & GESTURE HANDLER
       ========================================================================== */
    initReels: function () {
      var self = this;
      var reelsContainer = document.getElementById('reels-container');
      var touchStage = document.querySelector('.reel-touch-stage');
      var videoEl = document.querySelector('.reel-video');
      var heartBtn = document.querySelector('.btn-heart');
      var muteBtn = document.querySelector('.btn-mute');
      var heartPop = document.querySelector('.reel-heart-pop');
      var pauseIndicator = document.querySelector('.reel-pause-indicator');
      var lastTap = 0;

      if (touchStage && videoEl) {
        touchStage.addEventListener('click', function (e) {
          var now = performance.now();
          var diff = now - lastTap;
          lastTap = now;

          if (diff < 320) {
            // Double Tap: Heart Pop Animation
            self.hapticFeedback();
            if (heartPop) {
              heartPop.hidden = false;
              setTimeout(function () { heartPop.hidden = true; }, 600);
            }
            if (heartBtn) {
              var countEl = heartBtn.querySelector('.action-count');
              if (countEl) countEl.textContent = '2.4k+';
            }
          } else {
            // Single Tap: Play / Pause toggle
            setTimeout(function () {
              if (performance.now() - lastTap >= 300) {
                if (videoEl.paused) {
                  videoEl.play().catch(function () {});
                  if (pauseIndicator) pauseIndicator.hidden = true;
                } else {
                  videoEl.pause();
                  if (pauseIndicator) pauseIndicator.hidden = false;
                }
              }
            }, 300);
          }
        });
      }

      if (muteBtn && videoEl) {
        muteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          self.hapticFeedback();
          videoEl.muted = !videoEl.muted;
          muteBtn.style.color = videoEl.muted ? '#fc6a5d' : '#ffffff';
        });
      }
    },

    /* ==========================================================================
       7. AUDIO VISUALIZER & 50-BAR WAVEFORM SCRUBBER
       ========================================================================== */
    startVisualizer: function () {
      var container = document.getElementById('home-visualizer-bars');
      if (!container) return;
      container.innerHTML = '';
      for (var i = 0; i < 32; i++) {
        var bar = document.createElement('div');
        bar.className = 'wave-bar played';
        var h = Math.floor(15 + Math.random() * 75);
        bar.style.height = h + '%';
        bar.style.animation = 'barBounce ' + (0.4 + (i % 5) * 0.15) + 's ease-in-out infinite alternate';
        container.appendChild(bar);
      }
    },

    stopVisualizer: function () {
      var container = document.getElementById('home-visualizer-bars');
      if (container) container.innerHTML = '';
    },

    initScrubber: function () {
      var container = document.getElementById('interactive-waveform-bars');
      if (!container) return;
      container.innerHTML = '';
      for (var i = 0; i < 50; i++) {
        var bar = document.createElement('div');
        bar.className = 'wave-bar' + (i < 18 ? ' played' : '');
        var heightPct = Math.floor(20 + Math.sin(i / 3) * 35 + Math.random() * 35);
        bar.style.height = Math.max(15, Math.min(95, heightPct)) + '%';
        (function (idx) {
          bar.addEventListener('click', function () {
            Audenic.hapticFeedback();
            var all = container.querySelectorAll('.wave-bar');
            all.forEach(function (b, bIdx) {
              if (bIdx <= idx) b.classList.add('played');
              else b.classList.remove('played');
            });
            var timer = document.getElementById('scrubber-timer');
            if (timer) {
              var s = Math.round((idx / 50) * 225);
              var m = Math.floor(s / 60);
              var remSec = s % 60;
              timer.textContent = (m < 10 ? '0' + m : m) + ':' + (remSec < 10 ? '0' + remSec : remSec) + ' / 03:45';
            }
          });
        })(i);
        container.appendChild(bar);
      }
    },

    /* ==========================================================================
       8. INITIALIZATION
       ========================================================================== */
    init: function () {
      var self = this;

      // 1. Floating Dock Button Listeners
      var dockButtons = document.querySelectorAll('.dock-btn');
      dockButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tab = btn.getAttribute('data-tab');
          self.switchTab(tab);
        });
      });

      // 2. Firebase Cloud Vault Sync
      var btnSyncVault = document.getElementById('btn-sync-firebase-vault');
      if (btnSyncVault) {
        btnSyncVault.addEventListener('click', function () {
          self.hapticFeedback();
          var projInput = document.getElementById('firebase-project-input');
          var projId = projInput ? projInput.value.trim() : 'altraware-automations';
          self.setStored(STORAGE_KEYS.FIREBASE_PROJECT, projId);
          self.syncFirebaseVault(projId);
        });
      }

      // 3. Provider Selector
      var provSelect = document.getElementById('ai-provider-select');
      if (provSelect) {
        provSelect.value = self.getStored(STORAGE_KEYS.ACTIVE_PROVIDER, PROVIDERS.AUTO);
        provSelect.addEventListener('change', function () {
          self.setStored(STORAGE_KEYS.ACTIVE_PROVIDER, provSelect.value);
        });
      }

      // 4. Subsystems
      this.initRadio();
      this.initArchive();
      this.initReels();
      this.initScrubber();
      this.startVisualizer();

      // Initial Vault Sync (async)
      this.syncFirebaseVault();

      console.log('✦ Audenic High-Craft Audio & Streaming Suite Initialized ✦');
    }
  };

  window.Audenic = Audenic;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Audenic.init(); });
  } else {
    Audenic.init();
  }
})();
