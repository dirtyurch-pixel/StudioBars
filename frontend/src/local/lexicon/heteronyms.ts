/** Words spelled the same but said differently by meaning. Copied from backend/app/lexicon/heteronyms.py (a test checks they match). */
export const HETERONYMS: Record<string, [string, string[] | null, string][]> = {
  lead: [
    ['n', ['metal', 'element'], 'L EH1 D'],
    ['n', null, 'L IY1 D'],
    ['v', null, 'L IY1 D'],
  ],
  wind: [
    ['v', null, 'W AY1 N D'],
    ['n', null, 'W IH1 N D'],
  ],
  tear: [
    ['n', ['rip', 'hole', 'split', 'torn', 'tear in'], 'T EH1 R'],
    ['n', null, 'T IH1 R'],
    ['v', null, 'T EH1 R'],
  ],
  bass: [
    ['n', ['fish', 'perch', 'genus', 'freshwater', 'salt-water'], 'B AE1 S'],
    ['n', null, 'B EY1 S'],
    ['a', null, 'B EY1 S'],
  ],
  live: [
    ['v', null, 'L IH1 V'],
    ['a', null, 'L AY1 V'],
    ['r', null, 'L AY1 V'],
  ],
  close: [
    ['v', null, 'K L OW1 Z'],
    ['n', null, 'K L OW1 Z'],
    ['a', null, 'K L OW1 S'],
    ['r', null, 'K L OW1 S'],
  ],
  record: [
    ['n', null, 'R EH1 K ER0 D'],
    ['v', null, 'R IH0 K AO1 R D'],
  ],
  object: [
    ['n', null, 'AA1 B JH EH0 K T'],
    ['v', null, 'AH0 B JH EH1 K T'],
  ],
  content: [
    ['n', null, 'K AA1 N T EH0 N T'],
    ['a', null, 'K AH0 N T EH1 N T'],
  ],
  present: [
    ['v', null, 'P R IY0 Z EH1 N T'],
    ['n', null, 'P R EH1 Z AH0 N T'],
    ['a', null, 'P R EH1 Z AH0 N T'],
  ],
  produce: [
    ['v', null, 'P R AH0 D UW1 S'],
    ['n', null, 'P R OW1 D UW0 S'],
  ],
  refuse: [
    ['v', null, 'R IH0 F Y UW1 Z'],
    ['n', null, 'R EH1 F Y UW2 Z'],
  ],
  desert: [
    ['n', null, 'D EH1 Z ER0 T'],
    ['v', null, 'D IH0 Z ER1 T'],
  ],
  minute: [
    ['n', null, 'M IH1 N AH0 T'],
    ['a', null, 'M AY0 N UW1 T'],
  ],
  permit: [
    ['n', null, 'P ER1 M IH2 T'],
    ['v', null, 'P ER0 M IH1 T'],
  ],
  subject: [
    ['v', null, 'S AH0 B JH EH1 K T'],
    ['n', null, 'S AH1 B JH IH0 K T'],
    ['a', null, 'S AH1 B JH IH0 K T'],
  ],
  project: [
    ['v', null, 'P R AH0 JH EH1 K T'],
    ['n', null, 'P R AA1 JH EH0 K T'],
  ],
  conduct: [
    ['v', null, 'K AA0 N D AH1 K T'],
    ['n', null, 'K AA1 N D AH0 K T'],
  ],
  bow: [
    ['n', ['weapon', 'ribbon', 'archery', 'knot', 'violin', 'cello'], 'B OW1'],
    ['n', null, 'B AW1'],
    ['v', null, 'B AW1'],
  ],
  row: [
    ['n', null, 'R OW1'],
    ['v', null, 'R OW1'],
  ],
  sow: [
    ['v', null, 'S OW1'],
    ['n', null, 'S AW1'],
  ],
  wound: [
    ['n', null, 'W UW1 N D'],
    ['v', ['injure', 'hurt', 'damage'], 'W UW1 N D'],
  ],
}

export function saidAs(word: string, pos: string, definition: string): string | null {
  for (const [p, hints, phones] of HETERONYMS[word.toLowerCase()] ?? []) {
    if (p !== pos) continue
    if (hints === null || hints.some((h) => definition.toLowerCase().includes(h))) return phones
  }
  return null
}
