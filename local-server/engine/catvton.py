"""CatVTON pipeline loader + inference for local Anywear (RTX 3050 4GB)."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "catvton_src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
if str(SRC.parent) not in sys.path:
    sys.path.insert(0, str(SRC.parent))

BASE_CKPT = os_env_base = None
import os
BASE_CKPT = os.environ.get("ANYWEAR_SD_BASE", "stable-diffusion-v1-5/stable-diffusion-inpainting")
ATTN_CKPT = os.environ.get("ANYWEAR_CATVTON_CKPT", "zhengchong/CatVTON")

_pipe = None


def load_pipeline(device: str = "cuda", dtype=None):
    global _pipe
    if _pipe is not None:
        return _pipe
    import torch
    if dtype is None:
        dtype = torch.float16
    from model.pipeline import CatVTONPipeline

    _pipe = CatVTONPipeline(
        base_ckpt=BASE_CKPT,
        attn_ckpt=ATTN_CKPT,
        attn_ckpt_version="mix",
        weight_dtype=dtype,
        device=device,
        skip_safety_check=True,
        use_tf32=True,
    )
    # attention slicing for 4GB
    try:
        _pipe.unet.enable_attention_slicing(1)
    except Exception:
        pass
    try:
        _pipe.vae.enable_slicing()
    except Exception:
        pass
    return _pipe


def _resize_and_crop(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    from utils import resize_and_crop
    return resize_and_crop(img, size)


def _resize_and_padding(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    from utils import resize_and_padding
    return resize_and_padding(img, size)


def _default_mask(width: int, height: int, person: Image.Image) -> Image.Image:
    """Torso/upper-body mask via mediapipe pose if available, else center box."""
    mask = Image.new("L", (width, height), 0)
    landmarks = None
    try:
        import mediapipe as mp
        import numpy as np
        pose = mp.solutions.pose.Pose(model_complexity=0, enable_segmentation=False)
        arr = np.array(person.resize((width, height)))
        res = pose.process(arr)
        pose.close()
        if res.pose_landmarks:
            lm = res.pose_landmarks.landmark
            # landmarks 11 left shoulder, 12 right shoulder, 23/24 hips
            def pt(i):
                return (lm[i].x * width, lm[i].y * height)
            ls, rs = pt(11), pt(12)
            lh, rh = pt(23), pt(24)
            landmarks = [ls, rs, rh, lh]
    except Exception:
        landmarks = None

    from PIL import ImageDraw
    draw = ImageDraw.Draw(mask)
    if landmarks:
        # expand box outward
        xs = [p[0] for p in landmarks]
        ys = [p[1] for p in landmarks]
        minx, maxx = min(xs), max(xs)
        miny, maxy = min(ys), max(ys)
        # expand: shoulders width *1.1, down to below hips, up a bit
        cx = (minx + maxx) / 2
        w = (maxx - minx) * 1.35
        top = miny - (maxy - miny) * 0.12
        bottom = maxy + (maxy - miny) * 0.25
        draw.rectangle([cx - w / 2, top, cx + w / 2, bottom], fill=255)
    else:
        # fallback: central torso box
        draw.rectangle([width * 0.18, height * 0.12, width * 0.82, height * 0.88], fill=255)
    return mask


def run_tryon(
    pipe,
    person: Image.Image,
    garment: Image.Image,
    width: int = 384,
    height: int = 512,
    num_inference_steps: int = 20,
    guidance_scale: float = 2.5,
    seed: Optional[int] = None,
) -> Image.Image:
    import torch
    from model.pipeline import CatVTONPipeline  # noqa: F401
    from utils import resize_and_crop, resize_and_padding

    person_r = resize_and_crop(person.convert("RGB"), (width, height))
    garment_r = resize_and_padding(garment.convert("RGB"), (width, height))
    mask = _default_mask(width, height, person_r)
    # soft blur mask edges
    try:
        from diffusers.image_processor import VaeImageProcessor
        mask_proc = VaeImageProcessor(vae_scale_factor=8, do_binarize=False, do_normalize=False)
        mask = mask_proc.blur(mask, blur_factor=9)
    except Exception:
        pass

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cuda").manual_seed(seed)

    result = pipe(
        image=person_r,
        condition_image=garment_r,
        mask=mask,
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        height=height,
        width=width,
        generator=generator,
    )[0]
    return result
