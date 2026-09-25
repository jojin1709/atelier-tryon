"""Local Anywear server: stubs + CatVTON photo try-on + live warp/keyframe WS."""
from __future__ import annotations

import asyncio
import base64
import io
import json
import mimetypes
import os
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from PIL import Image

ROOT = Path(__file__).resolve().parent
EXT_ROOT = ROOT.parent
UPLOADS = ROOT / "uploads"
UPLOADS.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Anti-lag / resource guards
# ---------------------------------------------------------------------------
MIN_FREE_RAM_MB = 800

def _load_decart_key() -> str:
    key = os.environ.get("DECART_API_KEY", "")
    if key:
        return key.strip()
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DECART_API_KEY="):
                return line.split("=", 1)[1].strip()
    return "dct_fdsfgsgfsdfgfs_eNOBoCaSPNddmNDFZMpBumzNIqccnKrwSfRDRhklHXBnNEXEbakUwaelDBugkSLI"

def _save_env_key(key: str):
    env_file = ROOT / ".env"
    env_file.write_text(f"DECART_API_KEY={key.strip()}\n", encoding="utf-8")

async def _mint_decart_token(api_key: str) -> Optional[dict]:
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://api.decart.ai/v1/client/tokens",
                headers={"x-api-key": api_key, "Content-Type": "application/json"},
                json={
                    "expiresIn": 3600,
                    "allowedModels": ["lucy-vton-3.5", "lucy-vton-latest", "lucy-2.1"],
                },
            )
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        print(f"[Decart] Failed to mint client token: {e}")
    return None

_state = {
    "model_loaded": False,
    "model_busy": False,
    "last_model_use": 0.0,
    "idle_unload_after_s": 120,
    "photo_res": (384, 512),  # w,h — fits 4GB
    "oom_backoff": False,
    "live_sessions": 0,
    "decart_api_key": _load_decart_key(),
}
_pipeline = None
_pipe_lock = asyncio.Lock()
_last_activity = time.time()


def _free_ram_mb() -> float:
    try:
        import ctypes
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return stat.ullAvailPhys / (1024 * 1024)
    except Exception:
        return 9999

def _gpu_free_mb() -> Optional[int]:
    try:
        import torch
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            return free // (1024 * 1024)
    except Exception:
        pass
    return None

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Anywear Local", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ---------------------------------------------------------------------------
# Extension stubs (replace Decart cloud) — all free, no queue, no billing
# ---------------------------------------------------------------------------
@app.post("/api/tokens")
async def api_tokens(req: Request):
    body = {}
    try:
        body = await req.json()
    except Exception:
        pass

    # Try Decart Cloud Token
    key = _state.get("decart_api_key")
    if key:
        tok = await _mint_decart_token(key)
        if tok and tok.get("apiKey"):
            return {
                "apiKey": tok["apiKey"],
                "token": tok.get("token") or tok["apiKey"],
                "expiresAt": tok.get("expiresAt") or (int(time.time()) + 3600),
                "modelName": "lucy-vton-3.5",
                "prompt": "",
                "timeouts": {},
                "billing_enabled": False,
                "installation_id": body.get("installation_id"),
                "cloud_enabled": True,
            }

    return {
        "apiKey": "local-free",
        "expiresAt": int(time.time()) + 86400 * 30,
        "modelName": "catvton-local",
        "prompt": "",
        "timeouts": {},
        "billing_enabled": False,
        "installation_id": body.get("installation_id"),
        "cloud_enabled": False,
    }

@app.get("/api/decart/status")
async def api_decart_status():
    key = _state.get("decart_api_key", "")
    masked = f"{key[:7]}...{key[-4:]}" if len(key) > 12 else ("Set" if key else "None")
    return {
        "has_key": bool(key),
        "key_preview": masked,
        "active_model": "lucy-vton-3.5" if key else "catvton-local",
        "cloud_ready": bool(key),
    }

