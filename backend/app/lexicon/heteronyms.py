"""Words spelled the same but said differently depending on meaning (lead the metal / lead the verb).

Entries use the CMU dictionary's own spelling of each variant (so a few differ from textbook IPA: the noun "refuse" ends in Z there).
Each entry: (part of speech, meaning keywords or None, ARPAbet). The first entry whose part of speech
matches and whose keywords appear in the meaning's definition wins. Every pronunciation here is checked
against the CMU dictionary by a test, so this table cannot drift away from the data.
"""

HETERONYMS: dict[str, list[tuple[str, tuple[str, ...] | None, str]]] = {
    "lead": [("n", ("metal", "element"), "L EH1 D"), ("n", None, "L IY1 D"), ("v", None, "L IY1 D")],
    "wind": [("v", None, "W AY1 N D"), ("n", None, "W IH1 N D")],
    "tear": [("n", ("rip", "hole", "split", "torn", "tear in"), "T EH1 R"), ("n", None, "T IH1 R"), ("v", None, "T EH1 R")],
    "bass": [("n", ("fish", "perch", "genus", "freshwater", "salt-water"), "B AE1 S"), ("n", None, "B EY1 S"), ("a", None, "B EY1 S")],
    "live": [("v", None, "L IH1 V"), ("a", None, "L AY1 V"), ("r", None, "L AY1 V")],
    "close": [("v", None, "K L OW1 Z"), ("n", None, "K L OW1 Z"), ("a", None, "K L OW1 S"), ("r", None, "K L OW1 S")],
    "record": [("n", None, "R EH1 K ER0 D"), ("v", None, "R IH0 K AO1 R D")],
    "object": [("n", None, "AA1 B JH EH0 K T"), ("v", None, "AH0 B JH EH1 K T")],
    "content": [("n", None, "K AA1 N T EH0 N T"), ("a", None, "K AH0 N T EH1 N T")],
    "present": [("v", None, "P R IY0 Z EH1 N T"), ("n", None, "P R EH1 Z AH0 N T"), ("a", None, "P R EH1 Z AH0 N T")],
    "produce": [("v", None, "P R AH0 D UW1 S"), ("n", None, "P R OW1 D UW0 S")],
    "refuse": [("v", None, "R IH0 F Y UW1 Z"), ("n", None, "R EH1 F Y UW2 Z")],
    "desert": [("n", None, "D EH1 Z ER0 T"), ("v", None, "D IH0 Z ER1 T")],
    "minute": [("n", None, "M IH1 N AH0 T"), ("a", None, "M AY0 N UW1 T")],
    "permit": [("n", None, "P ER1 M IH2 T"), ("v", None, "P ER0 M IH1 T")],
    "subject": [("v", None, "S AH0 B JH EH1 K T"), ("n", None, "S AH1 B JH IH0 K T"), ("a", None, "S AH1 B JH IH0 K T")],
    "project": [("v", None, "P R AH0 JH EH1 K T"), ("n", None, "P R AA1 JH EH0 K T")],
    "conduct": [("v", None, "K AA0 N D AH1 K T"), ("n", None, "K AA1 N D AH0 K T")],
    "bow": [("n", ("weapon", "ribbon", "archery", "knot", "violin", "cello"), "B OW1"), ("n", None, "B AW1"), ("v", None, "B AW1")],
    "row": [("n", None, "R OW1"), ("v", None, "R OW1")],  # the "argument" meaning (rhymes with cow) is not in the dictionary
    "sow": [("v", None, "S OW1"), ("n", None, "S AW1")],
    "wound": [("n", None, "W UW1 N D"), ("v", ("injure", "hurt", "damage"), "W UW1 N D")],
}  # fmt: skip


def said_as(word: str, pos: str, definition: str) -> str | None:
    """ARPAbet for this meaning of `word`, or None if the word is not a known heteronym."""
    for p, hints, phones in HETERONYMS.get(word.lower(), []):
        if p != pos:
            continue
        if hints is None or any(h in definition.lower() for h in hints):
            return phones
    return None
