"""
Retire le flag "executable stack" (PT_GNU_STACK exécutable) d'une bibliothèque
ELF 64 bits. La lib native de ctranslate2 porte ce flag, que certains noyaux
refusent au chargement ("cannot enable executable stack: Invalid argument" —
typiquement WSL2/Docker Desktop). Équivalent de `execstack -c` / `patchelf
--clear-execstack`, sans dépendance (utilisé au build de l'image, voir
Dockerfile).

Usage: python clear_execstack.py LIB.so [LIB2.so ...]
"""

import struct
import sys

PT_GNU_STACK = 0x6474E551
PF_X = 0x1


def clear(path: str) -> None:
    with open(path, "r+b") as f:
        data = bytearray(f.read(64))
        if data[:4] != b"\x7fELF" or data[4] != 2:  # ELF magic, 64-bit
            raise SystemExit(f"{path}: not a 64-bit ELF file")
        e_phoff = struct.unpack_from("<Q", data, 0x20)[0]
        e_phentsize = struct.unpack_from("<H", data, 0x36)[0]
        e_phnum = struct.unpack_from("<H", data, 0x38)[0]
        for i in range(e_phnum):
            off = e_phoff + i * e_phentsize
            f.seek(off)
            hdr = f.read(8)
            p_type, p_flags = struct.unpack("<II", hdr)
            if p_type == PT_GNU_STACK and p_flags & PF_X:
                f.seek(off + 4)
                f.write(struct.pack("<I", p_flags & ~PF_X))
                print(f"{path}: cleared executable-stack flag")
                return
    print(f"{path}: no executable-stack flag set (nothing to do)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    for lib in sys.argv[1:]:
        clear(lib)