@app.post("/api/decart/key")
async def api_set_decart_key(req: Request):
    body = await req.json()
    key = (body.get("api_key") or body.get("apiKey") or "").strip()
    if not key:
        raise HTTPException(400, "API key required")
    test_token = await _mint_decart_token(key)
    if not test_token or not test_token.get("apiKey"):
        raise HTTPException(400, "Invalid Decart API Key or unauthorized")
    _state["decart_api_key"] = key
    _save_env_key(key)
    return {"ok": True, "model": "lucy-vton-3.5", "expiresAt": test_token.get("expiresAt")}

@app.post("/api/queue/join")
async def api_queue_join(req: Request):
    token_res = await api_tokens(req)
    # Instant grant — never queue
    return {
        "status": "active",
        "ticket_id": f"local-{uuid.uuid4().hex[:12]}",
        "position": 0,
        "poll_ms": 2500,
        "lane": "local",
        "lane_label": "",
        "lane_note": "",
        "eta_text": "",
        "waiting_text": "",
        "cta_text": "",
        "cta_visible": False,
        "loader_asset": None,
        "token": token_res,
        "billing_enabled": False,
    }

@app.get("/api/queue/status")
async def api_queue_status(ticket: str = ""):
    key = _state.get("decart_api_key")
    tok = (await _mint_decart_token(key)) if key else None
    t_obj = {"apiKey": tok["apiKey"]} if (tok and tok.get("apiKey")) else {"apiKey": "local-free"}
    return {"status": "active", "position": 0, "token": t_obj, "cta_visible": False}

@app.post("/api/queue/heartbeat")
async def api_queue_heartbeat():
    return {"ok": True}

@app.post("/api/queue/leave")
async def api_queue_leave():
    return {"ok": True}

@app.get("/api/consumer-billing/status")
async def api_billing_status(installation_id: str = ""):
    return {
        "billing_enabled": False,
        "tryon_sessions": 999999,
        "free_pass_available": True,
        "billing_ui": None,
        "plans": [],
    }

@app.post("/api/consumer-billing/heartbeat")
async def api_billing_heartbeat():
    return {"billed_seconds": 0, "capped": True, "code": None, "unbilled": 0}

@app.post("/api/log")
async def api_log():
    # no telemetry; never return billing directives
    return JSONResponse({"billing_ui": None}, media_type="application/json")

@app.get("/api/log")
async def api_log_get():
    return {"billing_ui": None}

@app.get("/api/proxy-image")
async def api_proxy_image(url: str = ""):
    if not url:
        raise HTTPException(400, "url required")
    async with httpx.AsyncClient(timeout=20, follow_redirects=True,
                                 headers={"User-Agent": "Mozilla/5.0"}) as client:
        try:
            r = await client.get(url)
        except Exception as e:
            raise HTTPException(502, f"proxy fetch failed: {e}")
    if r.status_code != 200:
        raise HTTPException(r.status_code, "upstream error")
    ct = r.headers.get("content-type", "image/jpeg")
    return Response(r.content, media_type=ct)

@app.post("/api/uploads/product-image")
async def api_upload_product(req: Request):
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty body")
    name = f"{uuid.uuid4().hex}.png"
    path = UPLOADS / name
    # accept raw image or data-url
    if body.startswith(b"data:"):
        b64 = body.split(b",", 1)[1]
        data = base64.b64decode(b64)
    else:
        data = body
    path.write_bytes(data)
    # return URL the widget can fetch back through this server
    return {"url": f"http://127.0.0.1:7860/uploads/{name}"}

@app.post("/api/uploads/feedback-frame")
async def api_feedback():
    return {"ok": True}

@app.get("/uploads/{name}")
async def get_upload(name: str):
    path = UPLOADS / Path(name).name
    if not path.exists():
        raise HTTPException(404)
    ct = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return Response(path.read_bytes(), media_type=ct)

@app.get("/health")
async def health():
    return {
        "ok": True,
        "model_loaded": _state["model_loaded"],
        "free_ram_mb": int(_free_ram_mb()),
        "gpu_free_mb": _gpu_free_mb(),
        "photo_res": _state["photo_res"],
        "live_sessions": _state["live_sessions"],
        "oom_backoff": _state["oom_backoff"],
        "decart_cloud": bool(_state.get("decart_api_key")),
        "decart_model": "lucy-vton-3.5" if _state.get("decart_api_key") else "catvton-local",
    }

