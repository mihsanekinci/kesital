/**
 * PlayerAdapter.js
 * YouTube IFrame API ve HTML5 <video> için birleşik, hibrit video oynatıcı adaptörü.
 * Dışarıya standart bir API sunarak UI katmanının oynatıcı detaylarından bağımsız çalışmasını sağlar.
 */

export class PlayerAdapter {
  constructor() {
    this.container = null;
    this.videoData = null;
    this.type = null; // 'youtube' | 'html5'
    this.ytPlayer = null;
    this.videoEl = null;

    this.isReady = false;
    this._isPlaying = false;
    this._duration = 0;
    this._currentTime = 0;

    // Callback dinleyicileri
    this._timeUpdateCallbacks = new Set();
    this._stateChangeCallbacks = new Set();
    this._readyCallbacks = new Set();
    this._errorCallbacks = new Set();

    this._ytTimer = null;

    // Akıcı HTML5 scrubbing ve 50ms throttle kontrolü
    this._pendingSeekTime = null;
    this._lastSeekTime = 0;
    this._seekThrottleMs = 50;
    this._seekTimeout = null;
  }

  /**
   * Oynatıcıyı başlatır ve container içerisine yerleştirir.
   * @param {HTMLElement} containerEl - Oynatıcının yerleştirileceği DOM elemanı
   * @param {Object} videoData - Backend'den gelen video metadata objesi
   * @returns {Promise<void>}
   */
  async init(containerEl, videoData) {
    this.destroy();
    this.container = containerEl;
    this.videoData = videoData;
    this._duration = videoData.durationSeconds || 0;

    // Önce container'ı temizle
    this.container.innerHTML = '';

    const isYouTube = videoData.platform === 'youtube' && videoData.youtubeVideoId;

    if (isYouTube) {
      try {
        await this._initYouTube(videoData.youtubeVideoId);
        this.type = 'youtube';
      } catch (err) {
        console.warn('YouTube IFrame başlatılamadı, HTML5 fallback deneniyor...', err);
        if (videoData.directStreamUrl) {
          await this._initHtml5(videoData.directStreamUrl);
          this.type = 'html5';
        } else {
          this._emitError('YouTube oynatıcı yüklenemedi: ' + (err.message || err));
          throw err;
        }
      }
    } else if (videoData.directStreamUrl) {
      await this._initHtml5(videoData.directStreamUrl);
      this.type = 'html5';
    } else {
      const err = new Error('Oynatılabilir video kaynağı bulunamadı.');
      this._emitError(err.message);
      throw err;
    }
  }

