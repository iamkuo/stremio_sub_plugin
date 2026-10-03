# 桶內排序：版本比對是怎麼算的

> 對應程式碼：`src/match.js`（`releaseTokens` / `rankByMatch`）與 `src/subtitles.js`（`rankAndPick`）。

## 一句話

**不數「共用幾個字」，而是看「哪個字只有少數候選有」。** 因為同一部片的所有候選都共用片名，
共用字數根本分不出 BluRay 版和 CAM 版；能分辨版本的是只有一兩筆候選才有的發行組名稱。

---

## 輸入

| 輸入 | 來源 | 缺席時 |
| --- | --- | --- |
| `items` | 該語言桶裡的所有候選，每筆有 `name`（版本名稱） | — |
| `videoName` | Stremio 送來的 `filename`（正在播放的檔名） | 全部候選同分，維持上游順序 |

`videoName` 就是**版本名稱本身**（`Inception.2010.1080p.BluRay.x264-AMIABLE.mkv`），
所以不需要另外知道片名是什麼——罕見度加權會自動把片名貶到近乎零權重。

---

## 步驟 1：切 token

```js
String(name).toLowerCase()
  .replace(/[._\-+[\]]+/g, ' ')      // 點、底線、連字號、加號、方括號 → 空白
  .split(/[^a-z0-9]+/)                // 其餘非英數 → 切開
  .filter((t) => t.length >= 3 && !NOISE.has(t) && !LANGUAGE_TAGS.has(t));
```

三個過濾條件各有理由：

| 條件 | 理由 | 例子 |
| --- | --- | --- |
| `length >= 3` | 兩字母的標記資訊量太低且雜訊多 | `TS`、`V2` 被丟掉 |
| 不在 `NOISE` | 副檔名與容器格式不能識別版本 | `srt`、`mkv`、`www` |
| 不在 `LANGUAGE_TAGS` | 語言標記識別的是**翻譯**而不是**版本** | `cht`、`eng`、`dual` |

標點一律當分隔符，因為發行名稱混用它們：`x264-AMIABLE` 與 `x264.AMIABLE` 是同一版。

**範例**

```
Inception.2010.1080p.BluRay.x264-AMIABLE.mkv
→ inception, 2010, 1080p, bluray, x264, amiable
```

---

## 步驟 2：算 df（document frequency）

對桶內**每一筆候選**各切一份 token 集合，統計每個 token 出現在幾筆候選裡。

> 注意：df 是**在這個語言桶內**算的，不是全域。所以「罕見」永遠是相對於「這次有哪些選擇」。

---

## 步驟 3：算分

```js
for (const token of 候選的 tokens) {
  if (!videoTokens.has(token)) continue;        // 只看影片檔名也有的 token
  score += Math.log(1 + total / seen);          // total = 桶內候選數, seen = df
}
```

三個設計決定：

**只用「影片檔名也有」的 token。** 候選自己獨有的字（例如某版的 `RARBG`）不加分——
影片檔名裡沒有這個字，就代表無從確認。

**用 `log` 壓縮。** 若不壓縮，一個 df=1 的 token 權重會是 df=10 的十倍，單一字就能壓過整組證據。
取對數後權重落在 `log 2 ≈ 0.69`（人人都有）到 `log(1+N)`（只有它有）之間，是**平滑**的證據累積。

**用 `1 + total/seen` 而不是 `total/seen`。** 讓「每筆候選都有」的 token 仍得到 `log 2` 這個
小小的非零值，而不必為 `df = N` 特例處理。因為所有人拿到的這個常數一樣，排序結果不受影響。

權重級距（`N` = 桶內候選數）：

| token 類型 | df | N=4 時權重 | N=10 時權重 |
| --- | --- | --- | --- |
| 片名、年份（每筆都有） | = N | 0.69 | 0.69 |
| 片源類型（`BluRay`、`x264`） | N/2 | 1.10 | 1.70 |
| 發行組（`AMIABLE`） | 1 | 1.61 | 2.40 |

df 越小，權重成長越快——這正是「罕見字才有資訊」的數學形式。

---

## 步驟 4：排序

```js
scored.sort((a, b) => b.score - a.score || a.index - b.index);
```

分數高的在前；**同分時維持上游原始順序**（`a.index - b.index`）。
這是刻意的中性選擇：既然沒有證據分出高下，就不要自作主張重排。

---

## 步驟 5：`distinct`（也就是 `✓` 的依據）

```js
const rareLimit = Math.max(1, Math.ceil(total / 3));
if (seen <= rareLimit) distinct = true;
```

