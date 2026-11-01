"""Plain-text / Markdown / JSON conversion. Pure functions, no database."""

import json
import re
from dataclasses import dataclass, field

from .schemas import MAX_LINE_CHARS, MAX_LINES_PER_SONG, MAX_SECTIONS

SECTION_WORDS = r"(intro|verse|pre[- ]?chorus|chorus|hook|bridge|outro)"
BRACKET = re.compile(r"^\s*\[(.+?)\]\s*$")
MD_HEAD = re.compile(r"^\s*(#{1,6})\s+(.+?)\s*#*\s*$")
WORD_HEAD = re.compile(rf"^\s*({SECTION_WORDS}(?:\s+\d+)?)\s*:\s*$", re.IGNORECASE)


class ParseError(ValueError):
    pass


@dataclass
class ParsedLine:
    text: str
    is_locked: bool = False
    comments: list[str] = field(default_factory=list)


@dataclass
class ParsedSection:
    label: str
    section_type: str
    lines: list[ParsedLine]


@dataclass
class ParsedSong:
    title: str | None
    sections: list[ParsedSection]
    genres: list[str] = field(default_factory=list)
    bpm: int | None = None
    time_signature: str | None = None
    concept: str = ""
    mood: str = ""
    point_of_view: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def line_count(self) -> int:
        return sum(len(s.lines) for s in self.sections)


def infer_type(label: str) -> str:
    low = label.lower().strip()
    if re.match(r"^pre[- ]?chorus", low):
        return "pre-chorus"
    for t in ("intro", "verse", "chorus", "hook", "bridge", "outro"):
        if low.startswith(t):
            return t
    return "custom"


def _finish(sections: list[ParsedSection]) -> list[ParsedSection]:
    """Trim blank lines at the ends of each section; drop sections left empty."""
    out = []
    for s in sections:
        lines = s.lines
        while lines and not lines[-1].text.strip():
            lines.pop()
        while lines and not lines[0].text.strip():
            lines.pop(0)
        if lines:
            out.append(ParsedSection(s.label, s.section_type, lines))
    return out


def parse_text(content: str, fmt: str) -> ParsedSong:
    text = content.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = text.split("\n")
    title: str | None = None
    sections: list[ParsedSection] = []
    current: ParsedSection | None = None
    warnings: list[str] = []
    saw_header = False

    for idx, raw in enumerate(raw_lines):
        line = raw.rstrip()
        header: str | None = None
        m_md = MD_HEAD.match(line) if fmt == "md" else None
        if m_md:
            level, label = len(m_md.group(1)), m_md.group(2).strip()
            if level == 1 and title is None and not sections and current is None:
                title = label
                continue
            header = label
        elif BRACKET.match(line):
            header = BRACKET.match(line).group(1).strip()  # type: ignore[union-attr]
        elif WORD_HEAD.match(line):
            header = WORD_HEAD.match(line).group(1).strip()  # type: ignore[union-attr]
        if header is not None:
            saw_header = True
            current = ParsedSection(header[:60], infer_type(header), [])
            sections.append(current)
            continue
        if current is None and not line.strip():
            continue  # leading blank lines never start a section
        if fmt == "md" and current is None and re.match(r"^(Genres|BPM):", line):
            continue  # metadata block written by our own Markdown export
        if len(line) > MAX_LINE_CHARS:
            raise ParseError(f"Line {idx + 1} is longer than {MAX_LINE_CHARS} characters.")
        if current is None:
            current = ParsedSection("Section 1", "custom", [])
            sections.append(current)
        current.lines.append(ParsedLine(line))

    if not saw_header:
        # No headers at all: blank lines separate sections.
        blocks: list[list[str]] = [[]]
        for pl in (ln for s in sections for ln in s.lines):
            if pl.text.strip():
                blocks[-1].append(pl.text)
            elif blocks[-1]:
                blocks.append([])
        blocks = [b for b in blocks if b]
        sections = [
            ParsedSection(f"Section {i + 1}", "custom", [ParsedLine(t) for t in b])
            for i, b in enumerate(blocks)
        ]
        if len(sections) > 1:
            warnings.append("No section headers found, so blank lines were used to split sections.")
        else:
            warnings.append("No section headers found; everything is in one section.")

    sections = _finish(sections)
    _check_limits(sections)
    if not sections:
        raise ParseError("No lyrics were found in that text.")
    return ParsedSong(title=title, sections=sections, warnings=warnings)


