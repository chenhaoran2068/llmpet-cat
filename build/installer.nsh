; Remove the Windows login item created through Electron's setLoginItemSettings
; when the user uninstalls LLMPET Cat. This is intentionally scoped to this app.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.myunwang.llmpetcat"
!macroend
