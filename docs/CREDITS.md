# Credits

Font attributions required by plan §6.5 / M3.1. In-game credits (M8.3) reuse this list.

## Hershey vector fonts

The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U.S. National Bureau of Standards.

The packed JHF format of the font data in `scripts/fonts/rowmans.jhf` and `scripts/fonts/rowmand.jhf` was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821 (`mit-eddie!ci-dandelion!hurt`).

This distribution may be used by anyone for any purpose, commercial or otherwise, providing those acknowledgements travel with the font data. The data must not be converted into the format distributed by the U.S. NTIS.

Runtime strokes (`public/fonts/hershey/simplex.bin.gz`) are a converted form of the Usenet / `hershey-fonts` roman simplex (rowmans) alphabet, ASCII 32–126. Duplex (rowmand) is generated as a unit-test fixture. Conversion: `scripts/convert-fonts.mjs`.

## Px437 IBM CGA / IBM BIOS (CC BY-SA 4.0)

Terminal and teletext bitmaps are **Px437 IBM CGA** and **Px437 IBM BIOS** from [The Ultimate Oldschool PC Font Pack](https://int10h.org/oldschool-pc-fonts/) by VileR.

- License: [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
- Source: https://int10h.org/oldschool-pc-fonts/
- This project embeds a derived 8×8 atlas generated at runtime from the public-domain IBM 8×8 ROM dump in `scripts/fonts/font8x8_basic.h` (Marcel Sondaar / Daniel Hepper; based on IBM VGA/BIOS glyphs). ASCII 32–126 of CGA and BIOS match for that range.
- Adaptation: packed into a nearest-neighbour WebGL `DataTexture` (16×8 cells). ShareAlike: the ROM packing in `BitmapText.ts` is offered under CC BY-SA 4.0 as well.

## VFD 7- and 14-segment glyphs

Procedural. In-house (plan §6.5).
