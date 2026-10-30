# Fanance 理財

個人用粵語（繁體香港）理財網頁 App：總覽、記帳、固定開支、卡數、Google Drive 同步。  
**無 Excel、無後端**；資料存在瀏覽器 `localStorage`，可選同步到 Drive 檔 `fanance-data.json`。

## 快速開始（演示／本機）

```bash
cd fanance-app
./serve.sh          # 預設 port 8765
# 或：python3 -m http.server 8765
```

瀏覽器打開 `http://127.0.0.1:8765/`。  
未填 Google Client ID 時會自動走 **演示模式**（純本機，功能齊全）。

手機同 Wi‑Fi：用電腦區網 IP（例如 `http://192.168.x.x:8765`）。  
「加入主畫面」：Safari／Chrome → 分享 → 加入主畫面（已有 `manifest.json`）。

## 一次過：Google Cloud OAuth（要 Drive 同步先做）

1. 去 [Google Cloud Console](https://console.cloud.google.com/) 開一個專案（或用現有）。
2. **啟用 API**：APIs & Services → Library → 搜尋 **Google Drive API** → Enable。
3. **OAuth 同意畫面**：APIs & Services → OAuth consent screen  
   - User type：External（個人用）或 Internal（Workspace）  
   - App name：`Fanance`；加自己電郵做測試用戶（Testing 階段必須）。
4. **建立憑證**：Credentials → Create credentials → **OAuth client ID**  
   - Application type：**Web application**  
   - Name：`Fanance Web`  
   - **Authorized JavaScript origins**（重要）：  
     - 本機：`http://localhost:8765`、`http://127.0.0.1:8765`  
     - 正式站：你的 HTTPS 網域，例如 `https://your-domain.com`  
     - （唔好加 path；origin 只有協議+主機+port）  
   - Authorized redirect URIs：GIS token client 一般可留空；若 Console 要求可填同一 origin。
5. 複製 **Client ID**（形如 `xxxx.apps.googleusercontent.com`）。
6. 喺專案目錄：

```bash
cp config.example.js config.js
# 編輯 config.js，填入 GOOGLE_CLIENT_ID，DEMO_MODE 設 false
```

7. 用 **HTTPS** 或 **localhost** 打開 App → 設定 → **登入 Google** → **立即同步**。  
   首次會喺 Drive 建立資料夾 `Fanance` 同檔案 `fanance-data.json`（scope：`drive.file`，只存取 App 建立／打開過嘅檔）。

### 注意

- OAuth **唔支援**普通 `http://區網IP`（非 localhost）；手機正式同步請用 HTTPS 託管，或電腦用 localhost。
- `config.js` 已列入 `.gitignore`，唔好 commit Client ID 都冇問題，但仍然唔好公開亂 post。
- 同步策略：**last-write-wins**（比較 JSON 內 `updatedAt`）；本地改完會 debounce 約 1.5 秒自動 push。

## 檔案結構

| 檔案 | 說明 |
|------|------|
| `index.html` | 單頁殼 |
| `styles.css` / `app.js` | UI 同邏輯 |
| `config.js` | 你的 Client ID（由 example 複製） |
| `data/seed.json` | 初始種子資料 |
| `manifest.json` / `sw.js` | PWA／離線殼 |
| `serve.sh` | 簡易靜態伺服器 |

## 功能摘要

- **總覽**：估計每月剩錢、`takeHome − 固定 − 分期`、對 HK$8,000 目標進度、14 日內到期
- **記帳**：金額 → 類別 chip → 戶口 chip（≤3 tap）、最近列表可改刪
- **固定／卡數**：訂閱同分期管理
- **設定**：Google 登入／同步、匯出匯入 JSON、重設本地快取

個人用途 only。祝理財順利。
