# 研究：字幕辨識、時間軸同步、多語言支援

> 狀態：**尚未實作**。本文件只提供選項與取捨，等你決定後才動工。
> 日期：2026-10-03

## 先講三個決定性的技術事實

這三件事決定了「哪些做得到、哪些做不到」，所以先列出來。

| 事實 | 出處 | 意義 |
| --- | --- | --- |
| 字幕外掛**拿不到影片網址**（串流 URL） | [stremio-core #965](https://github.com/Stremio/stremio-core/issues/965)（仍為 open 的 feature request） | **音訊波形比對（ffsubsync／alass）在這個外掛裡不可能實作**，因為它們都需要讀影片的音軌 |
| 字幕外掛**拿得到** `videoHash`（OpenSubtitles CRC64）、`videoSize`、`filename` | [stremio-core #965](https://github.com/Stremio/stremio-core/issues/965)、[SDK defineSubtitlesHandler](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md) | 可以做**精確比對**：用 hash 或檔名找出「就是這個檔案」的字幕，時間軸天生就對 |
| `label` 欄位在部分客戶端**會被覆蓋成 URL** | [stremio-web #1166](https://github.com/Stremio/stremio-web/issues/1166)、[stremio-core #947](https://github.com/Stremio/stremio-core/issues/947)（v0.55.0 才加入） | 我們現在精心做的標籤，在 web／Desktop 上**可能根本看不到**；Android 則還沒對接（[stremio-core-kotlin #109](https://github.com/Stremio/stremio-core-kotlin/issues/109)） |

目前這個外掛的 manifest 是 `resources: ['subtitles']`，**沒有宣告任何 extra**，而且路由在解析
`/subtitles/{type}/{id}/{extra}.json` 時會把第 4 段直接忽略。也就是說：**我們現在可能正在收到
這些參數卻丟掉了，也可能根本沒收到**——這一點還沒實測過（見下方第 0 步）。

---

## 一、為什麼每筆字幕看起來都一樣

### 問題的真正來源

Stremio 的字幕選單只顯示兩樣東西：**語言**（`lang`）和**來源 addon**。它不顯示檔名。
所以同一部片 20 個版本全部顯示成「Chinese (Traditional)」。

我們目前已經做了：`label`（帶版本尾段）、去重、數量上限、來源標記。但 `label` 在
web／Desktop 上會被 [stremio-web #1166](https://github.com/Stremio/stremio-web/issues/1166)
覆蓋掉——`Player.js` 在兩處做了 `label: subtitles.url`，而 `SubtitlesMenu.js` 的顯示邏輯是
`label.startsWith('http') ? lang : label`，所以一旦被覆蓋，畫面就退回顯示 `lang`。

### 選項

| 選項 | 做法 | 效果 | 代價 |
| --- | --- | --- | --- |
| **A. 把辨識文字塞進 `lang` 欄位** | 不送 `zht`，改送 `zht · 1080p BluRay x264-AMIABLE` | **唯一在所有客戶端都看得到的辦法**（web／Desktop／iOS 會原樣顯示；Android 會顯示 "Unknown (und)"） | 破壞語言篩選與「偏好字幕語言」設定；Android 上反而更糟 |
| **B. 縮短清單** | 更積極去重、每個語言只留 N 筆、把最可能正確的排前面 | 直接解決「一排看起來一樣」的視覺噪音 | 可能砍掉使用者真正想要的那一筆 |
| **C. 用 hash／檔名挑出最佳解，並在 `label` 標上 `✓`** | 見第二節 | 清單變短且「對的那筆」通常在裡面 | 依賴 `label` 顯示，而它在 web 上壞掉 |
| **D. 分組語言** | 每種語言只回一筆「最佳」＋一筆「其他」 | 清單結構清楚 | 需要更多上游查詢 |
| **E. 靠 Stremio 自己修** | 等 [#1166](https://github.com/Stremio/stremio-web/issues/1166) 修好 | 免費 | 無法控制時程 |

> **排序不可靠**：自播放器 UI 1.9.0 起，字幕清單是**隨機排序**的
> （[stremio-bugs #2223](https://github.com/Stremio/stremio-bugs/issues/2223)，重開連結才會恢復）。
> 所以「把最好的排第一」這種策略**不能當成主要手段**。

### 建議

**B + C 為主，A 做成選項。** 也就是：清單保持短、用 hash／檔名把正確的那筆挑出來並標記，
另外提供一個「辨識文字放進 lang」的開關給真的受不了的人（並在設定頁警告 Android 的副作用）。

---

## 二、字幕時間軸不同步

### 為什麼外掛做不到自動音訊對齊

`ffsubsync`、`alass`、`autosubsync`、Plex 的 Auto-Sync 全都是同一套原理：**分析影片音軌**，
找出對白出現的時間點，再和字幕的時間軸做相關性比對。它們都需要影片檔本身。

而 Stremio 的協定**不把串流網址傳給字幕外掛**（[stremio-core #965](https://github.com/Stremio/stremio-core/issues/965)），
所以這條路在這個架構下是死的。任何聲稱「Stremio 字幕外掛能自動同步」的服務，實際上做的都是
下面的比對策略，不是音訊分析。

### 做得到的手段

| 手段 | 原理 | 能修的情況 | 需要什麼 |
| --- | --- | --- | --- |
| **1. Hash 精確比對** | 用 `videoHash`（CRC64）查 OpenSubtitles，取「就是這個檔案」的字幕 | **完全不同的剪輯版本**（時間軸天生就對） | 宣告 extra 收到 hash；OpenSubtitles.com API 需金鑰（免費額度 5–20/日） |
| **2. 檔名／版本比對** | 用 `filename` 的版本標籤（`1080p BluRay x264-AMIABLE`）挑同名版本 | 同版本但不同來源 | 宣告 extra 收到 filename |
| **3. FPS 自動校正** | 字幕最後一句的時間 ÷ 影片長度 ≈ 25/23.976 時，判定為 fps 不符，整份重新縮放 | **「越看越偏」的漸進式偏移**（最常見的症狀） | 影片長度（可由 Cinemeta 取得，不需要影片檔） |
| **4. 固定位移（offset）** | 設定裡讓使用者填 `+2000ms`，全部平移 | 開頭就固定差幾秒 | 一個設定欄位，完全離線 |
| **5. 使用者手動微調** | Stremio 播放器內建的字幕延遲 `+`／`-` 按鈕 | 殘餘的小偏差 | 無（Stremio 官方功能，[說明](https://stremio.zendesk.com/hc/en-us/articles/360021100092-Subtitles-are-not-synchronized)） |

### 建議

**先做 1 + 2（挑對版本）＋ 3（FPS 校正）＋ 4（手動位移）。**
其中 **3 是投報率最高的**：漸進式偏移幾乎都是 23.976 ↔ 25 fps 搞錯，而它**不需要影片檔**，
只要影片長度就能自動判斷並修正。4 則是保證有解的安全網。

> 若你同時也在本機保存影片檔，`Bazarr`／`Subsyncarr` 這類工具可以在下載後自動對齊；
> 但那只適用於本地檔案庫，對 Stremio 串流沒有幫助。

---

## 三、支援中文以外的語言，讓它成為唯一字幕來源

### 目前架構的限制

| 限制 | 位置 | 影響 |
| --- | --- | --- |
| 只接受中文字幕（`langs` 預設 `zht,chi,zho,chs,cht,zh-cn,zh-tw`） | `src/subtitles.js` `langAllowed()` | 英文、日文等一律被濾掉 |
| 輸出語言只有 OpenCC 的繁體目標 | `src/config.js` `to` | 只能「簡→繁」，不能「英→繁」以外的任意組合 |
| 備援翻譯只在**完全沒有中文字幕**時才啟動 | `src/subtitles.js` | 有中文字幕時不會出現其他語言選項 |
| 標籤寫死「繁體中文／簡體原文／繁體中文（Google）」 | `src/subtitles.js` | 多語言時無法表達 |

### 目標模型（參考現有做法）

市面上已有一個外掛（Subtitle Translator by okuru-id）採用這個模型，值得照抄：

> **列出全部原生字幕（原文語言），翻譯在背景進行。**
> 清單立刻顯示 `en (native · v3 en)`、`id (native · v3 id)`…；
> 當你選擇非目標語言的字幕時，**先立刻給你原生版本**，同時在背景翻譯；
> 翻譯完成後，下一次開啟清單會多出一筆 `id (translated · v3 en)`。

這個模型的優點是**不必等待**、清單永遠可用、翻譯成本只在實際被選擇時產生。

### 需要決定的事

1. **目標語言**：是「繁體中文」單一目標，還是任何語言都可當目標？（Google 端點支援約 100 種）
2. **要不要提供原生字幕**（不翻譯、原樣給）？這是「成為唯一來源」的關鍵——否則使用者
   看英文片時還是得回去用 OpenSubtitles 外掛。
3. **清單規模**：全語言 × 多上游可能一次回上百筆。要不要每個語言限制 N 筆？

### 風險（必須先講清楚）

- **Google 免費端點會限流**：我們在測試中已經從資料中心 IP 拿到 HTTP 429。
  個人自用沒問題；一旦公開給多人用，翻譯會大量失敗。若要公開，必須改成自帶金鑰
  （OpenAI／DeepL／Google Cloud）或限制用量。
- **上游是社群服務**：SubSense／SubDL／SubSource 都無 SLA，也可能塞廣告字幕
  （SubSense 免費方案已實測會回傳一筆推銷字幕）。
- **翻譯量暴增**：全語言模式下的翻譯請求會遠高於現在。

---

## 四、建議的實作順序

分階段，每階段都能獨立上線、可回退。

| 階段 | 內容 | 風險 | 價值 |
| --- | --- | --- | --- |
| **0. 探測** | 在 manifest 宣告 `videoHash`／`videoSize`／`filename` extra，並記錄實際收到的請求路徑 | 極低 | **先搞清楚 Stremio 到底傳了什麼給我們**——後面所有功能都建立在這個答案上 |
| **1. 版本比對** | 用 `filename` 挑選版本相符的字幕，清單變短且更準 | 低 | 直接改善「選錯版本 → 時間軸不對」 |
| **2. FPS 校正** | 用影片長度判斷 fps 不符並自動縮放時間軸 | 中 | 修掉最常見的漸進式偏移 |
| **3. 手動位移** | 設定頁加 `offsetMs` | 極低 | 保證有解的安全網 |
| **4. Hash 精確比對** | `rest` provider 加 `moviehash` 查詢（需 API Key） | 中 | 最準，但需要金鑰與額度 |
| **5. 多語言** | 全語言列表 + 原生／翻譯雙軌 | 中高 | 讓它成為唯一來源 |
| **6. 辨識開關** | 可選把辨識文字放進 `lang` | 低 | 在 `label` 壞掉的客戶端上唯一的辦法 |

---

## 五、需要你決定

1. **辨識**：只做「縮短清單 + 標記最佳解」，還是也要提供「把文字塞進 `lang`」的開關（Android 會顯示 Unknown）？
2. **同步**：接受「外掛不可能做音訊對齊」這個結論嗎？要從哪一項開始（建議 FPS 校正優先）？
3. **多語言**：目標是「繁體中文為主、其他語言原樣提供」，還是「任何語言都能翻譯成任何語言」？
4. **公開程度**：這是你個人自用，還是要給其他人用？（決定翻譯要不要改成自帶金鑰）
5. **要不要先用第 0 步的探測**確認 Stremio 實際傳了哪些參數，再決定後續？

---

## 附錄：實作後確認的協定細節（2026-10-03）

以下事實是在實作第 0～3 項時查證與實測確認的，補記在這裡以免日後重查。

### extras 的傳遞形式

[Stremio addon protocol](https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/protocol.md) 原文：

> To pass extra args … you should define a route of the format
> `/{resource}/{type}/{id}/{extraArgs}.json` where `extraArgs` is the query string
> stringified object (for example `"search=game%20of%20thrones&skip=100"`)

同一份文件對字幕資源的說明：

> `/subtitles/{type}/{id}.json` … the `id` in this case is the Open Subtitles file
> hash, while `extraArgs` … is used for `videoID` and `videoSize`

**結論**：extras 以 `key=value&key=value` 形式黏在路徑末段，**不需要在 manifest 的 resource 上宣告**
（SDK 的 manifest 文件只把 `extra` 定義給 catalog 用；資源物件只有 `{name, types, idPrefixes}`）。
因此探測可以安全地只做「解析 + 記錄」，不必改 manifest——改 manifest 反而有被判定為無效的風險。

**注意**：末段的 `.json` 會黏在最後一個值上（`filename=X.mkv.json`），解析時要剝掉；
且必須用**未解碼**的路徑片段去解析，否則檔名裡的 `&` 會被誤認為分隔符。

### 上游外掛不一定吃 extras

實測 `https://opensubtitles-v3.strem.io/subtitles/movie/tt1375666.json`，帶與不帶
`videoHash`／`videoSize`／`filename` 都回傳 90 筆，且其 manifest 的 `resources` 是 `["subtitles"]`
（未宣告 extras）。**所以 v3 目前不做雜湊比對**，轉送 extras 只是無害的嘗試；
真正的雜湊比對要靠 `rest`（OpenSubtitles.com API 的 `moviehash` 參數）。

### label 的顯示狀況

- `label` 欄位是 [stremio-core #947](https://github.com/Stremio/stremio-core/issues/947) 加入的，**v0.55.0 起**才有。
- [stremio-web #1166](https://github.com/Stremio/stremio-web/issues/1166)：`Player.js` 在兩處做了
  `label: subtitles.url`，把它覆蓋掉；`SubtitlesMenu.js` 的顯示邏輯是
  `label.startsWith('http') ? lang : label`，因此被覆蓋後畫面退回顯示 `lang`。
- [stremio-core-kotlin #109](https://github.com/Stremio/stremio-core-kotlin/issues/109)：Android 的
  protobuf 橋接尚未對接此欄位。
- 業界變通做法是把辨識文字塞進 `lang`（`langs` 套件對無法辨識的字串會原樣顯示），
  在 Android 上會變成 "Unknown (und)"。

### 清單排序不可靠

[stremio-bugs #2223](https://github.com/Stremio/stremio-bugs/issues/2223)：自播放器 UI 1.9.0 起，
字幕清單**隨機排序**，重開連結才會恢復。所以「最佳解排第一」不能當主要手段，必須靠標籤標記。

### 音訊對齊不可能

[stremio-core #965](https://github.com/Stremio/stremio-core/issues/965)（仍為 open）：

> The `extra` parameters include `videoHash` (OpenSubtitles format), `videoSize`, and
> `filename` … However, only the OpenSubtitles hash format … is supported.

該 issue 要求的正是「把串流網址傳給字幕外掛」，以便外掛自行做位元組範圍下載與雜湊計算——
這反證了**目前拿不到影片內容**，因此 ffsubsync／alass 類的音訊波形對齊無法實作。

### 片長精度限制了 fps 自動判斷

Cinemeta（`https://v3-cinemeta.strem.io/meta/{type}/{id}.json`）的 `meta.runtime` 只精確到分鐘
（如 `"2h 28min"`）。對 148 分鐘的片，取整誤差 ±0.7%，而 25↔23.976 的幀率差是 4.27%。
兩者只差一個數量級，因此：
- 「字幕超出片尾約 4.3%」（正確字幕不可能）→ 可自動修正。
- 「字幕提早約 4.1% 結束」→ 與「正確字幕的最後一句落在片尾字幕前」無法區分 → 只能手動。
