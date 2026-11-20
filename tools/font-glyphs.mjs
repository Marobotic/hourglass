// Read a TrueType Unicode cmap without OS font fallback hiding missing icons.
export function glyphId(font, codepoint) {
  let cmap;
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    if (font.toString('ascii', at, at + 4) === 'cmap') cmap = font.readUInt32BE(at + 8);
  }
  if (cmap === undefined) return 0;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const entry = cmap + 4 + i * 8, platform = font.readUInt16BE(entry);
    if (platform !== 0 && platform !== 3) continue;
    const sub = cmap + font.readUInt32BE(entry + 4), format = font.readUInt16BE(sub);
    if (format === 12) {
      for (let j = 0; j < font.readUInt32BE(sub + 12); j++) {
        const group = sub + 16 + j * 12;
        const start = font.readUInt32BE(group), end = font.readUInt32BE(group + 4);
        if (codepoint >= start && codepoint <= end) return font.readUInt32BE(group + 8) + codepoint - start;
      }
    } else if (format === 4 && codepoint <= 0xffff) {
      const count = font.readUInt16BE(sub + 6) / 2;
      for (let j = 0; j < count; j++) {
        const end = font.readUInt16BE(sub + 14 + j * 2), start = font.readUInt16BE(sub + 16 + count * 2 + j * 2);
        if (codepoint < start || codepoint > end) continue;
        const delta = font.readInt16BE(sub + 16 + count * 4 + j * 2);
        const location = sub + 16 + count * 6 + j * 2, offset = font.readUInt16BE(location);
        if (!offset) return (codepoint + delta) & 0xffff;
        const id = font.readUInt16BE(location + offset + (codepoint - start) * 2);
        return id ? (id + delta) & 0xffff : 0;
      }
    }
  }
  return 0;
}
