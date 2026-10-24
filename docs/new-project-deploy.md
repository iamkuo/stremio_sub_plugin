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
