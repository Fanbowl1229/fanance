// 複製此檔為 config.js，填入你的 Google OAuth Web Client ID
// config.js 唔好 commit（見 .gitignore）
window.FANANCE_CONFIG = {
  // Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Web application
  GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  // Authorized JavaScript origins（必須）：
  //   https://YOURUSER.github.io
  // Authorized redirect URIs（全頁登入／彈窗被擋時必須）：
  //   https://YOURUSER.github.io/fanance/
  //   https://YOURUSER.github.io/fanance/index.html
  // Drive 檔名（用 drive.file scope 建立／搵）
  DRIVE_FILE_NAME: "fanance-data.json",
  DRIVE_FOLDER_NAME: "Fanance",
  // Optional: override OAuth redirect URI (default = this page's directory URL)
  // OAUTH_REDIRECT_URI: "https://YOURUSER.github.io/fanance/",
  // 演示模式：無 Client ID 時自動啟用，只用 localStorage
  DEMO_MODE: false
};
