from collections.abc import Iterator

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from . import service
from .db import connect
from .schemas import (
    CommentIn,
    ContentIn,
    ImportIn,
    SnapshotIn,
    SongCreate,
    SongUpdate,
)

router = APIRouter(prefix="/api")


def get_conn() -> Iterator:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@router.get("/songs")
def songs(trash: bool = False, conn=Depends(get_conn)):
    return service.list_songs(conn, trash)


@router.post("/songs", status_code=201)
def create_song(body: SongCreate, conn=Depends(get_conn)):
    return service.create_song(conn, body)


@router.get("/songs/{song_id}")
def get_song(song_id: str, conn=Depends(get_conn)):
    return service.load_song(conn, song_id)


@router.patch("/songs/{song_id}")
def patch_song(song_id: str, body: SongUpdate, conn=Depends(get_conn)):
    return service.update_song(conn, song_id, body)


@router.delete("/songs/{song_id}", status_code=204)
def delete_song(song_id: str, conn=Depends(get_conn)):
    service.delete_song(conn, song_id)


@router.post("/songs/{song_id}/undelete")
def undelete(song_id: str, conn=Depends(get_conn)):
    return service.undelete_song(conn, song_id)


@router.put("/songs/{song_id}/content")
def put_content(song_id: str, body: ContentIn, conn=Depends(get_conn)):
    return service.save_content(conn, song_id, body)


@router.post("/lines/{line_id}/lock")
def lock(line_id: str, conn=Depends(get_conn)):
    return service.set_lock(conn, line_id, True)


@router.post("/lines/{line_id}/unlock")
def unlock(line_id: str, conn=Depends(get_conn)):
    return service.set_lock(conn, line_id, False)


@router.post("/lines/{line_id}/comments", status_code=201)
def add_comment(line_id: str, body: CommentIn, conn=Depends(get_conn)):
    return service.add_comment(conn, line_id, body)


@router.patch("/comments/{comment_id}")
def edit_comment(comment_id: str, body: CommentIn, conn=Depends(get_conn)):
    return service.edit_comment(conn, comment_id, body)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: str, conn=Depends(get_conn)):
    return service.delete_comment(conn, comment_id)


@router.get("/songs/{song_id}/revisions")
def revisions(song_id: str, conn=Depends(get_conn)):
    return service.list_revisions(conn, song_id)


@router.post("/songs/{song_id}/revisions", status_code=201)
def snapshot(song_id: str, body: SnapshotIn, conn=Depends(get_conn)):
    return service.create_revision(conn, song_id, body.description)


@router.post("/revisions/{revision_id}/restore")
def restore(revision_id: str, conn=Depends(get_conn)):
    return service.restore_revision(conn, revision_id)


