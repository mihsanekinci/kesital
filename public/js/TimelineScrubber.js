/**
 * TimelineScrubber.js
 * Apple QuickTime ve macOS Pro Apps tarzı çift sarı tutamaçlı görsel video kırpma cetveli.
 * Pointer Events tabanlı canlı kare önizlemesi ve dikey çift çizgi grip yapısı.
 * Kesinlikle emoji içermez.
 */

import { formatTime, clamp } from './timeUtils.js';

export class TimelineScrubber {
  /**
   * @param {HTMLElement} mountEl - Scrubber'ın ekleneceği kapsayıcı
   * @param {Object} options
   * @param {number} [options.minDuration=0.2] - Minimum seçilebilir kesit uzunluğu (saniye)
   * @param {Function} [options.onTrimChange] - ({ startSeconds, endSeconds }) => void
   * @param {Function} [options.onSeek] - (seconds) => void - Canlı kare önizlemesi için
   * @param {Function} [options.onTrimCommit] - ({ startSeconds, endSeconds }) => void - Sürükleme bittiğinde
   */
  constructor(mountEl, options = {}) {
    this.mountEl = mountEl;
    this.options = {
      minDuration: 0.2,
      onTrimChange: () => {},
      onSeek: () => {},
      onTrimCommit: () => {},
      ...options
    };

    this.duration = 0;
    this.startSeconds = 0;
    this.endSeconds = 0;
    this.currentPlayheadSeconds = 0;

    this.isDragging = false;
    this.dragTarget = null; // 'left' | 'right' | 'playhead' | null
    this.activePointerId = null;

    this._buildDOM();
    this._bindEvents();
  }

  /**
   * Scrubber bileşeninin DOM hiyerarşisini inşa eder.
   * @private
   */
  _buildDOM() {
    this.mountEl.innerHTML = '';

    this.container = document.createElement('div');
    this.container.className = 'timeline-scrubber-root';

    // Cetvel / Zaman çizgisi göstergesi
    this.rulerEl = document.createElement('div');
    this.rulerEl.className = 'timeline-ruler';

    // Ana ray
    this.trackEl = document.createElement('div');
    this.trackEl.className = 'timeline-track';
    this.trackEl.id = 'scrubberTrack';

    // Çentikler katmanı
    this.ticksEl = document.createElement('div');
    this.ticksEl.className = 'timeline-ticks';
    this.ticksEl.id = 'scrubberTicks';
    this.trackEl.appendChild(this.ticksEl);

    // Sol pasif karartma maskesi
    this.dimLeftEl = document.createElement('div');
    this.dimLeftEl.className = 'timeline-dim timeline-dim-left';
    this.dimLeftEl.id = 'scrubberUnselectedLeft';
    this.trackEl.appendChild(this.dimLeftEl);

    // Sağ pasif karartma maskesi
    this.dimRightEl = document.createElement('div');
    this.dimRightEl.className = 'timeline-dim timeline-dim-right';
    this.dimRightEl.id = 'scrubberUnselectedRight';
    this.trackEl.appendChild(this.dimRightEl);

    // Sarı Seçim Çerçevesi (QuickTime Trim Window)
    this.trimWindowEl = document.createElement('div');
    this.trimWindowEl.className = 'timeline-trim-window';
    this.trimWindowEl.id = 'scrubberSelection';

    // Minimalist dikey çift çizgi grip SVG'si (SF Symbols / Final Cut Pro tarzı)
    const gripSvg = `
      <svg class="handle-grip-svg" width="6" height="14" viewBox="0 0 6 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.5 2V12M4.5 2V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `;

    // Sol Tutamaç (Başlangıç)
    this.handleLeftEl = document.createElement('div');
    this.handleLeftEl.className = 'timeline-handle timeline-handle-left';
    this.handleLeftEl.id = 'handleLeft';
    this.handleLeftEl.setAttribute('role', 'slider');
    this.handleLeftEl.setAttribute('aria-label', 'Kesit Başlangıcı');
    this.handleLeftEl.innerHTML = `
      <div class="handle-grip-icon">${gripSvg}</div>
      <div class="handle-badge handle-badge-left" id="badgeLeft">00:00.0</div>
    `;

    // Sağ Tutamaç (Bitiş)
    this.handleRightEl = document.createElement('div');
    this.handleRightEl.className = 'timeline-handle timeline-handle-right';
    this.handleRightEl.id = 'handleRight';
    this.handleRightEl.setAttribute('role', 'slider');
    this.handleRightEl.setAttribute('aria-label', 'Kesit Bitişi');
    this.handleRightEl.innerHTML = `
      <div class="handle-grip-icon">${gripSvg}</div>
      <div class="handle-badge handle-badge-right" id="badgeRight">00:00.0</div>
    `;

    this.badgeLeft = this.handleLeftEl.querySelector('.handle-badge-left');
    this.badgeRight = this.handleRightEl.querySelector('.handle-badge-right');

    this.trimWindowEl.appendChild(this.handleLeftEl);
    this.trimWindowEl.appendChild(this.handleRightEl);
    this.trackEl.appendChild(this.trimWindowEl);

    // Oynatma Çizgisi (Playhead)
    this.playheadEl = document.createElement('div');
    this.playheadEl.className = 'timeline-playhead';
    this.playheadEl.id = 'scrubberPlayhead';
    this.playheadEl.innerHTML = `
      <div class="playhead-cap"></div>
      <div class="playhead-line"></div>
    `;
    this.trackEl.appendChild(this.playheadEl);

    this.container.appendChild(this.rulerEl);
    this.container.appendChild(this.trackEl);
    this.mountEl.appendChild(this.container);

    // Boyut değişimlerini izle
    this.resizeObserver = new ResizeObserver(() => {
      this._updateVisuals();
      this._renderRuler();
    });
    this.resizeObserver.observe(this.trackEl);
  }

