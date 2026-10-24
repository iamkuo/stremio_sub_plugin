# 儲存庫與發布：現況與踩過的坑

這份文件記錄專案的 canonical 儲存庫在哪裡、發布要怎麼做，以及一次真實的卡死事件。
下次接手的人（或未來的我）不需要再從頭摸索。

## 名詞

- **canonical 儲存庫**：專案的權威儲存庫。Manus 只承認推到它的 `main` 的 commit 為
  **checkpoint**。推到別的 branch、或推到使用者自己的 repo，都不算。
- **checkpoint**：被平台接受的一個版本，會出現在 Version history。
- **發布（publish）**：把某個 checkpoint 實際部署上線。**存 checkpoint 和發布是兩件事。**

## 現況（2026-10-24）

- canonical 儲存庫：**GitHub `iamkuo/stremio_sub_plugin`**（`git_repository.provider = github`）
- 最新 checkpoint：`5ab8c44`（集數編號修正，見 `docs/no-tracks-history.md` 第 7 節）
- `publishing.auto_publish`：`true`
- 正式站：<https://openccsub-ervmyzsa.manus.space>

## 發布規則：依 canonical 儲存庫而不同

| canonical | 自動發布 | 手動發布 |
| --- | --- | --- |
| Manus 管理 | 推 checkpoint 後會自動送出 | 我可以用 `POST config/publish` |
| **GitHub（現在）** | **不會送出**（實測：只回「automatic publication was not confirmed」） | **只有 Dashboard 的 Publish 按鈕**；我用 API 會回 `github_canonical_active` |

**所以切到 GitHub 之後，發布這件事就不再由我控制了。** 這是切換前沒有預期到的代價。

## 踩過的坑：卡死的切換確認卡

要切換 canonical 儲存庫時，平台會開一張**確認卡**，必須由使用者在對話裡按下確認。
這次要從 GitHub 切回 Manus 時，卡片卡住了：

- 使用者在 App 裡找不到那張卡。
- 我無法**重發**：`PUT config/git` 一直回 `confirmation_required` 並附上**同一個**
  `operationId`（`wdo_5123b5b7cdd9a5f5ef6eca5c`），平台認為「already displayed」。
- 我無法**中止**：`POST config/git/abort` 回 `canonical_changed`（帶 `expectedRevision`
  為 2 或 3 都一樣）；只帶 `operationId` 則回 `validation_failed`。
- `GET config/git/transfer` 一直是 `null`——因為 transfer 紀錄要等卡片被確認後才會建立。
- 先用「維持 GitHub」的空操作想清掉舊卡，再重送——**無效**，還是同一張卡。
- **換一個新對話也沒用**：WebDev 專案的附加是**綁在單一 session** 上的，新任務
  `GET config` 回 `not_attached`，附加時被平台的型別契約拒絕
  （`The Webdev operation was rejected by the typed contract`）。所以新對話開不出新卡。

**教訓**：確認卡只在它被建立的那個對話裡有效。如果使用者在那個對話裡看不到它，
就沒有從工具端恢復的辦法——必須從 Manus 網頁版介面把卡片叫出來。

## GitHub mirror

Manus 內建的 GitHub 連線是**唯讀**的（token 沒有 scope，`gh repo create`、`git push`
都會被拒）。要在 Manus 管理 canonical 的同時讓 GitHub 保持同步，唯一可行的方法是
使用者提供一組有寫入權限的 token：

- 專案密鑰：`GITHUB_MIRROR_TOKEN`（fine-grained PAT，`Contents: Read and write`，
  只授權 `iamkuo/stremio_sub_plugin`；`configured_environments: ["all"]`）。
- 每次 checkpoint 之後推一份過去：

```sh
git -c credential.helper='' \
    -c credential.helper='!f() { echo username=x-access-token; echo "password=${GITHUB_MIRROR_TOKEN}"; }; f' \
    push https://github.com/iamkuo/stremio_sub_plugin.git HEAD:main
```

這樣 token 不會出現在指令、檔案或 git remote 設定裡。

**注意**：宣告密鑰後，如果對應環境沒有存到值，**發布會被 `409 required_secret_missing`
擋下**。所以密鑰一定要選「所有環境」，而且宣告與填值要一起完成。

## 回到 Manus 管理時要注意什麼

切回 Manus 屬於 **snapshot recovery**，不是把 GitHub 的歷史搬過來：

1. 取 GitHub 上最新 checkpoint 的 tree。
2. 在 Manus repo 用 `git commit-tree` 建立新 commit **R**：tree 相同，
   **唯一 parent 是 Manus repo 的 main**。
3. 只把 R 推到 Manus repo 的 main（不 force、不合併兩邊歷史）。
4. `POST config/git/complete` 要帶 `targetSha: R`。

完成後 `origin` 會換成 Manus repo，GitHub 那份就變成靜態快照（除非用上面的 mirror 推送）。
