// 16x16 pixel-art icons rendered as crisp inline SVG. One character per pixel.
const PALETTE = {
  k: '#000000',
  w: '#ffffff',
  g: '#c0c0c0',
  d: '#808080',
  y: '#ffff00',
  o: '#c0a000',
  b: '#000080',
  c: '#00a0a0',
  r: '#ff0000',
  m: '#800000',
  e: '#00c000',
};

const ART = {
  folder: [
    '................',
    '................',
    '..kkkkk.........',
    '.kyyyyyk........',
    'kyyyyyyykkkkkkk.',
    'kywwwwwwwwwwwwok',
    'kywyyyyyyyyyyyok',
    'kywyyyyyyyyyyyok',
    'kywyyyyyyyyyyyok',
    'kywyyyyyyyyyyyok',
    'kywyyyyyyyyyyyok',
    'kywyyyyyyyyyyyok',
    'kyoooooooooooook',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  text: [
    '...kkkkkkkkk....',
    '...kwwwwwwwkk...',
    '...kwwwwwwwkwk..',
    '...kwkkkkwwkkkk.',
    '...kwwwwwwwwwwk.',
    '...kwkkkkkkkkwk.',
    '...kwwwwwwwwwwk.',
    '...kwkkkkkkkkwk.',
    '...kwwwwwwwwwwk.',
    '...kwkkkkkkkkwk.',
    '...kwwwwwwwwwwk.',
    '...kwkkkkkkwwwk.',
    '...kwwwwwwwwwwk.',
    '...kwwwwwwwwwwk.',
    '...kkkkkkkkkkkk.',
    '................',
  ],
  corrupt: [
    '...kkkkkkkkk....',
    '...kwwrwwwwkk...',
    '...kwkrkwwwkwk..',
    '...kwwwrrwwkkkk.',
    '...kwkkkkrkkkwk.',
    '...kwwwwwwrwwwk.',
    '...kmkkkrkkkkwk.',
    '...kwmwwrwwwwwk.',
    '...kwkmkrkkkkwk.',
    '...kwwwmwrwwwwk.',
    '...kwkkkmkrkkwk.',
    '...kwwwwwmwrwwk.',
    '...kwkkkkkmkrwk.',
    '...kwwwwwwwmwwk.',
    '...kkkkkkkkkkkk.',
    '................',
  ],
  backup: [
    '...kkkkkkkkk....',
    '...kgggggggkk...',
    '...kgdddgggkgk..',
    '...kgggggggkkkk.',
    '...kgddddddddgk.',
    '...kggggggggggk.',
    '...kgddddddddgk.',
    '...kggggggggggk.',
    '...kgggkkkkgggk.',
    '...kggkwwwwkggk.',
    '...kggkwkkwkggk.',
    '...kggkwwwwkggk.',
    '...kgggkkkkgggk.',
    '...kggggggggggk.',
    '...kkkkkkkkkkkk.',
    '................',
  ],
  system: [
    '................',
    '..kkkkkkkkkkkk..',
    '..kbbbbbbbbbbk..',
    '..kbwwbbbbbbbk..',
    '..kbbbbbbbbbbk..',
    '..kbwwwwbbbbbk..',
    '..kbbbbbbbbbbk..',
    '..kbwwwbbbbbbk..',
    '..kkkkkkkkkkkk..',
    '..kggggggggggk..',
    '..kgddgggggegk..',
    '..kggggggggggk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
  ],
  drive: [
    '................',
    '................',
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    'kwwwwwwwwwwwwwgk',
    'kwggggggggggggdk',
    'kwgggggggggegddk',
    'kwggggggggggggdk',
    'kgdddddddddddddk',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  bin: [
    '................',
    '.....kkkkkk.....',
    '...kkggggggkk...',
    '..kwwwwwwwwwwk..',
    '..kkkkkkkkkkkk..',
    '...kwgwgwgwgk...',
    '...kwgwgwgwgk...',
    '...kwgwgwgwgk...',
    '...kwgwgwgwgk...',
    '...kwgwgwgwgk...',
    '...kwgwgwgwgk...',
    '...kwgwgwgwgk...',
    '....kgwgwgwk....',
    '....kkkkkkkk....',
    '................',
    '................',
  ],
};

const cache = new Map();

export const iconSvg = (name) => {
  if (cache.has(name)) return cache.get(name);
  const rows = ART[name] ?? ART.text;
  let rects = '';
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (PALETTE[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[ch]}"/>`;
    });
  });
  const svg = `<svg class="px-icon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  cache.set(name, svg);
  return svg;
};

export const iconFor = (file) => {
  if (!file) return 'text';
  if (file.id === 'drive') return 'drive';
  if (file.id === 'recycled') return 'bin';
  if (file.type === 'folder') return 'folder';
  if (file.locked && file.puzzleId) return 'corrupt';
  if (file.locked) return 'backup';
  if (/\.(BAT|SYS|EXE|COM)$/.test(file.name)) return 'system';
  return 'text';
};

export const typeLabel = (file) => {
  if (file.type === 'folder') return 'File Folder';
  if (file.locked && file.puzzleId) return 'Corrupted';
  const ext = file.name.split('.')[1] ?? '';
  return (
    { TXT: 'Text Document', DAT: 'Data File', BAT: 'MS-DOS Batch File', SYS: 'System File', BAK: 'Backup File', DOC: 'Document', EXE: 'Application', DB: 'Database', LOG: 'Log File' }[ext] ??
    `${ext || 'Unknown'} File`
  );
};
