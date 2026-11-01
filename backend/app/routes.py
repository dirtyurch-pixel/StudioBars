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
