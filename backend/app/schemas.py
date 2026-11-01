"""Request models. Every user-supplied value is validated here."""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

Genre = Literal["hip-hop", "r&b", "house", "pop"]
SectionType = Literal["intro", "verse", "pre-chorus", "chorus", "hook", "bridge", "outro", "custom"]
Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{8,64}$")]
TIME_SIG = re.compile(r"^\d{1,2}/\d{1,2}$")

MAX_LINE_CHARS = 500
MAX_LINES_PER_SONG = 2000
MAX_SECTIONS = 100


def _no_newlines(v: str) -> str:
    if "\n" in v or "\r" in v:
        raise ValueError("must be a single line")
    return v


class SongCreate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    genres: list[Genre] = Field(default_factory=list, max_length=4)
    concept: str = Field("", max_length=2000)
    mood: str = Field("", max_length=200)
    point_of_view: str = Field("", max_length=200)
    bpm: int | None = Field(None, ge=30, le=300)
    time_signature: str | None = None
    template: Literal["blank", "verse-chorus"] = "blank"

    @field_validator("time_signature")
    @classmethod
    def _ts(cls, v: str | None) -> str | None:
        if v is not None and not TIME_SIG.match(v):
            raise ValueError("time signature must look like 4/4")
        return v

    @field_validator("genres")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class SongUpdate(BaseModel):
    title: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = None
    genres: list[Genre] | None = Field(None, max_length=4)
    concept: str | None = Field(None, max_length=2000)
    mood: str | None = Field(None, max_length=200)
    point_of_view: str | None = Field(None, max_length=200)
    bpm: int | None = Field(None, ge=30, le=300)
    time_signature: str | None = None

    @field_validator("time_signature")
    @classmethod
    def _ts(cls, v: str | None) -> str | None:
        if v is not None and v != "" and not TIME_SIG.match(v):
            raise ValueError("time signature must look like 4/4")
        return v


class LineIn(BaseModel):
    id: Id
    text: Annotated[str, StringConstraints(max_length=MAX_LINE_CHARS)]

    @field_validator("text")
    @classmethod
    def _single(cls, v: str) -> str:
        return _no_newlines(v)


class SectionIn(BaseModel):
    id: Id
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    section_type: SectionType = "custom"
    lines: list[LineIn] = Field(default_factory=list, max_length=MAX_LINES_PER_SONG)


class ContentIn(BaseModel):
    base_version: int = Field(ge=1)
    sections: list[SectionIn] = Field(max_length=MAX_SECTIONS)


class CommentIn(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class SnapshotIn(BaseModel):
    description: str = Field("", max_length=200)


class ImportIn(BaseModel):
    format: Literal["json", "txt", "md"]
    content: str = Field(max_length=1_000_000)
    title: str | None = Field(None, max_length=200)
    genres: list[Genre] = Field(default_factory=list, max_length=4)


# ---------------------------------------------------------------- music
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class TrackUpdate(BaseModel):
    title: Name | None = None
    artist: ShortText | None = None
    album: ShortText | None = None


class PlaylistIn(BaseModel):
    name: Name


class PlaylistAdd(BaseModel):
    track_id: str = Field(min_length=1, max_length=64)


class PlaylistOrder(BaseModel):
    entry_ids: list[str] = Field(max_length=5000)


class PlaybackStateIn(BaseModel):
    track_id: str | None = None
    playlist_id: str | None = None
    position_seconds: float = Field(0, ge=0, le=86400)
    repeat_mode: Literal["off", "all", "one"] = "off"
    shuffle_enabled: bool = False
    volume: float = Field(1, ge=0, le=1)
    speed: float = Field(1, ge=0.5, le=2)


class SongAudioLinkIn(BaseModel):
    track_id: str | None = None
    playlist_id: str | None = None
    loop_a: float | None = Field(None, ge=0, le=86400)
    loop_b: float | None = Field(None, ge=0, le=86400)
    position_seconds: float = Field(0, ge=0, le=86400)
    speed: float = Field(1, ge=0.5, le=2)


# ---------------------------------------------------------------- phonetics
class AnalyzeIn(BaseModel):
    lines: list[Annotated[str, StringConstraints(max_length=MAX_LINE_CHARS)]] = Field(
        max_length=300
    )


class CustomPronIn(BaseModel):
    sounds_like: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = (
        None
    )
    phones: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