`distinct` 回答的是比「分數最高」更強的問題：**「這筆是不是可以被指認出來的版本？」**
條件是「它與影片檔名共用了至少一個只有少數候選才有的 token」。

`rareLimit = ceil(N/3)` 的用意是讓門檻隨選擇數量浮動：候選越多，標準越嚴。

`rankAndPick` 再補上兩個條件（見 `src/subtitles.js`）：

- 只有**第 1 名**會標 `✓`。
- **只有 1 筆候選時不標**（沒有可選的對象，標了不帶資訊），除非它是 hash 命中。

---

## 完整範例

影片：`Inception.2010.1080p.BluRay.x264-AMIABLE.mkv`
影片 tokens：`{inception, 2010, 1080p, bluray, x264, amiable}`

四筆候選（`N = 4`，`rareLimit = ceil(4/3) = 2`）：

| # | 候選 | tokens |
| --- | --- | --- |
| 0 | `Inception.2010.CAM.Xvid-LKRG` | inception, 2010, cam, xvid, lkrg |
| 1 | `Inception.2010.TS.V2.XVID.FEEL-FREE` | inception, 2010, xvid, feel, free |
| 2 | `Inception.2010.1080p.BluRay.x264-AMIABLE` | inception, 2010, 1080p, bluray, x264, amiable |
| 3 | `Inception.2010.720p.BluRay.x264-CROSSBOW` | inception, 2010, 720p, bluray, x264, crossbow |

（候選 1 的 `TS`、`V2` 因長度 < 3 被丟掉；`srt` 為 NOISE。）

df：`inception 4`、`2010 4`、`xvid 2`、`bluray 2`、`x264 2`、
`cam / lkrg / feel / free / 1080p / amiable / 720p / crossbow 各 1`

逐步計分（只列影片檔名也有的 token）：

| 候選 | 共用 token | 計算 | 分數 | distinct |
| --- | --- | --- | --- | --- |
| 2 AMIABLE | inception(4), 2010(4), 1080p(1), bluray(2), x264(2), amiable(1) | 0.69+0.69+1.61+1.10+1.10+1.61 | **6.80** | ✅ 1080p、amiable |
| 3 CROSSBOW | inception(4), 2010(4), bluray(2), x264(2) | 0.69+0.69+1.10+1.10 | **3.58** | ✅ bluray、x264 |
| 0 CAM | inception(4), 2010(4) | 0.69+0.69 | **1.39** | ❌ df 都 = 4 > 2 |
| 1 TS | inception(4), 2010(4) | 0.69+0.69 | **1.39** | ❌ 同上 |

排序結果：`2 (6.80)` → `3 (3.58)` → `0 (1.39)` → `1 (1.39)`

- 候選 0 與 1 同分，維持原始順序（0 在 1 之前）。
- 取前 3 筆 → AMIABLE、CROSSBOW、CAM。
- `✓` 標在第 1 名 AMIABLE。
- CROSSBOW 雖然也有 `distinct`，但不是第 1 名，所以不標。

注意 `CAM` 與 `TS` 各自帶有 `cam`、`feel`、`free` 等獨有字，但**影片檔名裡沒有這些字**，
所以完全不加分——這正是「只用交集」規則的作用。

---

## 性質與限制

**不需要任何清單。** 沒有維護發行組、編碼器或片源類型的名單；判斷完全由候選集合自己推導。
換一批候選，權重自動重算。

**df 是相對的。** 只有 2 筆候選時，兩筆都有的 token 權重是 `log 2`，只有一筆有的則是 `log 3`。
「罕見」是相對於這次的選擇，不是絕對標準。

**分數只用於排序，不設門檻。** 沒有任何「分數低於 X 就丟掉」的規則；
取幾筆完全由 `perLanguageLimit` 決定。唯一的門檻是 `distinct` 的 `rareLimit`，而它只影響 `✓`。

**沒有檔名時整個機制不作用。** `videoTokens` 為空集合，所有候選分數都是 0，
排序退化為「維持上游原始順序」。這是為什麼設定頁要顯示「最近收到的字幕請求」——
那裡沒有 `filename` 就代表這套排名實際上沒有在跑。

**來源不影響分數。** 分數只看版本名稱，所以不會偏好某個上游外掛；
跨來源的區分是靠標籤上的來源標記。

**同分不亂排。** 穩定排序保留上游順序，是刻意的保守選擇。

**這是啟發式，不是保證。** 若上游把版本名稱寫得很簡略（例如只有片名），
所有候選都會同分；此時 `✓` 不會出現，清單等於照原順序排列。
