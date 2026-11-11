!macro customInstall
  CreateShortCut "$DESKTOP\Pet Sprite Builder.lnk" "$INSTDIR\Pet Sprite Builder.exe" "" "$INSTDIR\Pet Sprite Builder.exe" 0
  CreateShortCut "$SMPROGRAMS\Pet Sprite Builder.lnk" "$INSTDIR\Pet Sprite Builder.exe" "" "$INSTDIR\Pet Sprite Builder.exe" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Pet Sprite Builder.lnk"
  Delete "$SMPROGRAMS\Pet Sprite Builder.lnk"
!macroend
