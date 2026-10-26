/**
 * app.js
 * KesitAl — Ana Uygulama Orkestratörü
 * Arayüz etkileşimleri, PlayerAdapter, TimelineScrubber ve Backend API entegrasyonu.
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
  }

  /**
   * DOM element referanslarını önbelleğe alır.
   * @private
   */
  _cacheDOM() {
    // Header & Sistem Durumu
    this.serverStatusPill = document.getElementById('serverStatusPill');
    this.serverStatusDot = document.getElementById('serverStatusDot');
    this.serverStatusText = document.getElementById('serverStatusText');
    this.shutdownServerBtn = document.getElementById('shutdownServerBtn');
    this.shutdownBanner = document.getElementById('shutdownBanner');

    // Adım 1 Elemanları
    this.sectionInput = document.getElementById('section-input');
    this.urlForm = document.getElementById('url-form');
    this.urlInput = document.getElementById('video-url-input');
    this.btnPaste = document.getElementById('btn-paste');
    this.btnInspect = document.getElementById('btn-inspect');
    this.inspectLoading = document.getElementById('inspect-loading');
    this.inspectError = document.getElementById('inspect-error');
    this.inspectErrorMsg = document.getElementById('inspect-error-msg');
    this.btnCloseInspectError = document.getElementById('btn-close-inspect-error');

    // Adım 2 Elemanları
    this.sectionWorkspace = document.getElementById('section-workspace');
    this.videoTitle = document.getElementById('video-title');
    this.metaPlatformPill = document.getElementById('meta-platform-pill');
    this.metaDurationPill = document.getElementById('meta-duration-pill');
    this.playerContainer = document.getElementById('player-container');
    this.timelineMount = document.getElementById('timeline-mount');

    this.inputStartTime = document.getElementById('input-start-time');
    this.inputEndTime = document.getElementById('input-end-time');
    this.btnStartMinus = document.getElementById('btn-start-minus');
    this.btnStartPlus = document.getElementById('btn-start-plus');
    this.btnEndMinus = document.getElementById('btn-end-minus');
    this.btnEndPlus = document.getElementById('btn-end-plus');
    this.btnSetStartHere = document.getElementById('btn-set-start-here');
    this.btnSetEndHere = document.getElementById('btn-set-end-here');

    this.btnPreviewClip = document.getElementById('btn-preview-clip');
    this.chkLoopClip = document.getElementById('chk-loop-clip');

    // Adım 3 Elemanları
    this.sectionDownload = document.getElementById('section-download');
    this.summaryRangeText = document.getElementById('summary-range-text');
    this.summaryDurationText = document.getElementById('summary-duration-text');
    this.btnDownloadClip = document.getElementById('btn-download-clip');

    this.downloadProgressBox = document.getElementById('download-progress-box');
    this.progressStatusMsg = document.getElementById('progress-status-msg');
    this.progressPercentText = document.getElementById('progress-percent-text');
    this.progressBarFill = document.getElementById('progress-bar-fill');

    this.downloadSuccessBox = document.getElementById('download-success-box');
    this.successFilename = document.getElementById('success-filename');
    this.btnRevealFinder = document.getElementById('btn-reveal-finder');

    this.downloadErrorBox = document.getElementById('download-error-box');
    this.downloadErrorMsg = document.getElementById('download-error-msg');
    this.btnRetryDownload = document.getElementById('btn-retry-download');
  }

  /**
   * Scrubber bileşenini başlatır.
   * @private
   */
  _initScrubber() {
    this.scrubber = new TimelineScrubber(this.timelineMount, {
      minDuration: 0.5,
      // Kullanıcı tutamaçları sürüklerken anlık kare önizlemesi
      onSeek: (seconds) => {
        if (this.player && this.player.isReady) {
          this.player.seekTo(seconds);
        }
      },
      // Kırpma aralığı değiştikçe input ve özetleri senkronize et
      onTrimChange: (range) => {
        this._applyTrimUpdate(range.startSeconds, range.endSeconds);
      },
      onTrimCommit: (range) => {
        this._applyTrimUpdate(range.startSeconds, range.endSeconds);
      }
    });
  }

  /**
   * Tüm UI dinleyicilerini bağlar.
   * @private
   */
  _bindEvents() {
    // Form Submit (Videoyu Yükle)
    this.urlForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleInspect();
    });

    // Sunucuyu Kapat Butonu
    if (this.shutdownServerBtn) {
      this.shutdownServerBtn.addEventListener('click', () => this.handleServerShutdown());
    }

    // Pano Yapıştır Butonu
    this.btnPaste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          this.urlInput.value = text.trim();
          this.handleInspect();
        }
      } catch (err) {
        console.warn('Pano okunamadı, manuel yapıştırma bekleniyor.', err);
        this.urlInput.focus();
        this.urlInput.select();
      }
    });

    // Kullanıcı inputa manuel link yapıştırdığında otomatik inceleme
    this.urlInput.addEventListener('paste', () => {
      setTimeout(() => {
        if (this.urlInput.value.trim()) {
          this.handleInspect();
        }
      }, 50);
    });

    // Hata Kapat Butonu
    this.btnCloseInspectError.addEventListener('click', () => {
      this.inspectError.classList.add('hidden');
    });

    // Başlangıç / Bitiş Kutusundan Manuel Girişler
    this.inputStartTime.addEventListener('change', () => this._handleManualTimeInput('start'));
    this.inputEndTime.addEventListener('change', () => this._handleManualTimeInput('end'));

    // Hassas -0.5s / +0.5s Butonları
    this.btnStartMinus.addEventListener('click', () => this._adjustTrim('start', -0.5));
    this.btnStartPlus.addEventListener('click', () => this._adjustTrim('start', 0.5));
    this.btnEndMinus.addEventListener('click', () => this._adjustTrim('end', -0.5));
    this.btnEndPlus.addEventListener('click', () => this._adjustTrim('end', 0.5));

    // "Şu Anki Kareyi Ayarla" Butonları
    this.btnSetStartHere.addEventListener('click', () => {
      if (!this.player) return;
      const cur = this.player.getCurrentTime();
      if (cur < this.trimRange.endSeconds) {
        this.scrubber.setStartTime(cur);
      }
    });

    this.btnSetEndHere.addEventListener('click', () => {
      if (!this.player) return;
      const cur = this.player.getCurrentTime();
      if (cur > this.trimRange.startSeconds) {
        this.scrubber.setEndTime(cur);
      }
    });

    // Seçili Kesiti Önizleme / Oynatma
    this.btnPreviewClip.addEventListener('click', () => this.togglePreviewClip());

    // MP4 İndirme Butonu
    this.btnDownloadClip.addEventListener('click', () => this.startDownload());

    // Finder'da Göster Butonu
    this.btnRevealFinder.addEventListener('click', () => this.revealInFinder());

    // Hata Sonrası Tekrar Dene Butonu
    this.btnRetryDownload.addEventListener('click', () => this.startDownload());

    // Oynatıcı Hazır Olduğunda Süreyi Kesinleştir (Örn: Instagram Reels / ffprobe / loadedmetadata)
    this.player.onReady(() => {
      const actualDuration = this.player.getDuration();
      if (actualDuration && actualDuration > 0) {
        const prevDuration = this.currentVideo?.durationSeconds || 0;
        if (prevDuration <= 0 || Math.abs(prevDuration - actualDuration) > 0.1) {
          if (this.currentVideo) {
            this.currentVideo.durationSeconds = actualDuration;
          }
          this.metaDurationPill.textContent = formatTime(actualDuration, false);
          this.scrubber.setDuration(actualDuration, 0, actualDuration);
          this._applyTrimUpdate(0, actualDuration);
        }
      }
    });

    // Oynatıcı Süre Takibi
    this.player.onTimeUpdate((currentTime) => {
      this.scrubber.setCurrentTime(currentTime);

      // Seçili kesit oynatılırken veya döngü etkinken bitiş noktası kontrolü
      if (this.isPlayingPreview) {
        if (currentTime >= this.trimRange.endSeconds || currentTime < this.trimRange.startSeconds - 0.2) {
          if (this.chkLoopClip.checked) {
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
        if (!this.chkLoopClip.checked) {
          this._setPreviewButtonState(false);
        }
      }
    });

    this.player.onError((msg) => {
      this._showInspectError(msg);
    });
  }

  /**
   * Adım 1: Video Bağlantısını Sunucuya Gönderip İnceler.
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
    this.videoTitle.textContent = videoData.title || 'Video Başlığı';
    this.metaPlatformPill.textContent = (videoData.platform || 'Video').toUpperCase();
    this.metaDurationPill.textContent = formatTime(videoData.durationSeconds || 0, false);

    // Adım 2 ve Adım 3 kartlarını görünür yap
    this.sectionWorkspace.classList.remove('hidden');
    this.sectionDownload.classList.remove('hidden');

    // Scrubber'ı süresiyle başlat
    const duration = videoData.durationSeconds || 60;
    this.scrubber.setDuration(duration, 0, duration);

    // Oynatıcıyı başlat
    try {
      await this.player.init(this.playerContainer, videoData);
    } catch (err) {
      console.warn('Oynatıcı başlatılırken uyarı:', err);
    }

    // Pürüzsüzce çalışma alanına kaydır
    this.sectionWorkspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Kırpma aralığı güncellendiğinde inputları ve özet alanlarını senkronize eder.
   * @private
   */
  _applyTrimUpdate(start, end) {
    this.trimRange.startSeconds = start;
    this.trimRange.endSeconds = end;

    // İnput kutularını güncelle (eğer o anda aktif odaklanma yoksa)
    if (document.activeElement !== this.inputStartTime) {
      this.inputStartTime.value = formatTime(start, true);
    }
    if (document.activeElement !== this.inputEndTime) {
      this.inputEndTime.value = formatTime(end, true);
    }

    // Adım 3 Özet Metinleri
    const duration = Math.max(0, end - start);
    this.summaryRangeText.textContent = `${formatTime(start, true)} ➔ ${formatTime(end, true)}`;
    this.summaryDurationText.textContent = formatDurationHuman(duration);
  }

  /**
   * Başlangıç / Bitiş kutularına elle girilen değeri çözümler.
   * @private
   */
  _handleManualTimeInput(type) {
    const isStart = type === 'start';
    const inputEl = isStart ? this.inputStartTime : this.inputEndTime;
    const parsed = parseTime(inputEl.value);

    if (parsed === null) {
      // Geçersiz format: Eski değere geri dön
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

  /**
   * -0.5s / +0.5s butonlarıyla ince ayar yapar.
   * @private
   */
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

  /**
   * Seçili kesiti oynat / duraklat geçişi yapar.
   */
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

  _setPreviewButtonState(isPlaying) {
    this.isPlayingPreview = isPlaying;
    const icon = this.btnPreviewClip.querySelector('.btn-icon');
    const label = this.btnPreviewClip.querySelector('.btn-label');
    if (isPlaying) {
      icon.textContent = '⏸';
      label.textContent = 'Durdur';
      this.btnPreviewClip.classList.add('btn-preview-active');
    } else {
      icon.textContent = '▶';
      label.textContent = 'Seçili Kesiti Oynat';
      this.btnPreviewClip.classList.remove('btn-preview-active');
    }
  }

  /**
   * Adım 3: Kesit İndirme Başlatma (SSE veya Polling ile canlı takip)
   */
  async startDownload() {
    if (!this.currentVideo) return;

    // Önceki izleyicileri temizle
    this._cleanupProgressListeners();

    // UI hazırlığı
    this.btnDownloadClip.disabled = true;
    this.btnDownloadClip.style.opacity = '0.6';
    this.downloadProgressBox.classList.remove('hidden');
    this.downloadSuccessBox.classList.add('hidden');
    this.downloadErrorBox.classList.add('hidden');

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

      // İlerleme takibini başlat (SSE öncelikli)
      this._subscribeJobProgress(jobData.jobId);
    } catch (err) {
      console.error('İndirme başlatılamadı:', err);
      this._onDownloadFailed(err.message || 'İndirme işlemi başlatılamadı.');
    }
  }

  /**
   * SSE (Server-Sent Events) ile canlı indirme ilerlemesini dinler.
   * Desteklenmezse veya hata olursa otomatik polling'e geçer.
   * @private
   */
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
            console.error('SSE JSON parse hatası:', e);
          }
        };

        sse.onerror = (err) => {
          console.warn('SSE bağlantısı kesildi, Polling moduna geçiliyor...', err);
          sse.close();
          this.activeEventSource = null;
          this._startPollingJobProgress(jobId);
        };
        return;
      } catch (err) {
        console.warn('SSE başlatılamadı, Polling ile devam edilecek.', err);
      }
    }

    this._startPollingJobProgress(jobId);
  }

  /**
   * Fallback Polling mekanizması
   * @private
   */
  _startPollingJobProgress(jobId) {
    if (this.activePollingTimer) clearInterval(this.activePollingTimer);

    this.activePollingTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/clips/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        this._handleJobUpdate(data);
      } catch (e) {
        console.warn('Polling sorgusu başarısız:', e);
      }
    }, 1000);
  }

  /**
   * İş güncelleme durumlarını karşılar.
   * @private
   */
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

  /**
   * İlerleme çubuğunu günceller.
   * @private
   */
  _updateProgress(percent, message) {
    const clampedPct = Math.round(clamp(percent, 0, 100));
    this.progressBarFill.style.width = `${clampedPct}%`;
    this.progressPercentText.textContent = `%${clampedPct}`;
    this.progressStatusMsg.textContent = message;
  }

  /**
   * İndirme başarıyla tamamlandığında
   * @private
   */
  _onDownloadCompleted(job) {
    this.downloadProgressBox.classList.add('hidden');
    this.downloadSuccessBox.classList.remove('hidden');

    this.lastOutputFile = job.outputFilePath;
    this.successFilename.textContent = job.fileName || 'kesit.mp4';

    this.btnDownloadClip.disabled = false;
    this.btnDownloadClip.style.opacity = '1';
  }

  /**
   * İndirme hata verdiğinde
   * @private
   */
  _onDownloadFailed(errorMsg) {
    this.downloadProgressBox.classList.add('hidden');
    this.downloadErrorBox.classList.remove('hidden');
    this.downloadErrorMsg.textContent = errorMsg;

    this.btnDownloadClip.disabled = false;
    this.btnDownloadClip.style.opacity = '1';
  }

  /**
   * İndirilen dosyayı Finder'da vurgular.
   */
  async revealInFinder() {
    if (!this.lastOutputFile) return;

    const originalText = this.btnRevealFinder.innerHTML;
    try {
      this.btnRevealFinder.innerHTML = '<span>Açılıyor...</span>';
      const res = await fetch('/api/system/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: this.lastOutputFile })
      });

      if (res.ok) {
        this.btnRevealFinder.innerHTML = '<span class="btn-icon">✓</span><span>Finder\'da Açıldı</span>';
        setTimeout(() => {
          this.btnRevealFinder.innerHTML = originalText;
        }, 2000);
      } else {
        throw new Error('Finder açılamadı');
      }
    } catch (err) {
      console.warn('Finder reveal hatası:', err);
      this.btnRevealFinder.innerHTML = originalText;
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
      this.inspectLoading.classList.remove('hidden');
      this.btnInspect.disabled = true;
      this.btnPaste.disabled = true;
    } else {
      this.inspectLoading.classList.add('hidden');
      this.btnInspect.disabled = false;
      this.btnPaste.disabled = false;
    }
  }

  _showInspectError(msg) {
    this.inspectErrorMsg.textContent = msg;
    this.inspectError.classList.remove('hidden');
  }

  _hideInspectError() {
    this.inspectError.classList.add('hidden');
  }

  /**
   * Tarayıcı sekmesi açık olduğu sürece her 25 saniyede bir backend'e heartbeat gönderir.
   * Sekme kapatıldığında istekler durur ve backend 90s sonra otomatik kapanır.
   * @private
   */
  _startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      if (this.isServerShutdown) return;
      try {
        await fetch('/api/system/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        // Ağ veya sunucu kapalıysa sessizce devam et
      }
    }, 25000);
  }

  /**
   * Kullanıcı isteğiyle arka plan sunucusunu ve geçici önizleme dosyalarını kapatır.
   */
  async handleServerShutdown() {
    if (this.isServerShutdown) return;

    const confirmed = confirm('Arka plan sunucusunu ve geçici önizleme dosyalarını tamamen kapatmak istiyor musunuz?');
    if (!confirmed) return;

    this.isServerShutdown = true;

    // Heartbeat sayacını durdur
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Video oynatılıyorsa durdur
    if (this.player) {
      try { this.player.pause(); } catch (e) {}
    }

    // UI'ı kapalı duruma getir
    if (this.serverStatusPill) {
      this.serverStatusPill.className = 'status-pill status-shutdown';
    }
    if (this.serverStatusText) {
      this.serverStatusText.textContent = 'Kapalı';
    }
    if (this.shutdownServerBtn) {
      this.shutdownServerBtn.disabled = true;
    }
    if (this.shutdownBanner) {
      this.shutdownBanner.classList.remove('hidden');
      this.shutdownBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Sunucuya kapatma sinyali gönder
    try {
      await fetch('/api/system/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true
      });
    } catch (err) {
      console.warn('Sunucu kapatıldı (bağlantı sonlandı):', err);
    }
  }
}

// Sayfa yüklendiğinde başlat
document.addEventListener('DOMContentLoaded', () => {
  window.__kesitAlApp = new KesitAlApp();
});