  /**
   * Pointer ve dokunmatik etkileşimleri bağlar.
   * @private
   */
  _bindEvents() {
    // Sol tutamaç sürükleme
    this.handleLeftEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startDrag(e, 'left');
    });

    // Sağ tutamaç sürükleme
    this.handleRightEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startDrag(e, 'right');
    });

    // Playhead sürükleme
    this.playheadEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startDrag(e, 'playhead');
    });

    // Çubuğa doğrudan tıklama (Playhead zıplatma)
    this.trackEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rect = this.trackEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const targetTime = this._pixelsToSeconds(clickX);
      
      this.setCurrentTime(targetTime);
      this.options.onSeek(targetTime);

      this._startDrag(e, 'playhead');
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      this._onDragMove(e);
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.isDragging) return;
      this._endDrag(e);
    });

    window.addEventListener('pointercancel', (e) => {
      if (!this.isDragging) return;
      this._endDrag(e);
    });
  }

  /**
   * Sürükleme başlatma
   * @private
   */
  _startDrag(e, target) {
    this.isDragging = true;
    this.dragTarget = target;
    this.activePointerId = e.pointerId;

    if (e.target && typeof e.target.setPointerCapture === 'function') {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {}
    }

    this.container.classList.add('is-dragging');
    if (target === 'left') this.handleLeftEl.classList.add('active');
    if (target === 'right') this.handleRightEl.classList.add('active');
    if (target === 'playhead') this.playheadEl.classList.add('active');
  }

  /**
   * Sürükleme hareketi
   * @private
   */
  _onDragMove(e) {
    if (!this.isDragging || this.duration <= 0) return;

    const rect = this.trackEl.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const timeAtX = this._pixelsToSeconds(currentX);

    if (this.dragTarget === 'left') {
      const maxStart = Math.max(0, this.endSeconds - this.options.minDuration);
      this.startSeconds = clamp(timeAtX, 0, maxStart);

      this._updateVisuals();
      this.options.onSeek(this.startSeconds);
      this.options.onTrimChange({
        startSeconds: this.startSeconds,
        endSeconds: this.endSeconds
      });
    } else if (this.dragTarget === 'right') {
      const minEnd = Math.min(this.duration, this.startSeconds + this.options.minDuration);
      this.endSeconds = clamp(timeAtX, minEnd, this.duration);

      this._updateVisuals();
      this.options.onSeek(this.endSeconds);
      this.options.onTrimChange({
        startSeconds: this.startSeconds,
        endSeconds: this.endSeconds
      });
    } else if (this.dragTarget === 'playhead') {
      const playheadTime = clamp(timeAtX, 0, this.duration);
      this.setCurrentTime(playheadTime);
      this.options.onSeek(playheadTime);
    }
  }

  /**
   * Sürükleme bitişi
   * @private
   */
  _endDrag(e) {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.container.classList.remove('is-dragging');
    this.handleLeftEl.classList.remove('active');
    this.handleRightEl.classList.remove('active');
    this.playheadEl.classList.remove('active');

    this.options.onTrimCommit({
      startSeconds: this.startSeconds,
      endSeconds: this.endSeconds
    });

    this.dragTarget = null;
    this.activePointerId = null;
  }

  _pixelsToSeconds(px) {
    const width = this.trackEl.clientWidth;
    if (width <= 0 || this.duration <= 0) return 0;
    const ratio = clamp(px / width, 0, 1);
    return ratio * this.duration;
  }

  _secondsToPercent(seconds) {
    if (this.duration <= 0) return 0;
    return clamp((seconds / this.duration) * 100, 0, 100);
  }

  _updateVisuals() {
    if (this.duration <= 0) return;

    const startPct = this._secondsToPercent(this.startSeconds);
    const endPct = this._secondsToPercent(this.endSeconds);
    const widthPct = Math.max(0, endPct - startPct);

    this.dimLeftEl.style.width = `${startPct}%`;
    this.dimRightEl.style.left = `${endPct}%`;
    this.dimRightEl.style.width = `${Math.max(0, 100 - endPct)}%`;

    this.trimWindowEl.style.left = `${startPct}%`;
    this.trimWindowEl.style.width = `${widthPct}%`;

    this.badgeLeft.textContent = formatTime(this.startSeconds, true);
    this.badgeRight.textContent = formatTime(this.endSeconds, true);

    const playheadPct = this._secondsToPercent(this.currentPlayheadSeconds);
    this.playheadEl.style.left = `${playheadPct}%`;
  }

  _renderRuler() {
    if (this.duration <= 0) return;

    this.rulerEl.innerHTML = '';
    this.ticksEl.innerHTML = '';

    const width = this.trackEl.clientWidth;
    if (width < 200) return;

    const targetLabelCount = Math.max(3, Math.floor(width / 90));
    const rawStep = this.duration / targetLabelCount;

    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    let step = steps.find(s => s >= rawStep) || steps[steps.length - 1];

    for (let time = 0; time <= this.duration; time += step) {
      const pct = (time / this.duration) * 100;

      const label = document.createElement('span');
      label.className = 'ruler-label';
      label.style.left = `${pct}%`;
      label.textContent = formatTime(time, false);
      this.rulerEl.appendChild(label);

      const tick = document.createElement('div');
      tick.className = 'timeline-tick';
      tick.style.left = `${pct}%`;
      this.ticksEl.appendChild(tick);
    }
  }

  setDuration(durationSeconds, initialStart = 0, initialEnd = null) {
    this.duration = Math.max(0, durationSeconds);
    this.startSeconds = clamp(initialStart, 0, this.duration);
    this.endSeconds = initialEnd !== null ? clamp(initialEnd, this.startSeconds, this.duration) : this.duration;
    this.currentPlayheadSeconds = this.startSeconds;

    this._renderRuler();
    this._updateVisuals();

    this.options.onTrimChange({
      startSeconds: this.startSeconds,
      endSeconds: this.endSeconds
    });
  }

  setTrim(startSeconds, endSeconds, notify = true) {
    if (this.duration <= 0) return;

    const clampedStart = clamp(startSeconds, 0, this.duration - this.options.minDuration);
    const clampedEnd = clamp(endSeconds, clampedStart + this.options.minDuration, this.duration);

    this.startSeconds = clampedStart;
    this.endSeconds = clampedEnd;

    this._updateVisuals();

    if (notify) {
      this.options.onTrimChange({
        startSeconds: this.startSeconds,
        endSeconds: this.endSeconds
      });
    }
  }

  setStartTime(start) {
    this.setTrim(start, this.endSeconds, true);
  }

  setEndTime(end) {
    this.setTrim(this.startSeconds, end, true);
  }

  setCurrentTime(seconds) {
    this.currentPlayheadSeconds = clamp(seconds, 0, this.duration);
    if (!this.isDragging) {
      const playheadPct = this._secondsToPercent(this.currentPlayheadSeconds);
      this.playheadEl.style.left = `${playheadPct}%`;
    }
  }

  getTrim() {
    return {
      startSeconds: this.startSeconds,
      endSeconds: this.endSeconds,
      duration: Math.max(0, this.endSeconds - this.startSeconds)
    };
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.mountEl.innerHTML = '';
  }
}