  /**
   * YouTube IFrame API ile oynatıcıyı kurar
   * @private
   */
  async _initYouTube(videoId) {
    await this._loadYouTubeIFrameAPI();

    return new Promise((resolve, reject) => {
      const mountId = `yt-player-${Date.now()}`;
      const mountDiv = document.createElement('div');
      mountDiv.id = mountId;
      mountDiv.className = 'player-embed-yt';
      this.container.appendChild(mountDiv);

      let settled = false;

      this.ytPlayer = new window.YT.Player(mountId, {
        videoId: videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          fs: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event) => {
            if (!settled) {
              settled = true;
              this.isReady = true;
              const ytDuration = this.ytPlayer.getDuration();
              if (ytDuration && ytDuration > 0) {
                this._duration = ytDuration;
              }
              this._startYtTimeTracker();
              this._emitReady();
              resolve();
            }
          },
          onStateChange: (event) => {
            const YTState = window.YT.PlayerState;
            if (event.data === YTState.PLAYING) {
              this._isPlaying = true;
              this._emitStateChange('playing');
            } else if (event.data === YTState.PAUSED) {
              this._isPlaying = false;
              this._emitStateChange('paused');
            } else if (event.data === YTState.ENDED) {
              this._isPlaying = false;
              this._emitStateChange('ended');
            }
          },
          onError: (event) => {
            const errorCodes = {
              2: 'Geçersiz parametre.',
              5: 'HTML5 oynatıcı hatası.',
              100: 'Video bulunamadı veya silinmiş.',
              101: 'Bu video harici sitelerde oynatmaya kapatılmış (Embed engeli).',
              150: 'Bu video harici sitelerde oynatmaya kapatılmış (Embed engeli).'
            };
            const msg = errorCodes[event.data] || `YouTube hata kodu: ${event.data}`;
            if (!settled) {
              settled = true;
              reject(new Error(msg));
            } else {
              this._emitError(msg);
            }
          }
        }
      });
    });
  }

  /**
   * HTML5 Video elementiyle oynatıcıyı kurar
   * @private
   */
  async _initHtml5(streamUrl) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.className = 'player-embed-html5';
      video.src = streamUrl;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.width = '100%';
      video.style.height = '100%';

      video.addEventListener('loadedmetadata', () => {
        if (video.duration && !isNaN(video.duration) && video.duration > 0) {
          this._duration = video.duration;
        }
        this.isReady = true;
        this._emitReady();
        resolve();
      });

      video.addEventListener('timeupdate', () => {
        this._currentTime = video.currentTime;
        this._emitTimeUpdate(this._currentTime);
      });

      video.addEventListener('play', () => {
        this._isPlaying = true;
        this._emitStateChange('playing');
      });

      video.addEventListener('pause', () => {
        this._isPlaying = false;
        this._emitStateChange('paused');
      });

      video.addEventListener('ended', () => {
        this._isPlaying = false;
        this._emitStateChange('ended');
      });

      // Akıcı scrubbing: seek işlemi tamamlandığında bekleyen bir kare varsa uygula
      video.addEventListener('seeked', () => {
        if (this._pendingSeekTime !== null) {
          const queued = this._pendingSeekTime;
          this._pendingSeekTime = null;
          this._lastSeekTime = Date.now();
          video.currentTime = queued;
        }
      });

      video.addEventListener('error', (e) => {
        const err = video.error ? (video.error.message || '') : '';
        const isAudioRendererError =
          err.includes('AUDIO_RENDERER_ERROR') ||
          err.includes('audio') ||
          (video.error && video.error.code === 4 && /audio/i.test(err));

        if (isAudioRendererError) {
          console.warn('AUDIO_RENDERER_ERROR tespit edildi. Oynatıcı sessizce otomatik kurtarılıyor...', err);
          const savedTime = (video.currentTime && !isNaN(video.currentTime)) ? video.currentTime : (this._currentTime || 0);
          try {
            video.load();
            video.currentTime = savedTime;
          } catch (recoverErr) {
            console.warn('Otomatik video kurtarma denemesi başarısız:', recoverErr);
          }
          return; // Kullanıcıya kırmızı hata bildirme!
        }

        this._emitError('HTML5 Video Hatası: ' + (err || 'Video yüklenemedi'));
      });

      this.videoEl = video;
      this.container.appendChild(video);
    });
  }

  /**
   * YouTube IFrame API scriptini dinamik olarak yükler
   * @private
   */
  _loadYouTubeIFrameAPI() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        return resolve();
      }

      // Önceden script eklendiyse callback bekle
      const existingScript = document.getElementById('youtube-iframe-api');
      if (existingScript) {
        const checkInterval = setInterval(() => {
          if (window.YT && window.YT.Player) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
        return;
      }

      // Yeni script tag ekle
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === 'function') prevCallback();
        resolve();
      };
    });
  }

  /**
   * YouTube oynatıcı için yüksek frekanslı zaman takibi başlatır
   * @private
   */
  _startYtTimeTracker() {
    this._stopYtTimeTracker();
    this._ytTimer = setInterval(() => {
      if (this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
        const current = this.ytPlayer.getCurrentTime();
        if (current !== undefined && !isNaN(current)) {
          this._currentTime = current;
          this._emitTimeUpdate(current);
        }
      }
    }, 100);
  }

  _stopYtTimeTracker() {
    if (this._ytTimer) {
      clearInterval(this._ytTimer);
      this._ytTimer = null;
    }
  }

  // --- Oynatıcı Kontrol Metotları ---

  /**
   * Videoyu belirtilen saniyeye atar (50ms akıcı throttle ve kuyruk mekanizmalı).
   * @param {number} seconds
   */
  seekTo(seconds) {
    const target = Math.max(0, Math.min(seconds, this._duration || 999999));
    this._currentTime = target;

    if (this.type === 'youtube' && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      // İkinci parametre true: seek işlemini hemen uygula
      this.ytPlayer.seekTo(target, true);
    } else if (this.type === 'html5' && this.videoEl) {
      const now = Date.now();
      // Eğer video halihazırda seeking durumundaysa veya son seek üzerinden 50ms geçmediyse throttle uygula
      if (this.videoEl.seeking || (now - this._lastSeekTime < this._seekThrottleMs)) {
        this._pendingSeekTime = target;
        if (!this._seekTimeout) {
          this._seekTimeout = setTimeout(() => {
            this._seekTimeout = null;
            if (this.videoEl && !this.videoEl.seeking && this._pendingSeekTime !== null) {
              const queuedTime = this._pendingSeekTime;
              this._pendingSeekTime = null;
              this._lastSeekTime = Date.now();
              this.videoEl.currentTime = queuedTime;
            }
          }, this._seekThrottleMs);
        }
      } else {
        this._lastSeekTime = now;
        this.videoEl.currentTime = target;
      }
    }

    this._emitTimeUpdate(target);
  }

  /**
   * Oynatmayı başlatır.
   */
  play() {
    if (this.type === 'youtube' && this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
      this.ytPlayer.playVideo();
    } else if (this.type === 'html5' && this.videoEl) {
      this.videoEl.play().catch(console.warn);
    }
  }

  /**
   * Oynatmayı duraklatır.
   */
  pause() {
    if (this.type === 'youtube' && this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
      this.ytPlayer.pauseVideo();
    } else if (this.type === 'html5' && this.videoEl) {
      this.videoEl.pause();
    }
  }

  /**
   * Oynat/Duraklat geçişi yapar.
   */
  togglePlay() {
    if (this._isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Geçerli saniyeyi döner.
   * @returns {number}
   */
  getCurrentTime() {
    return this._currentTime || 0;
  }

  /**
   * Toplam süreyi (saniye) döner.
   * @returns {number}
   */
  getDuration() {
    if (this.type === 'youtube' && this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') {
      const d = this.ytPlayer.getDuration();
      if (d > 0) this._duration = d;
    } else if (this.type === 'html5' && this.videoEl && this.videoEl.duration) {
      this._duration = this.videoEl.duration;
    }
    return this._duration || 0;
  }

  /**
   * Oynatılıyor mu?
   * @returns {boolean}
   */
  isPlaying() {
    return this._isPlaying;
  }

  // --- Event Listener Yönetimi ---

  onTimeUpdate(fn) {
    this._timeUpdateCallbacks.add(fn);
    return () => this._timeUpdateCallbacks.delete(fn);
  }

  onStateChange(fn) {
    this._stateChangeCallbacks.add(fn);
    return () => this._stateChangeCallbacks.delete(fn);
  }

  onReady(fn) {
    this._readyCallbacks.add(fn);
    if (this.isReady) fn();
    return () => this._readyCallbacks.delete(fn);
  }

  onError(fn) {
    this._errorCallbacks.add(fn);
    return () => this._errorCallbacks.delete(fn);
  }

  _emitTimeUpdate(time) {
    for (const fn of this._timeUpdateCallbacks) {
      try { fn(time); } catch (e) { console.error(e); }
    }
  }

  _emitStateChange(state) {
    for (const fn of this._stateChangeCallbacks) {
      try { fn(state); } catch (e) { console.error(e); }
    }
  }

  _emitReady() {
    for (const fn of this._readyCallbacks) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  _emitError(err) {
    for (const fn of this._errorCallbacks) {
      try { fn(err); } catch (e) { console.error(e); }
    }
  }

  /**
   * Oynatıcıyı tamamen temizler.
   */
  destroy() {
    this._stopYtTimeTracker();

    if (this._seekTimeout) {
      clearTimeout(this._seekTimeout);
      this._seekTimeout = null;
    }
    this._pendingSeekTime = null;

    if (this.ytPlayer && typeof this.ytPlayer.destroy === 'function') {
      try {
        this.ytPlayer.destroy();
      } catch (e) {}
      this.ytPlayer = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.src = '';
      this.videoEl.load();
      this.videoEl.remove();
      this.videoEl = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
    }

    this.isReady = false;
    this._isPlaying = false;
    this._duration = 0;
    this._currentTime = 0;
  }
}
