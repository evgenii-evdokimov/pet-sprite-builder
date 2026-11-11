import os
import sys
import subprocess

base = os.path.dirname(os.path.abspath(sys.executable))
core = os.path.join(base, "PetSpriteBuilderCore.exe")

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_BREAKAWAY_FROM_JOB = 0x01000000

try:
    subprocess.Popen(
        [core, "--no-sandbox"] + sys.argv[1:],
        cwd=base,
        close_fds=True,
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB,
    )
except Exception as exc:  # noqa: BLE001
    import ctypes

    ctypes.windll.user32.MessageBoxW(
        0,
        f"Не удалось запустить приложение.\n\n{core}\n\n{exc}",
        "Pet Sprite Builder",
        0x10,
    )
