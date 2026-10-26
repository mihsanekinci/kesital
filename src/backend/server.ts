import { createApp } from './app.js';
import { VideoClipService } from './services/VideoClipService.js';
import { YtDlpCommandAdapter } from './infrastructure/YtDlpCommandAdapter.js';
import { MacOsFinderAdapter } from './infrastructure/MacOsFinderAdapter.js';

const PORT = Number(process.env.PORT) || 3847;

const mediaEngine = new YtDlpCommandAdapter();
const fileAdapter = new MacOsFinderAdapter();
const service = new VideoClipService(mediaEngine, fileAdapter);

let lastActivityTime = Date.now();
let hasConnectedClient = false;

const app = createApp({
  service,
  onActivity: () => {
    lastActivityTime = Date.now();
    hasConnectedClient = true;
  }
});

const server = app.listen(PORT, () => {
  console.log(`🎬 Video Clipper Backend Sunucusu http://localhost:${PORT} adresinde çalışıyor.`);
});

// Idle Auto-Shutdown Monitor
const IDLE_TIMEOUT_MS = 90_000; // 90 seconds
const CHECK_INTERVAL_MS = 15_000; // 15 seconds

const idleTimer = setInterval(() => {
  if (hasConnectedClient) {
    const idleDuration = Date.now() - lastActivityTime;
    if (idleDuration >= IDLE_TIMEOUT_MS) {
      if (!service.hasActiveJobs()) {
        console.log(`⏱️ Sunucu ${Math.round(idleDuration / 1000)} saniyedir boşta ve aktif işlem yok. Otomatik kapatılıyor...`);
        service.cleanupPreviews();
        clearInterval(idleTimer);
        server.close(() => {
          console.log('✅ Sunucu boşta kalma süresi dolduğu için güvenle kapatıldı.');
          process.exit(0);
        });
      } else {
        console.log('⏳ Boşta kalma süresi doldu ancak aktif kesme işlemleri sürüyor, kapanma ertelendi.');
      }
    }
  }
}, CHECK_INTERVAL_MS);

// Graceful shutdown handling
const handleShutdown = (signal: string) => {
  console.log(`\n🛑 ${signal} sinyali alındı. Sunucu kapatılıyor...`);
  clearInterval(idleTimer);
  service.cleanupPreviews();
  server.close(() => {
    console.log('✅ Sunucu güvenle durduruldu.');
    process.exit(0);
  });
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
