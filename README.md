# OpenCC 簡繁轉換字幕 — Stremio Addon

用 [OpenCC](https://github.com/BYVoid/OpenCC)（透過純 JavaScript 的
[`opencc-js`](https://github.com/nk2028/opencc-js)）把 **簡體中文字幕即時轉換成繁體中文**的 Stremio 字幕外掛。

播放影片時，Stremio 會向本外掛索取字幕清單；外掛向字幕來源取得簡體字幕後，在伺服器端以 OpenCC
轉換，再把繁體字幕回傳給播放器。所有 OpenCC 轉換選項（來源語言、目標語言、自訂詞彙、轉換時機）
都在設定網頁上以圖形介面呈現。

```
Stremio 播放器
   │  1. GET /<config>/subtitles/movie/tt1375666.json
   ▼
本外掛 ──2. 取得簡體字幕清單──▶ OpenSubtitles
   │  3. 回傳指向 /srt/<config>/<token>.srt 的字幕項目
   ▼
Stremio 播放器
   │  4. GET /srt/<config>/<token>.srt
   ▼
本外掛 ──5. 下載原始字幕 + OpenCC 轉換──▶ 回傳繁體 SRT
```

## 功能

- **OpenCC 完整轉換選項**：`cn→t`、`cn→tw`、`cn→twp`、`cn→hk`、`cn→hkp`，以及反向的
  `t/tw/hk→cn` 與日文新字體 `jp` 等所有 opencc-js 支援的組合。
- **自動偵測**：只轉換真正含簡體字的字幕，已繁體化的字幕原樣輸出（以 OpenCC 的簡體字表判斷）。
- **自訂詞彙對照表**：在 OpenCC 標準轉換之後套用，可覆寫任何結果（例如 `軟件=軟體`）。
- **保留原始字幕**：可同時在字幕清單中提供未轉換的版本，方便比對。
- **兩種字幕來源**：免金鑰的 OpenSubtitles v3 代理，或需要 API Key 但中文片源較多的
  OpenSubtitles.com REST API。
- **設定網頁**：即時預覽、一鍵產生 `stremio://` 安裝連結，設定不同即為不同的安裝項目，可同時安裝多組。
- 零原生依賴（不需要編譯 OpenCC C++ 函式庫），可直接部署到任何 Node.js 環境。

## 快速開始

```bash
npm install          # 會自動執行 tools/build.js 產生簡體字表
npm start            # 預設 http://localhost:7000
```

開啟 <http://localhost:7000/configure> 調整設定，按「安裝到 Stremio」即可。

開發時可用 `npm run dev`（Node 的 `--watch` 模式）。

### 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `7000` | 監聽埠 |
| `HOST` | `0.0.0.0` | 監聽位址 |
| `BASE_URL` | 自動由請求標頭推斷 | 對外公開網址。放在反向代理後方時建議明確設定，例如 `https://subs.example.com` |

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
| **Docker** | 內含 `Dockerfile`：`docker build -t opencc-stremio . && docker run -p 7000:7000 opencc-stremio` | 可放任意 VPS／NAS |
| **自己的 VPS** | `npm ci && PORT=7000 BASE_URL=https://subs.example.com npm start`，前面放 Nginx/Caddy 反向代理並簽 TLS | 記得設 `BASE_URL` |
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
```

## 測試

```bash
npm test                                   # 偵測字表 + 端到端（含即時來源）
PUB=https://your-addon CFG=<config> node test/live-check.js
```

## 疑難排解

- **Stremio 顯示「沒有字幕」**：先確認來源確實有中文字幕。v3 來源的中文片源偏少，可改用
  OpenSubtitles.com REST API。也可直接測試
  `https://opensubtitles-v3.strem.io/subtitles/movie/tt1375666.json` 是否回傳 `zht` 項目。
- **字幕變成亂碼**：外掛會依 BOM、`Content-Type`、UTF-8 有效性、最後 GBK／Big5 的順序判斷編碼；
  若仍異常，請開 issue 並附上來源網址。
- **安裝後看不到設定按鈕**：manifest 在已有設定時會移除 `configurable`，這是正常行為；
  請回到 `/configure` 重新產生連結。
- **反向代理後網址錯誤**：設定 `BASE_URL` 環境變數。

## 授權

MIT。OpenCC 字典資料來自 [`opencc-js`](https://github.com/nk2028/opencc-js)／
[OpenCC](https://github.com/BYVoid/OpenCC)（Apache-2.0）。字幕內容來自 OpenSubtitles，
請遵守其服務條款。
