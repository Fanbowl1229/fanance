// 複製此檔為 config.js，填入你的 Google OAuth Web Client ID
// config.js 唔好 commit（見 .gitignore）
window.FANANCE_CONFIG = {
  // Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Web application
  GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  // Drive 檔名（用 drive.file scope 建立／搵）
  DRIVE_FILE_NAME: "fanance-data.json",
  DRIVE_FOLDER_NAME: "Fanance",
  // 演示模式：無 Client ID 時自動啟用，只用 localStorage
  DEMO_MODE: false
};
