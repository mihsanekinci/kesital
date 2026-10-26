# ADR 001: Hibrit Önizleme Motoru ve Katmanlı Medya Kesme Mimarisi

**Tarih:** 2026-10-26  
**Durum:** Kabul Edildi  
**Kapsam:** Mimari / Medya Motoru / API

---

## 1. Bağlam ve Problem (Context)

Kullanıcıların YouTube ve genel web video kaynaklarından (MP4 / HTTP akışları) sadece istedikleri zaman aralıklarını (in-point ve out-point) kayıpsız, ultra hızlı ve hassas şekilde indirip yerel diske (macOS Finder ortamına) kaydetmelerini sağlayan yerel bir web tabanlı video kırpma aracına ihtiyaç duyulmaktadır.

Karşılaşılan temel teknik zorluklar şunlardır:
1. **Bant Genişliği ve Süre Kısıtı:** 2 saatlik bir videodan yalnızca 10 saniyelik bir kesit almak için tüm videonun indirilmesi kabul edilemez bir zaman ve veri kaybıdır.
2. **Kare Hassasiyeti (Cut Accuracy):** Yalnızca akış düzeyinde kesme yapıldığında anahtar karelere (I-frame / keyframe) denk gelmeyen başlangıç noktaları siyah ekran, donma veya ses-görüntü desenskronizasyonuna yol açar.
3. **Önizleme Çeşitliliği:** YouTube videoları doğrudan video etiketi (`<video>`) üzerinden CORS ve imza kısıtlamaları nedeniyle her zaman çalınamazken; genel MP4 akışları doğrudan oynatılabilir. Önizleme arayüzünün her iki kaynağı da kusursuz desteklemesi gerekmektedir.
4. **Modülerlik ve Test Edilebilirlik:** Medya işleme motoru (yt-dlp, ffmpeg) sistem komutlarına bağımlıdır; iş mantığı (business logic) ve HTTP API katmanının dış komutlardan izole edilmesi (Dependency Inversion) ve test edilebilir olması gerekmektedir.

---

## 2. Alınan Karar (Decision)

Sistem aşağıdaki üç temel kolon üzerine inşa edilmiştir:

### 2.1. Katmanlı Mimari ve Bağımlılıkların Tersine Çevrilmesi (Layered Architecture & DIP)
Sistem strictly katmanlı ve `modular-architect` ilkelerine uygun olarak tasarlanmıştır:
- **HTTP / Controller Katmanı (`ClipController`):** Gelen HTTP isteklerini Zod şemaları ile doğrular, SSE (Server-Sent Events) bağlantılarını yönetir ve yanıt döner.
- **Servis Katmanı (`VideoClipService`):** İş mantığını, asenkron indirme işlerinin yaşam döngüsünü (`ClipJobStatus`) ve durum güncellemelerini yönetir.
- **Adaptör / Altyapı Katmanı (`YtDlpCommandAdapter`, `MacOsFinderAdapter`):** `IMediaEngineAdapter` ve `ISystemFileAdapter` arayüzlerini implemente eder. Sistem komutlarını (`yt-dlp`, `ffmpeg`, `open -R`) izole eder. Bu sayede test ortamında gerçek komutlar yerine sahte (mock) adaptörler enjekte edilebilir.

### 2.2. yt-dlp Kısmi İndirme ve Keyframe Hassasiyeti
Klip indirme işleminde tüm videoyu indirmek yerine doğrudan istenen aralık çekilir:
```bash
/opt/homebrew/bin/yt-dlp \
  --ffmpeg-location /opt/homebrew/bin \
  --download-sections "*00:01:15.000-00:01:45.000" \
  --force-keyframes-at-cuts \
  -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b" \
  --merge-output-format mp4 \
  --newline \
  -o "~/Downloads/%(title)s [%(section_start)s-%(section_end)s].%(ext)s" \
  <URL>
```
- `--download-sections "*start-end"`: Yalnızca HTTP byte-range istekleriyle ilgili zaman aralığındaki veri bloklarını indirir.
- `--force-keyframes-at-cuts`: Kesim noktası bir anahtar kareye (keyframe) denk gelmiyorsa ffmpeg aracılığıyla o noktayı yeniden encode ederek sıfır milisaniye kayıpla tam ve pürüzsüz başlangıç sağlar.
- `--newline`: İlerleme yüzdesini stdout üzerinden anlık ayrıştırmayı ve Server-Sent Events (SSE) ile istemciye aktarmayı kolaylaştırır.

### 2.3. Hibrit Önizleme Motoru (Hybrid Preview Architecture)
- **YouTube Kaynakları İçin:** URL'den ayrıştırılan video ID kullanılarak resmi YouTube IFrame Player API (`YT.Player`) entegre edilir. Böylece CORS, şifreleme ve telif kısıtlamalarına takılmadan anında önizleme ve scrubbing sağlanır.
- **Genel Web Akışları İçin:** `yt-dlp --dump-single-json` çıktısındaki `directStreamUrl` çözümlenerek doğrudan HTML5 `<video>` etiketiyle önizleme oynatılır.

---

## 3. Reddedilen Alternatifler (Alternatives Considered)

1. **Tüm Videoyu İndirip ffmpeg ile Yerelde Kesmek:**
   - *Gerekçe:* Çok uzun videolarda onlarca gigabayt veri indirilmesi ve dakikalarca beklenmesi gerekecekti. `--download-sections` bunu saniyelere indirmektedir.
2. **Kayıpsız Akış Kopyalama (`-c copy`) ile Kesme:**
   - *Gerekçe:* Anahtar kareler (I-frame) arası 2 ila 10 saniye olabildiği için, tam istenen saniyede kesilemez ve videonun başında donma veya gri ekran oluşur. `--force-keyframes-at-cuts` bu problemi tamamen ortadan kaldırmaktadır.
3. **WebSockets Protokolü:**
   - *Gerekçe:* Tek yönlü ilerleme bildirimi (progress tracking) için WebSocket bağlantısı gereksiz bir çift yönlü protokol karmaşıklığı oluşturur. Server-Sent Events (SSE) standart HTTP üzerinden çalışır, otomatik yeniden bağlanma desteğine sahiptir ve mimariyi hafif tutar.

---

## 4. Sonuçlar ve Bedeller (Consequences & Trade-offs)

### Avantajlar:
- **Ultra Hızlı İşlem:** Yalnızca hedef klip aralığı indirildiği için işlem süresi %90'a varan oranda kısalır.
- **Maksimum Test Edilebilirlik:** Servis katmanı sistem araçlarından tamamen yalıtılmış olup birim ve entegrasyon testlerinde %100 mocklanabilir.
- **Doğal macOS Entegrasyonu:** Kesilen dosya doğrudan Finder'da odaklanarak (`open -R`) kullanıcıya sunulur.
- **Tip Güvenliği ve Doğrulama:** Zod ile çalışma anı doğrulaması sağlanır, geçersiz parametreler anında engellenir.

### Bedeller ve Yönetimi:
- **Harici Bağımlılık:** Sistemde `yt-dlp` ve `ffmpeg` binary dosyalarının kurulu olması gerekmektedir (`/opt/homebrew/bin`). Adaptör katmanı bu ikililerin varlığını çalışma zamanında doğrular ve anlaşılır hata fırlatır.
- **YouTube IFrame API Olay Yönetimi:** YouTube IFrame player'ının zaman takibi için polling/event listener dengesi kurulmalıdır.
