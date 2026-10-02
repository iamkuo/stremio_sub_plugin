# OpenCC 簡繁轉換字幕 — Stremio Addon

用 [OpenCC](https://github.com/BYVoid/OpenCC)（透過純 JavaScript 的
[`opencc-js`](https://github.com/nk2028/opencc-js)）把 **簡體中文字幕即時轉換成繁體中文**的 Stremio 字幕外掛。

播放影片時，Stremio 會向本外掛索取字幕清單；外掛向字幕來源取得簡體字幕後，在伺服器端以 OpenCC
轉換，再把繁體字幕回傳給播放器。所有 OpenCC 轉換選項（來源語言、目標語言、自訂詞彙、轉換時機）
都在設定網頁上以圖形介面呈現。

如果影片**完全找不到中文字幕**，外掛會用**免金鑰的 Google 翻譯**把備援語言（預設英文）
的字幕翻成繁體中文。

```
Stremio 播放器
   │  1. GET /<config>/subtitles/movie/tt1375666.json
   ▼
本外掛 ──2. 取得字幕清單──▶ OpenSubtitles
   │  3. 回傳指向 /srt/<config>/<token>.srt 的字幕項目
   ▼
Stremio 播放器
   │  4. GET /srt/<config>/<token>.srt
   ▼
本外掛 ──5a. 有中文字幕：下載 + OpenCC 轉換────────────▶ 回傳繁體 SRT
       └─5b. 沒有中文字幕：下載備援語言字幕 + Google 翻譯──▶ 回傳繁體 SRT
```

## 功能

- **OpenCC 完整轉換選項**：`cn→t`、`cn→tw`、`cn→twp`、`cn→hk`、`cn→hkp`，以及反向的
  `t/tw/hk→cn` 與日文新字體 `jp` 等所有 opencc-js 支援的組合。
- **自動偵測**：只轉換真正含簡體字的字幕，已繁體化的字幕原樣輸出（以 OpenCC 的簡體字表判斷）。
- **自訂詞彙對照表**：在 OpenCC 標準轉換之後套用，可覆寫任何結果（例如 `軟件=軟體`）。
- **保留原始字幕**：可同時在字幕清單中提供未轉換的版本，方便比對。
- **兩種字幕來源**：免金鑰的 OpenSubtitles v3 代理，或需要 API Key 但中文片源較多的
  OpenSubtitles.com REST API。
- **備援翻譯**：找不到任何中文字幕時，用 Google 翻譯（免金鑰）把備援語言（預設 `eng`）
  的字幕翻成繁體中文；翻譯只在你實際選擇該字幕時才發生。
- **統計面板**：即時顯示快取命中率、快取節省的字元與翻譯次數，由伺服器主動推送更新。
- **乾淨的字幕清單**：自動去除重複的字幕檔、限制候選數量，並為每筆加上精簡的版本標籤。
- **設定網頁**：即時預覽、一鍵產生 `stremio://` 安裝連結，設定不同即為不同的安裝項目，可同時安裝多組。
- 零原生依賴（不需要編譯 OpenCC C++ 函式庫），可直接部署到任何 Node.js 環境。

## 快速開始

```bash
npm install          # 會自動執行 tools/build.js 產生簡體字表
npm start            # 預設 http://localhost:3000
```

開啟 <http://localhost:3000/configure> 調整設定，按「安裝到 Stremio」即可。

開發時可用 `npm run dev`（Node 的 `--watch` 模式）。

### 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `3000` | 監聽埠 |
| `HOST` | `0.0.0.0` | 監聽位址 |
| `BASE_URL` | 自動由請求標頭推斷 | 對外公開網址。放在反向代理後方時建議明確設定，例如 `https://subs.example.com` |
| `GOOGLE_API_URL` | 依序使用兩台官方主機 | 覆寫 Google 翻譯端點，僅測試時使用 |

## 設定項目

設定會以 `base64url(JSON)` 的形式存在 addon 網址中，因此網址一定安全（只含 `A-Za-z0-9-_`），
且同一台伺服器可以同時提供任意多組不同設定的安裝。

| 設定 | 說明 | 預設 |
| --- | --- | --- |
| `from` | OpenCC 來源語言：`cn`、`t`、`tw`、`twp`、`hk`、`hkp`、`jp` | `cn` |
| `to` | OpenCC 目標語言（依 `from` 動態篩選可用組合） | `twp` |
| `mode` | `auto` = 僅轉換含簡體字的字幕；`always` = 一律轉換 | `auto` |
| `keepOriginal` | 是否額外提供未轉換的原始字幕 | `false` |
| `customDict` | 自訂詞彙對照表，一行一組 | 空 |
| `provider` | `v3` = OpenSubtitles v3 代理（免金鑰）；`rest` = OpenSubtitles.com API | `v3` |
| `sourceUrl` | `v3` 模式要代理的伺服器網址 | `https://opensubtitles-v3.strem.io` |
| `apiKey` | `rest` 模式的 OpenSubtitles.com API Key | 空 |
| `langs` | 接受的字幕語言代碼（逗號分隔） | `zht,chi,zho,chs,cht,zh-cn,zh-tw` |
| `fallbackLangs` | 沒有中文字幕時要翻譯的來源語言（逗號分隔，留空即停用） | `eng` |
| `fallbackLimit` | 備援字幕最多顯示幾筆（1–5） | `1` |

### OpenCC 轉換組合

`opencc-js` 支援的組合（設定頁會自動依「來源語言」篩選「目標語言」）：

| 設定 | OpenCC 設定 | 說明 |
| --- | --- | --- |
| `cn → t` | `s2t` | 簡體 → 繁體（OpenCC 標準） |
| `cn → tw` | `s2tw` | 簡體 → 台灣正體 |
| `cn → twp` | `s2twp` | 簡體 → 台灣正體 **＋ 詞彙轉換**（軟件→軟體、視頻→影片） |
| `cn → hk` | `s2hk` | 簡體 → 香港繁體 |
| `cn → hkp` | `s2hkp` | 簡體 → 香港繁體 ＋ 詞彙轉換 |
| `t/tw/hk → cn` | `t2s`／`tw2s`／`hk2s` | 繁體 → 簡體（反向） |
| `jp → t` | `jp2t` | 日文新字體 → 繁體（實驗性） |

> 台灣使用者建議用 `cn → twp`；香港使用者建議 `cn → hk`。

### 自動偵測的判定方式

`tools/build.js` 會從 `opencc-js` 的 `STCharacters` 字典取出「只在簡體出現」的單字，
並扣掉兩類會誤判的字：

1. 繁簡同形的字（`台`、`后`、`里`、`面`、`云`、`万` 等）。
2. 台灣／香港標準字（由 `TWVariants`、`HKVariants` 字典取得，例如 `吃`、`秘`、`峰`、`群`）。

字幕只要含其中任一個字就會被判定為簡體並轉換。判定刻意偏向「寧可多轉」——因為多轉一次
只是把已繁體的字幕再正規化一次（結果仍是正確的繁體），但漏轉會讓使用者看到簡體字。

### 自訂詞彙對照表

一行一組，支援 `=`、`,`、`，`、`|`、Tab 分隔，`#` 開頭為註解：

```
# 台灣用語
軟件=軟體
視頻=影片
自行車=腳踏車
```

自訂詞彙是在 OpenCC 標準轉換**之後**套用，所以左右兩邊都寫轉換後的繁體形式即可覆寫 OpenCC 的結果。

## 字幕清單的呈現

Stremio 的字幕選單對每個項目只顯示「語言」與「來源 addon」，無法分辨同一部片的數十個版本。
因此本外掛做了三件事讓清單保持可用：

- **去除重複**：同一個字幕檔若被來源重複列出（同一個下載網址），只保留一筆。
- **數量上限**：中文來源最多 5 筆；備援翻譯預設**只留 1 筆**（可用 `fallbackLimit` 調到 5，
  並依「備援語言」順序排優先），避免熱門片出現一整排看起來一模一樣的選項。
- **精簡標籤**：每筆帶上 `label` 欄位，格式為「種類 · 版本」，例如：

  | 種類 | 標籤範例 |
  | --- | --- |
  | OpenCC 轉換 | `繁體中文 · …1080p BluRay x264-AMIABLE` |
  | 未轉換原文（`keepOriginal`） | `簡體原文 · …1080p BluRay x264-AMIABLE` |
  | 備援翻譯 | `繁體中文（Google） · …1080p BluRay x264-AMIABLE` |

  版本名稱的處理規則：

  - 去除副檔名、把 `.`／`_` 換成空白，並移除結尾多餘的語言標記（`cht`、`eng`…）。
  - 太長時**保留尾端**的版本資訊而不是片名開頭：同一部片的候選都共用片名，
    真正能分辨版本的是 `1080p BluRay x264-AMIABLE` 這一段。
  - 截斷至 30 字元並在前面加上 `…`；完全沒有版本資訊時只顯示種類。
  - 若兩個版本壓縮後標籤仍然相同，會自動加上 ` (2)`、` (3)` 序號，確保每一列都分得出來。

> `label` 需要 Stremio core **v0.55.0 以上**才會顯示；較舊的客戶端與部分平台（例如 Android 的
> protobuf 橋接尚未傳遞此欄位）仍只顯示語言名稱，此時清單只會看到數筆「Chinese (Traditional)」，
> 這也是為什麼數量上限比標籤更重要。
>
> 另外，開啟 `keepOriginal` 會讓每筆中文字幕變成兩筆（轉換版 + 原文版），這是預期行為。

## 備援翻譯

當一部影片在來源上**完全沒有中文字幕**時，外掛會退而求其次：取一份英文（或你指定的語言）
字幕，機器翻譯成繁體中文再交給播放器。

翻譯用的是 **Google 翻譯，不需要任何金鑰或註冊**，走 Chrome 翻譯擴充功能所呼叫的
`translate_a/t` 端點。唯一需要的設定是「備援語言」。

### 啟用方式

不用做任何事：「備援語言」預設 `eng` 即可運作。可填多個（例如 `eng,jpn` 表示優先英文、
其次日文）；清空此欄則完全停用備援翻譯。

### 行為

- **只在沒有中文字幕時才使用**：只要來源有符合「接受的字幕語言代碼」的中文（或簡體）字幕，
  就仍然走 OpenCC 轉換，完全不動用任何翻譯服務。
- **翻譯發生在下載時**，不是列出清單時。瀏覽字幕清單、切換集數都不會觸發翻譯；只有你真正選了
  那個字幕才會翻譯，結果會快取 1 小時。
- **目標語言**由 OpenCC 的「目標語言」決定：繁體系列 → `zh-TW`／`ZH-HANT`，簡體 → `zh-CN`／`ZH-HANS`，日文 → `ja`／`JA`。
- **來源語言**由字幕的語言代碼自動對應（`eng` → `en`、`jpn` → `ja`…），無法對應時交給服務自動偵測。
- **備援字幕只留 1 筆**（預設）：同一部片常有數十個版本的英文字幕，而 Stremio 只顯示語言、無法區分，
  因此預設只顯示一筆；可在設定頁把「備援字幕數量」調到最多 5 筆。
- **分批與併發**：字幕會切成多個請求（每請求最多 50 段、查詢字串 6 KB），並以 4 個併發送出。
  實測 1590 段的電影字幕約 15～19 秒完成。
- 翻譯結果會再套用一次你設定的 OpenCC 組合，把台灣／香港用語（`軟件→軟體`、`視頻→影片`）一併在地化。

### 成本與限制

| 項目 | 值 |
| --- | --- |
| 費用 | 免費 |
| 穩定性 | 非官方端點、無保證，可能被限流；每台主機失敗會自動重試一次，之後回傳 HTTP 502 |
| 失敗時 | 播放器顯示一行以 `#` 開頭的說明，而不是壞掉的字幕 |

> **為什麼不用常見的 `client=gtx` 端點**：`translate_a/single?client=gtx` 從資料中心 IP 會直接回
> HTTP 429，因此本外掛改用 `translate_a/t?client=dict-chrome-ex`，並依序嘗試
> `translate.googleapis.com` 與 `clients5.google.com` 兩台主機。

## 快取與翻譯統計

設定頁的「快取與翻譯統計」面板會即時顯示：

| 指標 | 說明 |
| --- | --- |
| 快取命中率 | 命中的字幕檔不必重新下載，也不必重新翻譯 |
| 快取節省的字元 | 命中時省下的翻譯字元總數 |
| 目前快取筆數 | 記憶體內保留的字幕檔數量（上限 200，每筆 1 小時） |
| 啟動以來翻譯 | 字幕數、字元數、Google 請求數、錯誤數 |
| 服務啟動時間 | 這些數字都是**本服務啟動以來**的統計，重新部署後會歸零 |

更新方式是**伺服器主動推送**（Server-Sent Events），前端完全不輪詢：

```
設定頁 ──POST /api/stats/watch ─────────▶ 取得一次性 id（金鑰不進 URL）
設定頁 ──GET  /api/stats/stream?id=… ───▶ 持續接收 data: {JSON} 快照
```

- 連線中斷時自動重試 3 次，之後退回「單次查詢 ＋ 手動重新整理」，不會偷偷變成輪詢。

## 字幕來源

### 1. OpenSubtitles v3 代理（預設，免金鑰）

外掛直接代理 Stremio 官方的 OpenSubtitles v3 addon：

```
GET https://opensubtitles-v3.strem.io/subtitles/{type}/{id}.json
```

- **優點**：不需要註冊、不需要 API Key；上游回傳的檔案已是 UTF-8 SRT，沒有編碼問題。
- **缺點**：中文片源相對少（多數影片只有 1 部中文字幕，部分影片完全沒有），且上游是
  Stremio 社群服務，沒有可用性保證。
- 若上游服務中斷，可把「來源伺服器」改成任何相容 Stremio 字幕協定的伺服器，不需改程式碼。

### 2. OpenSubtitles.com REST API（需 API Key，中文片源較多）

```
GET  https://api.opensubtitles.com/api/v1/subtitles?imdb_id=1375666&languages=zh-cn,zh-tw
POST https://api.opensubtitles.com/api/v1/download   { "file_id": 123456 }
```

- 在 <https://www.opensubtitles.com> 免費註冊後，於個人設定頁的 **API** 區段取得 API Key，
  填入設定頁即可。
- 電影用 `imdb_id`，影集用 `parent_imdb_id` ＋ `season_number`／`episode_number`。
- 免費方案的每日下載次數有限（實際額度依官方公告為準），大量使用需要付費方案。

### 其他可行來源

| 來源 | 取得方式 | 備註 |
| --- | --- | --- |
| [OpenSubtitles REST API](https://opensubtitles.com) | API Key，查詢 IMDb ID 或影片 Hash | 本專案已內建 |
| [SubDL](https://subdl.com) | 免費 API Key，`/subtitles/movie/{imdb}` | 中文片源不錯 |
| [SubSource](https://subsource.net) | 需申請 API Key | |
| 影片 Hash 比對 | OpenSubtitles 的 `moviehash` 參數 | 比對較準，需先計算影片檔雜湊 |

要新增來源只需在 `src/sources.js` 增加一個 `listFromXxx(cfg, type, id)` 並在
`listSubtitles()` 分派，回傳 `{ id, url | fileId, lang, name }` 陣列即可。

## 架設設定網站

設定網頁（`/configure`）與 addon 本體是同一個 Node.js 服務，**不需要另外架站**，
而且 Stremio 客戶端會用同一個網址開啟設定頁。因此只要把這個服務部署到任何有公開 HTTPS 的
環境即可。

### 部署選項

| 平台 | 做法 | 備註 |
| --- | --- | --- |
| **Render / Railway / Fly.io** | 連接 GitHub repo，Build `npm install`，Start `npm start` | 最簡單，持久執行、自動 HTTPS |
| **Docker** | 內含 `Dockerfile`：`docker build -t opencc-stremio . && docker run -p 3000:3000 opencc-stremio` | 可放任意 VPS／NAS，會讀取 `PORT` |
| **自己的 VPS** | `npm ci && PORT=3000 BASE_URL=https://subs.example.com npm start`，前面放 Nginx/Caddy 反向代理並簽 TLS | 記得設 `BASE_URL` |
| **ElfHosted** | 社群提供 Stremio addon 代管，可申請部署 | 專為 Stremio addon 設計 |
| **Vercel / Netlify** | 需改寫成 serverless function（字幕轉換會佔用較長執行時間，且有 1.2 MB 字典載入成本） | 不建議 |

**重點**：Stremio 需要能從公開網路以 **HTTPS** 存取 manifest，本機 `localhost` 只能用來測試。

### 安裝到 Stremio

設定頁會產生兩種連結：

- `stremio://<host>/<config>/manifest.json` — 桌面／行動版 App 直接安裝
- `https://web.stremio.com/#/addons?addon=<manifest 網址>` — 網頁版 Stremio

`<config>` 就是該組設定的 base64url 編碼，因此「簡轉台灣正體」與「簡轉香港繁體」可以是兩個
獨立的安裝項目，同時存在。

## 專案結構

```
src/
  server.js          HTTP 路由（manifest／configure／subtitles／srt／api）
  manifest.js        addon manifest
  config.js          設定的編碼與解碼（base64url + 短鍵）
  opencc.js          OpenCC 轉換、自訂詞彙、簡體偵測
  google.js          Google 翻譯（分批、併發、主機備援、錯誤訊息）
  srt.js             字幕分段／重組與批次併發的共用邏輯
  stats.js           快取與翻譯統計、事件匯流排、SSE 監控註冊
  langs.js           語言代碼對應（Stremio ↔ Google ↔ OpenSubtitles REST）
  sources.js         字幕來源（v3 代理 / OpenSubtitles.com REST）
  subtitles.js       Stremio subtitles 資源處理器
  subtitle-file.js   下載字幕、判斷編碼、轉換、回傳
  token.js           字幕檔案的不透明 token
  data/              由 tools/build.js 產生（簡體字表）
public/
  configure.html     設定網頁（單一檔案，無前端框架）
  logo.png           addon 圖示（由本服務自行提供，manifest 會指向 /logo.png）
tools/
  build.js           由 opencc-js 字典產生簡體字表
test/
  detect-check.js    簡體偵測字表驗證
  smoke.js           單元 + HTTP + 即時來源端到端測試
  live-check.js      針對執行中的服務比對「轉換後 vs 原始」字幕
  live-google.js     對真實 Google 端點驗證備援翻譯
```

## 測試

```bash
npm test                                   # 偵測字表 + 端到端（含即時來源）
PUB=https://your-addon CFG=<config> node test/live-check.js
PUB=http://localhost:3000 node test/live-google.js tt2380307   # 對真實 Google 端點驗證
```

## 疑難排解

- **Stremio 顯示「沒有字幕」**：先確認來源確實有中文字幕。v3 來源的中文片源偏少，可改用
  OpenSubtitles.com REST API。也可直接測試
  `https://opensubtitles-v3.strem.io/subtitles/movie/tt1375666.json` 是否回傳 `zht` 項目。
- **字幕變成亂碼**：外掛會依 BOM、`Content-Type`、UTF-8 有效性、最後 GBK／Big5 的順序判斷編碼；
  若仍異常，請開 issue 並附上來源網址。
- **安裝後看不到設定按鈕**：manifest 在已有設定時會移除 `configurable`，這是正常行為；
  請回到 `/configure` 重新產生連結。
- **沒有出現備援翻譯的字幕**：只有在來源**完全沒有**中文字幕時才會啟用，且「備援語言」不能留空。
- **字幕顯示 `# Google 翻譯失敗`**：免費端點被限流；稍後再試即可，重複失敗代表該 IP 暫時被封鎖。
- **監控面板顯示「即時連線中斷」**：反向代理不支援 SSE 串流；面板會自動退回單次查詢模式。
- **反向代理後網址錯誤**：設定 `BASE_URL` 環境變數。

## 授權

MIT。OpenCC 字典資料來自 [`opencc-js`](https://github.com/nk2028/opencc-js)／
[OpenCC](https://github.com/BYVoid/OpenCC)（Apache-2.0）。字幕內容來自 OpenSubtitles，
請遵守其服務條款。
