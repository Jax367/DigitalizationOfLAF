!macro customInstall
  CreateShortCut "$DESKTOP\失物招领编辑管理.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--editor"
!macroend
!macro customUnInstall
  Delete "$DESKTOP\失物招领编辑管理.lnk"
!macroend