@app.get("/")
async def index():
    return {"service": "anywear-local", "endpoints": [r.path for r in app.routes if hasattr(r, "path")]}

# ---------------------------------------------------------------------------
# CatVTON photo try-on (lazy, OOM-guarded, idle unload)
def _fallback_tryon_composite(person_img: Image.Image, garment_img: Image.Image, w: int, h: int) -> Image.Image:
    """Clean PIL fallback composite of garment onto person frame."""
    base = person_img.convert("RGBA")
    ir = base.width / max(1, base.height)
    cr = w / h
    if ir > cr:
        dh = h
        dw = int(h * ir)
    else:
        dw = w
        dh = int(w / ir)
    base = base.resize((max(1, dw), max(1, dh)), Image.Resampling.LANCZOS)
    left = max(0, (dw - w) // 2)
    top = max(0, (dh - h) // 2)
    base = base.crop((left, top, left + w, top + h))

    g = garment_img.convert("RGBA")
    gw = int(w * 0.55)
    gh = int(gw * (g.height / max(1, g.width)))
    g = g.resize((max(1, gw), max(1, gh)), Image.Resampling.LANCZOS)

    gx = (w - gw) // 2
    gy = int(h * 0.20)

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    overlay.paste(g, (gx, gy), g)
    result = Image.alpha_composite(base, overlay)
    return result.convert("RGB")

def _get_pipeline():
    """Lazy-load CatVTON. Raises RuntimeError if env not ready."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    try:
        import torch
    except ImportError:
        raise RuntimeError("PyTorch is not installed in the local environment.")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU not available — photo try-on needs NVIDIA GPU")
    from engine.catvton import load_pipeline
    _pipeline = load_pipeline(device="cuda", dtype=torch.float16)
    _state["model_loaded"] = True
    return _pipeline

async def _unload_if_idle():
    global _pipeline
    if _pipeline is None:
        return
    if time.time() - _state["last_model_use"] < _state["idle_unload_after_s"]:
        return
    async with _pipe_lock:
        if time.time() - _state["last_model_use"] < _state["idle_unload_after_s"]:
            return
        try:
            import torch
            _pipeline = None
            _state["model_loaded"] = False
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
        except Exception:
            pass

@app.post("/tryon/photo")
async def tryon_photo(req: Request):
    """Person image (file/data-url/base64) + garment URL or upload → try-on PNG."""
    global _pipeline
    body = await req.json()
    person_b64 = body.get("person") or body.get("person_b64") or ""
    garment = body.get("garment") or body.get("garment_url") or ""
    width = int(body.get("width") or _state["photo_res"][0])
    height = int(body.get("height") or _state["photo_res"][1])
    steps = int(body.get("steps") or 20)
    guidance = float(body.get("guidance") or 2.5)

    if not person_b64:
        raise HTTPException(400, "person image required")
    if not garment:
        raise HTTPException(400, "garment required")

    # RAM floor guard
    if _free_ram_mb() < MIN_FREE_RAM_MB:
        raise HTTPException(503, "System RAM low — close apps and retry")

    person_img = _decode_image(person_b64)
    garment_img = await _load_garment(garment)

    # OOM-aware resolution ladder
    ladder = [(384, 512), (320, 448), (256, 384)]
    if (width, height) not in ladder:
        ladder.insert(0, (width, height))
    last_err = None
    for w, h in ladder:
        try:
            async with _pipe_lock:
                _state["model_busy"] = True
                t0 = time.time()
                import anyio
                result = await anyio.to_thread.run_sync(
                    _run_catvton, person_img, garment_img, w, h, steps, guidance
                )
                _state["last_model_use"] = time.time()
                elapsed = time.time() - t0
            buf = io.BytesIO()
            result.save(buf, format="PNG")
            data = buf.getvalue()
            return Response(
                data,
                media_type="image/png",
                headers={
                    "X-Tryon-Seconds": f"{elapsed:.2f}",
                    "X-Tryon-Res": f"{w}x{h}",
                    "Access-Control-Allow-Origin": "*",
                },
            )
        except RuntimeError as e:
            last_err = e
            if "out of memory" in str(e).lower() or "outofmemory" in type(e).__name__.lower():
                try:
                    import torch
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                _state["oom_backoff"] = True
                continue
            # If model runtime failed, fall back to clean composite
            result = _fallback_tryon_composite(person_img, garment_img, w, h)
            buf = io.BytesIO()
            result.save(buf, format="PNG")
            return Response(buf.getvalue(), media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})
        finally:
            _state["model_busy"] = False

    # Fallback if ladder failed
    result = _fallback_tryon_composite(person_img, garment_img, width, height)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})

def _run_catvton(person_img: Image.Image, garment_img: Image.Image, w: int, h: int, steps: int, guidance: float) -> Image.Image:
    try:
        from engine.catvton import run_tryon
        pipe = _get_pipeline()
        return run_tryon(pipe, person_img, garment_img, width=w, height=h,
                         num_inference_steps=steps, guidance_scale=guidance)
    except Exception:
        return _fallback_tryon_composite(person_img, garment_img, w, h)

def _decode_image(data: str) -> Image.Image:
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    return Image.open(io.BytesIO(raw)).convert("RGBA")

async def _load_garment(garment: str) -> Image.Image:
    if garment.startswith("data:"):
        return _decode_image(garment)
    if garment.startswith("http://127.0.0.1") or garment.startswith("http://localhost"):
        path = garment.split("/uploads/", 1)[-1]
        p = UPLOADS / Path(path).name
        if p.exists():
            return Image.open(p).convert("RGBA")
    if garment.startswith("http"):
        async with httpx.AsyncClient(timeout=20, follow_redirects=True,
                                     headers={"User-Agent": "Mozilla/5.0"}) as client:
            r = await client.get(garment)
            r.raise_for_status()
            return Image.open(io.BytesIO(r.content)).convert("RGBA")
    p = Path(garment)
    if p.exists():
        return Image.open(p).convert("RGBA")
    ext_p = EXT_ROOT / Path(garment).name
    if ext_p.exists():
        return Image.open(ext_p).convert("RGBA")
    if garment.endswith(".svg"):
        png_p = EXT_ROOT / (Path(garment).stem + ".png")
        if png_p.exists():
            return Image.open(png_p).convert("RGBA")
    raise HTTPException(400, f"cannot load garment: {garment[:80]}")

# ---------------------------------------------------------------------------
# Live mode: warp preview @ client + server keyframe CatVTON
# ---------------------------------------------------------------------------
@app.websocket("/tryon/live")
async def tryon_live(ws: WebSocket):
    await ws.accept()
    _state["live_sessions"] += 1
    session = {
        "garment": None,
        "garment_pil": None,
        "pose": None,
        "keyframe_busy": False,
        "last_keyframe": 0.0,
        "keyframe_interval": 3.0,  # seconds — anti-lag
        "closed": False,
        "person_size": (640, 480),
    }
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("bytes")
            text = msg.get("text")
            if text:
                try:
                    obj = json.loads(text)
                except Exception:
                    continue
                await _handle_live_cmd(ws, session, obj)
            elif data:
                await _handle_live_frame(ws, session, data)
    except WebSocketDisconnect:
        pass
    finally:
        _state["live_sessions"] = max(0, _state["live_sessions"] - 1)

async def _handle_live_cmd(ws: WebSocket, session: dict, obj: dict):
    t = obj.get("type")
    if t == "set_garment":
        url = obj.get("url") or ""
        try:
            img = await _load_garment(url)
            session["garment_pil"] = img
            session["garment"] = url
            await ws.send_text(json.dumps({"type": "garment_ack", "ok": True}))
        except Exception as e:
            await ws.send_text(json.dumps({"type": "garment_ack", "ok": False, "error": str(e)}))
    elif t == "pose":
        session["pose"] = obj.get("landmarks")
        session["person_size"] = tuple(obj.get("size") or session["person_size"])
    elif t == "keyframe_now":
        await _maybe_keyframe(ws, session, force=True)
    elif t == "config":
        if obj.get("keyframe_interval"):
            session["keyframe_interval"] = max(1.5, float(obj["keyframe_interval"]))
    elif t == "ping":
        await ws.send_text(json.dumps({"type": "pong", "t": time.time()}))

async def _handle_live_frame(ws: WebSocket, session: dict, jpeg: bytes):
    """Client sends camera JPEG → store as keyframe person source; maybe run CatVTON."""
    try:
        img = Image.open(io.BytesIO(jpeg))
        session["person_size"] = img.size
        person = img.convert("RGB")
        session["_last_person"] = person
    except Exception:
        return
    now = time.time()
    if (
        session.get("garment_pil") is not None
        and not session["keyframe_busy"]
        and (now - session["last_keyframe"]) >= session["keyframe_interval"]
        and _free_ram_mb() >= MIN_FREE_RAM_MB
    ):
        session["keyframe_busy"] = True
        session["last_keyframe"] = now
        try:
            await _run_keyframe(ws, session, person)
        except Exception as e:
            try:
                await ws.send_text(json.dumps({"type": "keyframe_error", "error": str(e)[:200]}))
            except Exception:
                pass
        finally:
            session["keyframe_busy"] = False

async def _maybe_keyframe(ws: WebSocket, session: dict, force: bool = False):
    if session["garment_pil"] is None or session["keyframe_busy"]:
        return
    if not force and time.time() - session["last_keyframe"] < session["keyframe_interval"]:
        return
    if _free_ram_mb() < MIN_FREE_RAM_MB:
        await ws.send_text(json.dumps({"type": "keyframe_error", "error": "low_ram"}))
        return
    session["keyframe_busy"] = True
    session["last_keyframe"] = time.time()
    try:
        # need a recent person frame — client should have sent one; use stored if any
        person = session.get("_last_person")
        if person is None:
            return
        await _run_keyframe(ws, session, person)
    finally:
        session["keyframe_busy"] = False

async def _run_keyframe(ws: WebSocket, session: dict, person: Image.Image):
    import anyio
    w, h = _state["photo_res"]
    # downscale person to model input keeping aspect via letterbox handled in engine
    def _work():
        try:
            from engine.catvton import run_tryon
            pipe = _get_pipeline()
            return run_tryon(pipe, person, session["garment_pil"], width=w, height=h,
                             num_inference_steps=14, guidance_scale=2.5)
        except Exception:
            return _fallback_tryon_composite(person, session["garment_pil"], w, h)
    result = await anyio.to_thread.run_sync(_work)
    _state["last_model_use"] = time.time()
    buf = io.BytesIO()
    result.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    await ws.send_text(json.dumps({"type": "keyframe", "jpeg_b64": b64, "w": result.width, "h": result.height}))

# ---------------------------------------------------------------------------
# Idle model unload background task
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def _startup():
    async def _loop():
        while True:
            await asyncio.sleep(30)
            try:
                await _unload_if_idle()
            except Exception:
                pass
    asyncio.create_task(_loop())

# ---------------------------------------------------------------------------
# Static demo & extension assets serving
# ---------------------------------------------------------------------------
@app.get("/demo")
async def get_demo():
    demo_file = EXT_ROOT / "demo.html"
    if demo_file.exists():
        return FileResponse(demo_file)
    return FileResponse(EXT_ROOT / "widget.html")

@app.get("/{file_path:path}")
async def serve_ext_file(file_path: str):
    if not file_path:
        return {"service": "atelier-local", "demo": "/demo"}
    
    # Check across public/, extension/, and project root
    for base in [EXT_ROOT / "public", EXT_ROOT / "extension", EXT_ROOT]:
        candidate = (base / file_path).resolve()
        try:
            candidate.relative_to(base)
            if candidate.is_file():
                ct = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
                return FileResponse(candidate, media_type=ct)
        except ValueError:
            continue
            
    raise HTTPException(404, "Not Found")

