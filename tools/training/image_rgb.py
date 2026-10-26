"""Render score images as RGB on white, retaining ink stored in transparency."""
from PIL import Image

NORMALIZATION = 'rgb-on-white-v1'

def needs_rgb_normalization(image):
    return image.mode not in ('RGB', 'L') or 'transparency' in image.info

def rgb_on_white(image):
    if 'A' in image.getbands() or 'transparency' in image.info:
        rgba = image.convert('RGBA')
        return Image.alpha_composite(Image.new('RGBA', rgba.size, 'white'), rgba).convert('RGB')
    return image.convert('RGB')
