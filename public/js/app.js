/**
 * app.js
 * KesitAl Studio — Ana Uygulama Orkestratörü
 * Anti-AI-Slop, Sıfır Emoji, Profesyonel macOS Klavye Kısayolları ve Reaktif Durum Yönetimi.
 */

import { formatTime, parseTime, formatDurationHuman, clamp } from './timeUtils.js';
import { PlayerAdapter } from './PlayerAdapter.js';
import { TimelineScrubber } from './TimelineScrubber.js';

class KesitAlApp {
  constructor() {
    this.currentVideo = null;
    this.trimRange = {
      startSeconds: 0,
      endSeconds: 0
    };

    this.player = new PlayerAdapter();
    this.scrubber = null;

    this.activeJobId = null;
    this.activeEventSource = null;
    this.activePollingTimer = null;
    this.lastOutputFile = null;

    this.isPlayingPreview = false;
    this.heartbeatTimer = null;
    this.isServerShutdown = false;

    this._cacheDOM();
    this._bindEvents();
    this._initScrubber();
    this._startHeartbeat();
    this._bindKeyboardShortcuts();
  }

  /**
   * DOM element referanslarını önbelleğe alır.
   * Kesin ID listesi ve geriye dönük güvenli fallback yapısı.
   * @private
   */
  _cacheDOM() {
    // Header & Sistem Durumu
    this.serverStatusPill = document.getElementById('serverStatusPill');
    this.statusDot = document.getElementById('statusDot') || document.getElementById('serverStatusDot');
    this.statusText = document.getElementById('statusText') || document.getElementById('serverStatusText');
    this.shutdownServerBtn = document.getElementById('shutdownServerBtn');
    this.shutdownBanner = document.getElementById('shutdownBanner');

    // Komut Çubuğu & URL Formu
    this.urlForm = document.getElementById('urlForm') || document.getElementById('url-form');
    this.urlInput = document.getElementById('urlInput') || document.getElementById('video-url-input');
    this.pasteBtn = document.getElementById('pasteBtn') || document.getElementById('btn-paste');
    this.loadVideoBtn = document.getElementById('loadVideoBtn') || document.getElementById('btn-inspect');

    // Bildirim ve Yükleme Panelleri
    this.inspectLoading = document.getElementById('inspectLoading') || document.getElementById('inspect-loading');
    this.errorBanner = document.getElementById('errorBanner') || document.getElementById('inspect-error');
    this.errorMessage = document.getElementById('errorMessage') || document.getElementById('inspect-error-msg');
    this.closeErrorBtn = document.getElementById('closeErrorBtn') || document.getElementById('btn-close-inspect-error');

    // Sahne & Çalışma Alanı
    this.emptyStagePlaceholder = document.getElementById('emptyStagePlaceholder');
    this.workspaceSection = document.getElementById('workspaceSection') || document.getElementById('section-workspace');
    this.exportSection = document.getElementById('exportSection') || document.getElementById('section-download');

    // Video Üst Şerit
    this.videoTitle = document.getElementById('videoTitle') || document.getElementById('video-title');
    this.videoPlatformBadge = document.getElementById('videoPlatformBadge') || document.getElementById('meta-platform-pill');
    this.videoDurationBadge = document.getElementById('videoDurationBadge') || document.getElementById('meta-duration-pill');
    this.playerContainer = document.getElementById('playerContainer') || document.getElementById('player-container');
    this.timelineMount = document.getElementById('timelineMount') || document.getElementById('timeline-mount');

    // GİRİŞ / ÇIKIŞ Zaman Kontrolleri
    this.startTimeInput = document.getElementById('startTimeInput') || document.getElementById('input-start-time');
    this.endTimeInput = document.getElementById('endTimeInput') || document.getElementById('input-end-time');
    this.startMinusBtn = document.getElementById('startMinusBtn') || document.getElementById('btn-start-minus');
    this.startPlusBtn = document.getElementById('startPlusBtn') || document.getElementById('btn-start-plus');
    this.endMinusBtn = document.getElementById('endMinusBtn') || document.getElementById('btn-end-minus');
    this.endPlusBtn = document.getElementById('endPlusBtn') || document.getElementById('btn-end-plus');
    this.setStartCurrentBtn = document.getElementById('setStartCurrentBtn') || document.getElementById('btn-set-start-here');
    this.setEndCurrentBtn = document.getElementById('setEndCurrentBtn') || document.getElementById('btn-set-end-here');

    // Önizleme & Döngü
    this.previewClipBtn = document.getElementById('previewClipBtn') || document.getElementById('btn-preview-clip');
    this.previewClipIcon = document.getElementById('previewClipIcon');
    this.previewClipLabel = document.getElementById('previewClipLabel');
    this.loopToggle = document.getElementById('loopToggle') || document.getElementById('chk-loop-clip');

    // Süre Metrikleri
    this.selectedRangeSummary = document.getElementById('selectedRangeSummary') || document.getElementById('summary-range-text');
    this.selectedDurationSummary = document.getElementById('selectedDurationSummary') || document.getElementById('summary-duration-text');

    // Dışa Aktar & İlerleme
    this.downloadClipBtn = document.getElementById('downloadClipBtn') || document.getElementById('btn-download-clip');
    this.downloadProgressArea = document.getElementById('downloadProgressArea') || document.getElementById('download-progress-box');
    this.progressStatusText = document.getElementById('progressStatusText') || document.getElementById('progress-status-msg');
    this.progressPercentText = document.getElementById('progressPercentText') || document.getElementById('progress-percent-text');
    this.progressBarFill = document.getElementById('progressBarFill') || document.getElementById('progress-bar-fill');

    // Başarı Kartı
    this.downloadSuccessCard = document.getElementById('downloadSuccessCard') || document.getElementById('download-success-box');
    this.savedFileName = document.getElementById('savedFileName') || document.getElementById('success-filename');
    this.revealInFinderBtn = document.getElementById('revealInFinderBtn') || document.getElementById('btn-reveal-finder');
  }