@router.get("/songs/{song_id}/export")
def export(song_id: str, format: str = "json", conn=Depends(get_conn)):
    body, media, name = service.export_song(conn, song_id, format)
    return Response(
        body, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


@router.post("/import/preview")
def import_preview(body: ImportIn):
    return service.preview_import(body)


@router.post("/import", status_code=201)
def import_commit(body: ImportIn, conn=Depends(get_conn)):
    return service.commit_import(conn, body)


# ---------------------------------------------------------------- music
from urllib.parse import unquote  # noqa: E402

from fastapi import Header, Request  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402

from . import music  # noqa: E402
from .schemas import (  # noqa: E402
    PlaybackStateIn,
    PlaylistAdd,
    PlaylistIn,
    PlaylistOrder,
    SongAudioLinkIn,
    TrackBeatsIn,
    TrackUpdate,
)


@router.get("/music/tracks")
def list_tracks(conn=Depends(get_conn)):
    return music.list_tracks(conn)


@router.post("/music/tracks", status_code=201)
async def upload_track(
    request: Request,
    x_filename: str = Header(...),
    x_duration: str | None = Header(None),
    conn=Depends(get_conn),
):
    tmp, title, ext, size, digest = await music.receive_file(request, unquote(x_filename))
    return music.create_track(conn, tmp, title, ext, size, digest, music.clean_duration(x_duration))


@router.post("/music/tracks/{track_id}/relink")
async def relink_track(
    track_id: str,
    request: Request,
    x_filename: str = Header(...),
    x_duration: str | None = Header(None),
    conn=Depends(get_conn),
):
    music._track_row(conn, track_id)  # 404 before reading the body
    tmp, _title, ext, size, digest = await music.receive_file(request, unquote(x_filename))
    return music.relink_track(
        conn, track_id, tmp, ext, size, digest, music.clean_duration(x_duration)
    )


@router.patch("/music/tracks/{track_id}")
def patch_track(track_id: str, body: TrackUpdate, conn=Depends(get_conn)):
    return music.update_track(conn, track_id, body)


@router.delete("/music/tracks/{track_id}", status_code=204)
def remove_track(track_id: str, conn=Depends(get_conn)):
    music.delete_track(conn, track_id)


@router.get("/music/tracks/{track_id}/beats")
def track_beats(track_id: str, conn=Depends(get_conn)):
    return {"beats": music.get_beats(conn, track_id)}


@router.put("/music/tracks/{track_id}/beats")
def put_track_beats(track_id: str, body: TrackBeatsIn, conn=Depends(get_conn)):
    return {"beats": music.put_beats(conn, track_id, body)}


@router.delete("/music/tracks/{track_id}/beats", status_code=204)
def clear_track_beats(track_id: str, conn=Depends(get_conn)):
    music.put_beats(conn, track_id, None)


@router.get("/music/tracks/{track_id}/audio")
def track_audio(track_id: str, conn=Depends(get_conn)):
    path, media_type = music.audio_path(conn, track_id)
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/music/playlists")
def playlists(conn=Depends(get_conn)):
    return music.list_playlists(conn)


@router.post("/music/playlists", status_code=201)
def new_playlist(body: PlaylistIn, conn=Depends(get_conn)):
    return music.create_playlist(conn, body.name)


@router.get("/music/playlists/{pid}")
def playlist(pid: str, conn=Depends(get_conn)):
    return music.playlist_detail(conn, pid)


@router.patch("/music/playlists/{pid}")
def rename_playlist(pid: str, body: PlaylistIn, conn=Depends(get_conn)):
    return music.rename_playlist(conn, pid, body.name)


@router.delete("/music/playlists/{pid}", status_code=204)
def remove_playlist(pid: str, conn=Depends(get_conn)):
    music.delete_playlist(conn, pid)


@router.post("/music/playlists/{pid}/tracks", status_code=201)
def playlist_add(pid: str, body: PlaylistAdd, conn=Depends(get_conn)):
    return music.add_to_playlist(conn, pid, body.track_id)


@router.put("/music/playlists/{pid}/order")
def playlist_order(pid: str, body: PlaylistOrder, conn=Depends(get_conn)):
    return music.reorder_playlist(conn, pid, body.entry_ids)


@router.delete("/music/playlists/{pid}/tracks/{entry_id}")
def playlist_remove(pid: str, entry_id: str, conn=Depends(get_conn)):
    return music.remove_entry(conn, pid, entry_id)


@router.get("/music/state")
def playback_state(conn=Depends(get_conn)):
    return music.get_state(conn)


@router.put("/music/state")
def save_playback_state(body: PlaybackStateIn, conn=Depends(get_conn)):
    return music.put_state(conn, body)


@router.get("/songs/{song_id}/audio-link")
def song_link(song_id: str, conn=Depends(get_conn)):
    return music.get_link(conn, song_id)


@router.put("/songs/{song_id}/audio-link")
def save_song_link(song_id: str, body: SongAudioLinkIn, conn=Depends(get_conn)):
    return music.put_link(conn, song_id, body)
