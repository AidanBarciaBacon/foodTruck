// The "Charge me" card: a red screen with white block letters, made by the truck itself with no download.
//
// It is produced one row at a time (400 bytes), so it needs no frame buffer: main.cpp asks for row 0, sends it
// to the screen, asks for row 1, and so on. The letters come from a small 5 x 7 dot font, scaled up, that
// holds only the characters the two lines use.
//
// No hardware in here: the host-side test draws the card to a picture file so it can be looked at.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "truck_logic.h"

namespace truck {

struct Glyph {
  char ch;
  uint8_t rows[7];   // top to bottom; bit 4 (0x10) is the left-hand dot
};

// 5 x 7 dots per character.
static const Glyph CARD_FONT[] = {
    {' ', {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}},
    {'-', {0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00}},
    {'A', {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}},
    {'B', {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E}},
    {'C', {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E}},
    {'E', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F}},
    {'G', {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F}},
    {'H', {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}},
    {'M', {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11}},
    {'P', {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10}},
    {'R', {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11}},
    {'S', {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E}},
    {'U', {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E}},
    {'a', {0x00, 0x00, 0x0E, 0x01, 0x0F, 0x11, 0x0F}},
    {'b', {0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x1E}},
    {'c', {0x00, 0x00, 0x0E, 0x10, 0x10, 0x11, 0x0E}},
    {'d', {0x01, 0x01, 0x0D, 0x13, 0x11, 0x11, 0x0F}},
    {'e', {0x00, 0x00, 0x0E, 0x11, 0x1F, 0x10, 0x0E}},
    {'g', {0x00, 0x0F, 0x11, 0x11, 0x0F, 0x01, 0x0E}},
    {'h', {0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x11}},
    {'i', {0x04, 0x00, 0x0C, 0x04, 0x04, 0x04, 0x0E}},
    {'k', {0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12}},
    {'l', {0x0C, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E}},
    {'n', {0x00, 0x00, 0x16, 0x19, 0x11, 0x11, 0x11}},
    {'t', {0x08, 0x08, 0x1C, 0x08, 0x08, 0x09, 0x06}},
    {'u', {0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0D}},
};

// The dots of one character; a character the font lacks comes out as a solid block, so a mistake shows.
inline const uint8_t* cardGlyph(char ch) {
  static const uint8_t missing[7] = {0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F};
  for (size_t i = 0; i < sizeof(CARD_FONT) / sizeof(CARD_FONT[0]); ++i) {
    if (CARD_FONT[i].ch == ch) return CARD_FONT[i].rows;
  }
  return missing;
}

struct CardLine {
  const char* text;
  int scale;   // screen pixels per font dot
  int top;     // y of the line's first row
};

// "CHARGE ME" is 636 x 84 pixels; the second line is 609 x 21. Both are centred left to right.
static const CardLine CHARGE_CARD_LINES[] = {
    {"CHARGE ME", 12, 152},
    {"Plug in the USB-C lead at the back", 3, 296},
};

inline int cardLineWidth(const CardLine& line) {
  return ((int)strlen(line.text) * 6 - 1) * line.scale;   // 5 dots a character and 1 between
}

// Fills `row` (ROW_BYTES bytes) with row `y` of the card, y = 0 at the top.
inline void chargeCardRow(int y, uint8_t* row) {
  memset(row, (RED << 4) | RED, ROW_BYTES);
  for (size_t i = 0; i < sizeof(CHARGE_CARD_LINES) / sizeof(CHARGE_CARD_LINES[0]); ++i) {
    const CardLine& line = CHARGE_CARD_LINES[i];
    if (y < line.top || y >= line.top + 7 * line.scale) continue;
    const int dotRow = (y - line.top) / line.scale;
    const int left = (FRAME_W - cardLineWidth(line)) / 2;
    const int count = (int)strlen(line.text);
    for (int c = 0; c < count; ++c) {
      const uint8_t bits = cardGlyph(line.text[c])[dotRow];
      for (int dot = 0; dot < 5; ++dot) {
        if (!(bits & (0x10 >> dot))) continue;
        const int x0 = left + (c * 6 + dot) * line.scale;
        for (int x = x0; x < x0 + line.scale; ++x) {
          if (x >= 0 && x < FRAME_W) setPixel(row, x, WHITE);
        }
      }
    }
  }
}

}  // namespace truck
