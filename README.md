# Fanance

個人用粵語理財網頁 App（演示種子資料）。真實帳目請在 App 內自行輸入，並用 Google Drive 同步；**唔好**把真實財務 commit 入公開 repo。

## 網址

GitHub Pages：部署後為 `https://<user>.github.io/fanance/`

## 本機

```bash
python3 -m http.server 8765
```

## Google Drive 同步

見 `config.example.js`：填 `GOOGLE_CLIENT_ID`，`DEMO_MODE: false`，並將 Authorized JavaScript origins 加上本站 HTTPS origin。