  /**
   * Scrubber bileşenini başlatır.
   * @private
   */
  _initScrubber() {
    this.scrubber = new TimelineScrubber(this.timelineMount, {
      minDuration: 0.5,
      onSeek: (seconds) => {
        if (this.player && this.player.isReady) {
          this.player.seekTo(seconds);
        }
      },
      onTrimChange: (range) => {
        this._applyTrimUpdate(range.startSeconds, range.endSeconds);
      },
      onTrimCommit: (range) => {
        this._applyTrimUpdate(range.startSeconds, range.endSeconds);
      }
    });
  }

  /**
   * UI dinleyicilerini bağlar.
   * @private
   */
  _bindEvents() {
    // Form Submit (Videoyu Yükle)
    if (this.urlForm) {
      this.urlForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleInspect();
      });
    }

    if (this.loadVideoBtn) {
      this.loadVideoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleInspect();
      });
    }

    // Pano Yapıştır Butonu
    if (this.pasteBtn) {
      this.pasteBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim()) {
            this.urlInput.value = text.trim();
            this.handleInspect();
          }
        } catch (err) {
          this.urlInput.focus();
          this.urlInput.select();
        }
      });
    }

    // Inputa yapıştırma anında otomatik inceleme
    if (this.urlInput) {
      this.urlInput.addEventListener('paste', () => {
        setTimeout(() => {
          if (this.urlInput.value.trim()) {
            this.handleInspect();
          }
        }, 50);
      });
    }

    // Hata Kapat Butonu
    if (this.closeErrorBtn) {
      this.closeErrorBtn.addEventListener('click', () => {
        this.errorBanner?.classList.add('hidden');
      });
    }

    // Sunucuyu Kapat Butonu
    if (this.shutdownServerBtn) {
      this.shutdownServerBtn.addEventListener('click', () => this.handleServerShutdown());
    }

    // Manuel Zaman Girişleri
    if (this.startTimeInput) {
      this.startTimeInput.addEventListener('change', () => this._handleManualTimeInput('start'));
    }
    if (this.endTimeInput) {
      this.endTimeInput.addEventListener('change', () => this._handleManualTimeInput('end'));
    }

    // Adım -0.5s / +0.5s Butonları
    this.startMinusBtn?.addEventListener('click', () => this._adjustTrim('start', -0.5));
    this.startPlusBtn?.addEventListener('click', () => this._adjustTrim('start', 0.5));
    this.endMinusBtn?.addEventListener('click', () => this._adjustTrim('end', -0.5));
    this.endPlusBtn?.addEventListener('click', () => this._adjustTrim('end', 0.5));

    // "Şu Anki Kareyi Ayarla" Butonları
    this.setStartCurrentBtn?.addEventListener('click', () => this.setInPoint());
    this.setEndCurrentBtn?.addEventListener('click', () => this.setOutPoint());

    // Kesiti Önizleme / Oynatma
    this.previewClipBtn?.addEventListener('click', () => this.togglePreviewClip());

    // MP4 İndirme Butonu
    this.downloadClipBtn?.addEventListener('click', () => this.startDownload());

    // Finder'da Göster Butonu
    this.revealInFinderBtn?.addEventListener('click', () => this.revealInFinder());

    // Oynatıcı Süre ve Durum Takibi
    this.player.onReady(() => {
      const actualDuration = this.player.getDuration();
      if (actualDuration && actualDuration > 0) {
        const prevDuration = this.currentVideo?.durationSeconds || 0;
        if (prevDuration <= 0 || Math.abs(prevDuration - actualDuration) > 0.1) {
          if (this.currentVideo) {
            this.currentVideo.durationSeconds = actualDuration;
          }
          if (this.videoDurationBadge) {
            this.videoDurationBadge.textContent = formatTime(actualDuration, false);
          }
          this.scrubber.setDuration(actualDuration, 0, actualDuration);
          this._applyTrimUpdate(0, actualDuration);
        }
      }
    });

    this.player.onTimeUpdate((currentTime) => {
      this.scrubber.setCurrentTime(currentTime);

      if (this.isPlayingPreview) {
        if (currentTime >= this.trimRange.endSeconds || currentTime < this.trimRange.startSeconds - 0.2) {
          const isLoop = this.loopToggle ? this.loopToggle.checked : true;
          if (isLoop) {
            this.player.seekTo(this.trimRange.startSeconds);
            this.player.play();
          } else {
            this.player.pause();
            this.player.seekTo(this.trimRange.startSeconds);
            this._setPreviewButtonState(false);
          }
        }
      }
    });

    this.player.onStateChange((state) => {
      if (state === 'paused' || state === 'ended') {
        const isLoop = this.loopToggle ? this.loopToggle.checked : true;
        if (!isLoop) {
          this._setPreviewButtonState(false);
        }
      }
    });

    this.player.onError((msg) => {
      this._showInspectError(msg);
    });
  }

  /**
   * macOS Stüdyo Klavye Kısayolları:
   * Space: Oynat / Durdur
   * I: Giriş Noktası (In Point)
   * O: Çıkış Noktası (Out Point)
   * @private
   */
  _bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Eğer kullanıcı bir input, textarea veya içerik düzenlenebilir alandaysa kısayolları yutma
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) {
        return;
      }

      // Video henüz yüklenmediyse kısayolları çalıştırma
      if (!this.currentVideo || !this.player.isReady) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        this.setInPoint();
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        this.setOutPoint();
      }
    });
  }

  setInPoint() {
    if (!this.player) return;
    const cur = this.player.getCurrentTime();
    if (cur < this.trimRange.endSeconds) {
      this.scrubber.setStartTime(cur);
    }
  }

  setOutPoint() {
    if (!this.player) return;
    const cur = this.player.getCurrentTime();
    if (cur > this.trimRange.startSeconds) {
      this.scrubber.setEndTime(cur);
    }
  }

  togglePlayPause() {
    if (this.player.isPlaying()) {
      this.player.pause();
      this._setPreviewButtonState(false);
    } else {
      this.player.play();
    }
  }

  /**
   * Video Bağlantısını Sunucuya Gönderip İnceler.
   */
  async handleInspect() {
    const url = this.urlInput.value.trim();
    if (!url) {
      this.urlInput.focus();
      return;
    }

    this._setInspectLoading(true);
    this._hideInspectError();

    try {
      const response = await fetch('/api/videos/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Sunucu hatası: ${response.status}`);
      }

      const videoData = await response.json();
      await this._onVideoLoaded(videoData);
    } catch (err) {
      console.error('Video inceleme hatası:', err);
      this._showInspectError(err.message || 'Video bilgileri alınamadı.');
    } finally {
      this._setInspectLoading(false);
    }
  }

  /**
   * Video başarıyla çözümlendiğinde arayüzü hazırlar.
   * @private
   */
  async _onVideoLoaded(videoData) {
    this.currentVideo = {
      ...videoData,
      url: videoData.url || this.urlInput.value.trim()
    };

    // Başlık ve meta rozetler
    if (this.videoTitle) this.videoTitle.textContent = videoData.title || 'Video Başlığı';
    if (this.videoPlatformBadge) this.videoPlatformBadge.textContent = (videoData.platform || 'VIDEO').toUpperCase();
    if (this.videoDurationBadge) this.videoDurationBadge.textContent = formatTime(videoData.durationSeconds || 0, false);

    // Boş sahneyi gizle, stüdyo konsolunu aç
    if (this.emptyStagePlaceholder) this.emptyStagePlaceholder.classList.add('hidden');
    if (this.workspaceSection) this.workspaceSection.classList.remove('hidden');
    if (this.exportSection) this.exportSection.classList.remove('hidden');

    // Scrubber'ı başlat
    const duration = videoData.durationSeconds || 60;
    this.scrubber.setDuration(duration, 0, duration);

    // Oynatıcıyı başlat
    try {
      await this.player.init(this.playerContainer, videoData);
    } catch (err) {
      console.warn('Oynatıcı başlatılırken uyarı:', err);
    }

    this.workspaceSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Kırpma aralığı senkronizasyonu
   * @private
   */
  _applyTrimUpdate(start, end) {
    this.trimRange.startSeconds = start;
    this.trimRange.endSeconds = end;

    if (document.activeElement !== this.startTimeInput && this.startTimeInput) {
      this.startTimeInput.value = formatTime(start, true);
    }
    if (document.activeElement !== this.endTimeInput && this.endTimeInput) {
      this.endTimeInput.value = formatTime(end, true);
    }

    const duration = Math.max(0, end - start);
    if (this.selectedRangeSummary) {
      this.selectedRangeSummary.textContent = `${formatTime(start, true)} → ${formatTime(end, true)}`;
    }
    if (this.selectedDurationSummary) {
      this.selectedDurationSummary.textContent = formatDurationHuman(duration);
    }
  }

  _handleManualTimeInput(type) {
    const isStart = type === 'start';
    const inputEl = isStart ? this.startTimeInput : this.endTimeInput;
    if (!inputEl) return;

    const parsed = parseTime(inputEl.value);
    if (parsed === null) {
      inputEl.value = formatTime(isStart ? this.trimRange.startSeconds : this.trimRange.endSeconds, true);
      return;
    }

    if (isStart) {
      this.scrubber.setStartTime(parsed);
      this.player.seekTo(parsed);
    } else {
      this.scrubber.setEndTime(parsed);
      this.player.seekTo(parsed);
    }
  }

  _adjustTrim(type, deltaSeconds) {
    if (type === 'start') {
      const newStart = clamp(this.trimRange.startSeconds + deltaSeconds, 0, this.trimRange.endSeconds - 0.2);
      this.scrubber.setStartTime(newStart);
      this.player.seekTo(newStart);
    } else {
      const maxDur = this.player.getDuration() || 999999;
      const newEnd = clamp(this.trimRange.endSeconds + deltaSeconds, this.trimRange.startSeconds + 0.2, maxDur);
      this.scrubber.setEndTime(newEnd);
      this.player.seekTo(newEnd);
    }
  }

  togglePreviewClip() {
    if (this.isPlayingPreview && this.player.isPlaying()) {
      this.player.pause();
      this._setPreviewButtonState(false);
    } else {
      this.isPlayingPreview = true;
      this._setPreviewButtonState(true);
      this.player.seekTo(this.trimRange.startSeconds);
      this.player.play();
    }
  }

  /**
   * Kesiti Önizle butonunun ikon ve metnini günceller (Sıfır emoji, saf SVG).
   * @private
   */
  _setPreviewButtonState(isPlaying) {
    this.isPlayingPreview = isPlaying;
    if (!this.previewClipBtn) return;

    const playSvg = `
      <svg class="ui-icon" id="previewClipIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="6 3 20 12 6 21 6 3"/>
      </svg>
    `;

    const pauseSvg = `
      <svg class="ui-icon" id="previewClipIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="10" y1="4" x2="10" y2="20"/>
        <line x1="14" y1="4" x2="14" y2="20"/>
      </svg>
    `;

    if (isPlaying) {
      this.previewClipBtn.innerHTML = `${pauseSvg}<span id="previewClipLabel">Durdur</span>`;
      this.previewClipBtn.classList.add('is-playing');
    } else {
      this.previewClipBtn.innerHTML = `${playSvg}<span id="previewClipLabel">Kesiti Önizle</span>`;
      this.previewClipBtn.classList.remove('is-playing');
    }
  }

  /**
   * MP4 İndirme Başlatma (SSE ve Polling destekli)
   */
  async startDownload() {
    if (!this.currentVideo) return;

    this._cleanupProgressListeners();

    if (this.downloadClipBtn) {
      this.downloadClipBtn.disabled = true;
      this.downloadClipBtn.style.opacity = '0.5';
    }

    if (this.downloadProgressArea) this.downloadProgressArea.classList.remove('hidden');
    if (this.downloadSuccessCard) this.downloadSuccessCard.classList.add('hidden');

    this._updateProgress(0, 'İndirme ve kesme görevi başlatılıyor...');

    try {
      const payload = {
        url: this.currentVideo?.url || this.urlInput.value.trim(),
        startTimeSeconds: this.trimRange.startSeconds,
        endTimeSeconds: this.trimRange.endSeconds,
        title: this.currentVideo?.title || 'video_clip'
      };

      const res = await fetch('/api/clips/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Sunucu hatası: ${res.status}`);
      }

      const jobData = await res.json();
      this.activeJobId = jobData.jobId;
      this._subscribeJobProgress(jobData.jobId);
    } catch (err) {
      console.error('İndirme başlatılamadı:', err);
      this._onDownloadFailed(err.message || 'İndirme işlemi başlatılamadı.');
    }
  }

  _subscribeJobProgress(jobId) {
    if (window.EventSource) {
      try {
        const sse = new EventSource(`/api/clips/progress/${jobId}`);
        this.activeEventSource = sse;

        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this._handleJobUpdate(data);
          } catch (e) {
            console.error('SSE JSON hatası:', e);
          }
        };

        sse.onerror = (err) => {
          sse.close();
          this.activeEventSource = null;
          this._startPollingJobProgress(jobId);
        };
        return;
      } catch (err) {
        console.warn('SSE başlatılamadı, polling modu:', err);
      }
    }

    this._startPollingJobProgress(jobId);
  }

  _startPollingJobProgress(jobId) {
    if (this.activePollingTimer) clearInterval(this.activePollingTimer);

    this.activePollingTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/clips/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        this._handleJobUpdate(data);
      } catch (e) {}
    }, 1000);
  }

  _handleJobUpdate(job) {
    if (!job) return;

    this._updateProgress(job.progressPercent || 0, job.statusMessage || 'İşleniyor...');

    if (job.status === 'completed') {
      this._cleanupProgressListeners();
      this._onDownloadCompleted(job);
    } else if (job.status === 'failed') {
      this._cleanupProgressListeners();
      this._onDownloadFailed(job.error || job.statusMessage || 'İşlem başarısız oldu.');
    }
  }

  _updateProgress(percent, message) {
    const clampedPct = Math.round(clamp(percent, 0, 100));
    if (this.progressBarFill) this.progressBarFill.style.width = `${clampedPct}%`;
    if (this.progressPercentText) this.progressPercentText.textContent = `%${clampedPct}`;
    if (this.progressStatusText) this.progressStatusText.textContent = message;
  }

  _onDownloadCompleted(job) {
    if (this.downloadProgressArea) this.downloadProgressArea.classList.add('hidden');
    if (this.downloadSuccessCard) this.downloadSuccessCard.classList.remove('hidden');

    this.lastOutputFile = job.outputFilePath;
    if (this.savedFileName) this.savedFileName.textContent = job.fileName || 'kesit.mp4';

    if (this.downloadClipBtn) {
      this.downloadClipBtn.disabled = false;
      this.downloadClipBtn.style.opacity = '1';
    }
  }

  _onDownloadFailed(errorMsg) {
    if (this.downloadProgressArea) this.downloadProgressArea.classList.add('hidden');
    this._showInspectError(errorMsg);

    if (this.downloadClipBtn) {
      this.downloadClipBtn.disabled = false;
      this.downloadClipBtn.style.opacity = '1';
    }
  }

  /**
   * İndirilen dosyayı Finder'da gösterir (Sıfır emoji, saf SVG).
   */
  async revealInFinder() {
    if (!this.lastOutputFile || !this.revealInFinderBtn) return;

    const originalHtml = this.revealInFinderBtn.innerHTML;
    try {
      this.revealInFinderBtn.innerHTML = `<span>Açılıyor...</span>`;
      const res = await fetch('/api/system/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: this.lastOutputFile })
      });

      if (res.ok) {
        this.revealInFinderBtn.innerHTML = `
          <svg class="ui-icon-sm text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
          <span>Finder'da Açıldı</span>
        `;
        setTimeout(() => {
          this.revealInFinderBtn.innerHTML = originalHtml;
        }, 2000);
      } else {
        throw new Error('Finder açılamadı');
      }
    } catch (err) {
      this.revealInFinderBtn.innerHTML = originalHtml;
    }
  }

  _cleanupProgressListeners() {
    if (this.activeEventSource) {
      this.activeEventSource.close();
      this.activeEventSource = null;
    }
    if (this.activePollingTimer) {
      clearInterval(this.activePollingTimer);
      this.activePollingTimer = null;
    }
  }

  _setInspectLoading(loading) {
    if (loading) {
      this.inspectLoading?.classList.remove('hidden');
      if (this.loadVideoBtn) this.loadVideoBtn.disabled = true;
      if (this.pasteBtn) this.pasteBtn.disabled = true;
    } else {
      this.inspectLoading?.classList.add('hidden');
      if (this.loadVideoBtn) this.loadVideoBtn.disabled = false;
      if (this.pasteBtn) this.pasteBtn.disabled = false;
    }
  }

  _showInspectError(msg) {
    if (this.errorMessage) this.errorMessage.textContent = msg;
    this.errorBanner?.classList.remove('hidden');
  }

  _hideInspectError() {
    this.errorBanner?.classList.add('hidden');
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      if (this.isServerShutdown) return;
      try {
        await fetch('/api/system/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {}
    }, 25000);
  }

  async handleServerShutdown() {
    if (this.isServerShutdown) return;

    const confirmed = confirm('Arka plan sunucusunu ve geçici önizleme dosyalarını tamamen kapatmak istiyor musunuz?');
    if (!confirmed) return;

    this.isServerShutdown = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.player) {
      try { this.player.pause(); } catch (e) {}
    }

    if (this.serverStatusPill) {
      this.serverStatusPill.className = 'status-indicator status-shutdown';
    }
    if (this.statusText) {
      this.statusText.textContent = 'Kapalı';
    }
    if (this.shutdownServerBtn) {
      this.shutdownServerBtn.disabled = true;
      this.shutdownServerBtn.style.opacity = '0.5';
    }
    if (this.shutdownBanner) {
      this.shutdownBanner.classList.remove('hidden');
      this.shutdownBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    try {
      await fetch('/api/system/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true
      });
    } catch (err) {}
  }
}

// Başlatma
document.addEventListener('DOMContentLoaded', () => {
  window.__kesitAlApp = new KesitAlApp();
});
