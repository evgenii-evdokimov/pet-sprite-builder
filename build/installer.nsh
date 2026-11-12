; Имя папки установки не зависит от имени exe-ядра (executableName).
!undef APP_FILENAME
!define APP_FILENAME "Pet Sprite Builder"

!macro customInstall
  CreateShortCut "$DESKTOP\Pet Sprite Builder.lnk" "$INSTDIR\Pet Sprite Builder.exe" "" "$INSTDIR\Pet Sprite Builder.exe" 0
  CreateShortCut "$SMPROGRAMS\Pet Sprite Builder.lnk" "$INSTDIR\Pet Sprite Builder.exe" "" "$INSTDIR\Pet Sprite Builder.exe" 0

  ; В старых сборках папки данных могли получить Low-целостность.
  ; Возвращаем обычный уровень, чтобы не оставалось ограничений записи.
  CreateDirectory "$APPDATA\pet-sprite-builder"
  CreateDirectory "$LOCALAPPDATA\PetSpriteBuilder"
  CreateDirectory "$LOCALAPPDATA\PetSpriteBuilder\bundles"
  nsExec::ExecToLog 'icacls "$APPDATA\pet-sprite-builder" /setintegritylevel (OI)(CI)Medium /T /C'
  Pop $0
  nsExec::ExecToLog 'icacls "$LOCALAPPDATA\PetSpriteBuilder" /setintegritylevel (OI)(CI)Medium /T /C'
  Pop $0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Pet Sprite Builder.lnk"
  Delete "$SMPROGRAMS\Pet Sprite Builder.lnk"
!macroend
