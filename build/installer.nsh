!macro customInstall
  CreateShortCut "$DESKTOP\Pet Sprite Builder.lnk" "$INSTDIR\Pet Sprite Builder.exe" "--no-sandbox" "$INSTDIR\Pet Sprite Builder.exe" 0
  CreateShortCut "$SMPROGRAMS\Pet Sprite Builder.lnk" "$INSTDIR\Pet Sprite Builder.exe" "--no-sandbox" "$INSTDIR\Pet Sprite Builder.exe" 0

  ; Приложение запускает Chromium с --no-sandbox и на системах с повышенными
  ; правами процесса работает на низком уровне целостности. Поэтому папки
  ; данных делаем Low, иначе запись кэшей/черновика/bundle запрещена.
  CreateDirectory "$APPDATA\pet-sprite-builder"
  CreateDirectory "$LOCALAPPDATA\PetSpriteBuilder"
  CreateDirectory "$LOCALAPPDATA\PetSpriteBuilder\bundles"
  nsExec::ExecToLog 'icacls "$APPDATA\pet-sprite-builder" /setintegritylevel (OI)(CI)Low /T /C'
  Pop $0
  nsExec::ExecToLog 'icacls "$LOCALAPPDATA\PetSpriteBuilder" /setintegritylevel (OI)(CI)Low /T /C'
  Pop $0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Pet Sprite Builder.lnk"
  Delete "$SMPROGRAMS\Pet Sprite Builder.lnk"
!macroend
