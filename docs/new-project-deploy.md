# 在新專案重建這個網站

舊 WebDev 專案（`wdp_cfbd1518d2a7b44b31f00251`）的 GitHub→Manus 儲存庫轉換
在平台端壞掉，導致**完全無法發布**（完整調查見 `docs/repo-and-publishing.md`）。
所以改用一個**全新的 WebDev 專案**來承接這個網站。

## 程式碼來源

- GitHub：`https://github.com/iamkuo/stremio_sub_plugin`（公開，可直接 clone）
- 分支：`main`
- 這是一個**純 Node.js HTTP 服務**（CommonJS）：沒有前端框架、沒有 React、
  沒有需要前端工具鏈的建置步驟。

> **重要**：這份 GitHub repo **只是拿來取程式碼**，**不要**把它設成新專案的
> canonical 儲存庫。新專案要維持**由 Manus 管理**（Managed by Manus）。
> 舊專案正是因為連了 GitHub 才失去發布能力。

## 服務長什麼樣

| 項目 | 值 |
| --- | --- |
| 進入點 | `src/server.js` |
| 監聽 | `process.env.PORT`，預設 `3000` |
| 健康檢查 | `GET /health` → 200 |
| Addon manifest | `GET /manifest.json` |
| 設定頁 | `GET /configure` |
| 容器 | 根目錄 `Dockerfile`（`node:22-alpine`） |
| 依賴 | `opencc-js`、`iconv-lite`（純 JS，無原生模組） |

## 新專案要設定的東西

```
features.server         = true
runtime.port            = 3000
deploy.dockerfilePath   = "Dockerfile"
deploy.healthPath       = "/health"
publishing.auto_publish = true
```

**不需要任何密鑰。** 不要帶 `GITHUB_MIRROR_TOKEN` 之類的東西過來。

## 驗收清單

1. `GET /health` → **200**
2. `GET /manifest.json` → 有效的 addon manifest（`id` 為 `org.opencc.subtitles`，
   `resources: ["subtitles"]`，`types: ["movie","series"]`）
3. `GET /configure` → 設定頁正常顯示，三個語言選單（主要／次要／翻譯來源）都在
4. **集數換算（這次真正要修的東西）**：用一個包含兩個來源的設定查

   ```
   /<config>/subtitles/series/tt26743760:1:49.json
   ```

   應該回 **6 筆**（含繁體中文），下載第一筆中文應得到**約 365 句**的正常 SRT，
   而不是「字幕下載失敗」。

   `tt26743760:1:49` 是動畫的**絕對集數**，實際對應 `tt26743760:3:1`；
   `src/episodes.js` 會用 Cinemeta 的集數表換算，兩種編號都會查。

## 安裝連結（新網址出現後）

- 設定頁：`https://<新網域>/configure`
- 直接安裝：`stremio://<新主機>/manifest.json`

舊網址是 `openccsub-ervmyzsa.manus.space`，新專案會有新的網域，
所以使用者的 Stremio 需要**重新安裝一次 addon**。

## 上線後要做的事

1. 在 Stremio 移除舊的 addon，用新的設定頁連結重新安裝。
2. 舊專案（`wdp_cfbd1518d2a7b44b31f00251`）留著當歷史紀錄，不要刪。
3. 如果之後想再要 GitHub 備份，**用 mirror 推送**，不要走平台的 Git 連線流程
   （那正是這次壞掉的地方）。

## 2026-10-24：新專案已上線

新專案 `wdp_bd763bb2ab905f273b93a4b1` 已建立並發布。

| 項目 | 值 |
| --- | --- |
| 公開網址 | <https://openccsub-7kezbynj.manus.space> |
| 已發布版本 | `b7b034d` |
| canonical | `manus`（由 Manus 管理）✅ |
| 設定頁 | <https://openccsub-7kezbynj.manus.space/configure> |
| 安裝 | `stremio://openccsub-7kezbynj.manus.space/manifest.json` |

舊站 `openccsub-ervmyzsa.manus.space` 仍跑著沒有修正的 `75f2a8b`，
正好可以當成比對的「修正前」基準。

### 與修正的差異比對（舊站 vs 新站）

單一來源 `opensubtitles-v3`、`langs=zh`：

| 查詢 | 舊站 `75f2a8b` | 新站 `b7b034d` |
| --- | --- | --- |
| `tt26743760:1:49`（絕對集數） | **0 筆** | **3 筆 `zht`** |
| `tt26743760:3:1`（上游真正存在的編號） | 3 筆 `zht` | 3 筆 `zht` |

兩來源（`opensubtitles-v3` + SubSense）、`langs=zh,en`：

| 查詢 | 舊站 | 新站 |
| --- | --- | --- |
| `tt26743760:1:49` | **0 筆** | **6 筆**（3 `zht` + 3 `eng`） |

也就是說：**修正只在該生效的地方生效**（絕對集數），在不需要換算的編號上
新舊站行為完全一致。下載第一筆中文字幕得到 22844 bytes、364 句的有效 SRT，
內容是繁體（`藥`、`這`），不是「字幕下載失敗」。

靜態產物逐位元比對：

| 檔案 | 結果 |
| --- | --- |
| `/manus-routes.json` | **完全相同** |
| `/logo.png` | **完全相同** |
| `/manifest.json` | 只差 `logo` 的網域，其餘相同 |
| `/configure` | 兩站都是 59152 bytes，只差 og:url、canonical 與平台 `spaceId` |

（本機的 `public/configure.html` 是 42407 bytes，比線上小，因為伺服器會注入
SEO meta 與平台設定區塊；兩個站注入後的結果一致。）

### 順手發現的小問題（尚未修）

如果 `<config>` 裡的來源不是可辨識的 URL——例如把設定頁 chip 用的 preset id
（`opensubtitles-v3`）直接塞進 `sources`——服務會**靜默回傳空清單**，
而且舊站與新站都一樣。正常從設定頁操作碰不到（chips 插入的是完整 URL），
但值得之後加一層「來源無法辨識時回退到預設來源」的保護。