def _check_limits(sections: list[ParsedSection]) -> None:
    if len(sections) > MAX_SECTIONS:
        raise ParseError(f"Too many sections (limit {MAX_SECTIONS}).")
    if sum(len(s.lines) for s in sections) > MAX_LINES_PER_SONG:
        raise ParseError(f"Too many lines (limit {MAX_LINES_PER_SONG}).")


def parse_json(content: str) -> ParsedSong:
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ParseError(f"That is not valid JSON ({e.msg}).") from e
    if not isinstance(data, dict) or data.get("format") != "studio-bars-song":
        raise ParseError("This JSON is not a Studio Bars song export.")
    if data.get("schema_version") != 1:
        raise ParseError("Unsupported export version.")
    try:
        song = data["song"]
        sections = []
        for s in data["sections"]:
            lines = []
            for ln in s["lines"]:
                if not isinstance(ln["text"], str) or "\n" in ln["text"]:
                    raise ParseError("A lyric line is not valid text.")
                if len(ln["text"]) > MAX_LINE_CHARS:
                    raise ParseError(f"A line is longer than {MAX_LINE_CHARS} characters.")
                lines.append(
                    ParsedLine(
                        ln["text"],
                        bool(ln.get("is_locked", False)),
                        [
                            c["body"]
                            for c in ln.get("comments", [])
                            if str(c.get("body", "")).strip()
                        ],
                    )
                )
            label = str(s["label"]).strip()[:60] or "Section"
            stype = s.get("section_type", "custom")
            sections.append(ParsedSection(label, stype, lines))
        parsed = ParsedSong(
            title=str(song.get("title") or "") or None,
            sections=sections,
            genres=[g for g in song.get("genres", []) if g in ("hip-hop", "r&b", "house", "pop")],
            bpm=song.get("bpm"),
            time_signature=song.get("time_signature"),
            concept=str(song.get("concept", ""))[:2000],
            mood=str(song.get("mood", ""))[:200],
            point_of_view=str(song.get("point_of_view", ""))[:200],
        )
    except (KeyError, TypeError) as e:
        raise ParseError("The song export is missing required parts.") from e
    _check_limits(parsed.sections)
    if not parsed.sections:
        raise ParseError("The song export contains no sections.")
    return parsed


def parse_any(content: str, fmt: str) -> ParsedSong:
    return parse_json(content) if fmt == "json" else parse_text(content, fmt)


def export_txt(song: dict) -> str:
    blocks = []
    for sec in song["sections"]:
        blocks.append("\n".join([f"[{sec['label']}]"] + [ln["text"] for ln in sec["lines"]]))
    return "\n\n".join(blocks) + "\n"


def export_md(song: dict) -> str:
    parts = [f"# {song['title']}"]
    meta = []
    if song["genres"]:
        meta.append("Genres: " + ", ".join(song["genres"]))
    if song["bpm"]:
        meta.append(f"BPM: {song['bpm']}")
    if meta:
        parts.append("  \n".join(meta))
    for sec in song["sections"]:
        parts.append("\n".join([f"## {sec['label']}"] + [ln["text"] for ln in sec["lines"]]))
    return "\n\n".join(parts) + "\n"


def export_json(song: dict, exported_at: str) -> str:
    out = {
        "format": "studio-bars-song",
        "schema_version": 1,
        "exported_at": exported_at,
        "song": {
            k: song[k]
            for k in (
                "title",
                "concept",
                "mood",
                "point_of_view",
                "bpm",
                "time_signature",
                "genres",
            )
        },
        "sections": [
            {
                "label": s["label"],
                "section_type": s["section_type"],
                "lines": [
                    {
                        "text": ln["text"],
                        "is_locked": ln["is_locked"],
                        "comments": [{"body": c["body"]} for c in ln["comments"]],
                    }
                    for ln in s["lines"]
                ],
            }
            for s in song["sections"]
        ],
    }
    return json.dumps(out, indent=2, ensure_ascii=False) + "\n"
