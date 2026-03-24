from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "extension" / "icons"
STORE_DIR = ROOT / "store-assets"

TRANSPARENT = (0, 0, 0, 0)
WHITE = (248, 250, 252, 255)
SLATE_50 = (248, 250, 252, 255)
SLATE_200 = (226, 232, 240, 255)
SLATE_400 = (148, 163, 184, 255)
SLATE_600 = (71, 85, 105, 255)
SLATE_900 = (15, 23, 42, 255)
SKY_400 = (56, 189, 248, 255)
SKY_500 = (14, 165, 233, 255)
CYAN_500 = (6, 182, 212, 255)
EMERALD_500 = (34, 197, 94, 255)
EMERALD_400 = (74, 222, 128, 255)


def rgba(color: tuple[int, int, int] | tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    if len(color) == 4:
        return color
    return (color[0], color[1], color[2], 255)


def mix(a: tuple[int, int, int, int], b: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(4))


class Canvas:
    def __init__(self, width: int, height: int, fill: tuple[int, int, int, int] = TRANSPARENT) -> None:
        self.width = width
        self.height = height
        self.pixels = bytearray(width * height * 4)
        self.fill(fill)

    def fill(self, color: tuple[int, int, int, int]) -> None:
        r, g, b, a = color
        row = bytes([r, g, b, a]) * self.width
        for y in range(self.height):
            start = y * self.width * 4
            self.pixels[start:start + self.width * 4] = row

    def blend(self, x: int, y: int, color: tuple[int, int, int, int]) -> None:
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return
        r, g, b, a = color
        index = (y * self.width + x) * 4
        existing_r, existing_g, existing_b, existing_a = self.pixels[index:index + 4]
        alpha = a / 255.0
        inv_alpha = 1.0 - alpha
        out_a = int(round(a + existing_a * inv_alpha))
        if out_a == 0:
            return
        out_r = int(round(r * alpha + existing_r * inv_alpha))
        out_g = int(round(g * alpha + existing_g * inv_alpha))
        out_b = int(round(b * alpha + existing_b * inv_alpha))
        self.pixels[index:index + 4] = bytes([out_r, out_g, out_b, out_a])

    def fill_rect(self, x: int, y: int, width: int, height: int, color: tuple[int, int, int, int]) -> None:
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(self.width, x + width)
        y1 = min(self.height, y + height)
        if x0 >= x1 or y0 >= y1:
            return
        for yy in range(y0, y1):
            for xx in range(x0, x1):
                self.blend(xx, yy, color)

    def fill_gradient(self, start: tuple[int, int, int, int], end: tuple[int, int, int, int]) -> None:
        for y in range(self.height):
            t = y / max(1, self.height - 1)
            color = mix(start, end, t)
            for x in range(self.width):
                self.blend(x, y, color)

    def fill_rounded_rect(
        self,
        x: int,
        y: int,
        width: int,
        height: int,
        radius: int,
        color: tuple[int, int, int, int],
        gradient_end: tuple[int, int, int, int] | None = None,
    ) -> None:
        x0 = x
        y0 = y
        x1 = x + width
        y1 = y + height
        radius = max(0, min(radius, width // 2, height // 2))
        for yy in range(y0, y1):
            t = 0 if gradient_end is None else (yy - y0) / max(1, height - 1)
            row_color = color if gradient_end is None else mix(color, gradient_end, t)
            for xx in range(x0, x1):
                if self._inside_rounded_rect(xx, yy, x0, y0, x1, y1, radius):
                    self.blend(xx, yy, row_color)

    def _inside_rounded_rect(self, x: int, y: int, x0: int, y0: int, x1: int, y1: int, radius: int) -> bool:
        if radius == 0:
            return True
        inner_x0 = x0 + radius
        inner_x1 = x1 - radius
        inner_y0 = y0 + radius
        inner_y1 = y1 - radius
        if inner_x0 <= x < inner_x1 or inner_y0 <= y < inner_y1:
            return True

        corners = [
            (inner_x0, inner_y0),
            (inner_x1 - 1, inner_y0),
            (inner_x0, inner_y1 - 1),
            (inner_x1 - 1, inner_y1 - 1),
        ]
        for cx, cy in corners:
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2:
                return True
        return False

    def fill_circle(self, cx: int, cy: int, radius: int, color: tuple[int, int, int, int]) -> None:
        r2 = radius * radius
        for yy in range(cy - radius, cy + radius + 1):
            for xx in range(cx - radius, cx + radius + 1):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= r2:
                    self.blend(xx, yy, color)

    def save_png(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = bytearray()
        stride = self.width * 4
        for y in range(self.height):
            raw.append(0)
            start = y * stride
            raw.extend(self.pixels[start:start + stride])
        compressed = zlib.compress(bytes(raw), level=9)

        def chunk(tag: bytes, payload: bytes) -> bytes:
            return (
                struct.pack(">I", len(payload))
                + tag
                + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
            )

        png = bytearray(b"\x89PNG\r\n\x1a\n")
        png.extend(
            chunk(
                b"IHDR",
                struct.pack(">IIBBBBB", self.width, self.height, 8, 6, 0, 0, 0),
            )
        )
        png.extend(chunk(b"IDAT", compressed))
        png.extend(chunk(b"IEND", b""))
        path.write_bytes(bytes(png))


def draw_brand_mark(canvas: Canvas, x: int, y: int, size: int) -> None:
    canvas.fill_rounded_rect(x, y, size, size, int(size * 0.22), SLATE_900, gradient_end=(11, 59, 74, 255))

    pad = int(size * 0.14)
    bubble = int(size * 0.42)
    radius = int(size * 0.12)
    canvas.fill_rounded_rect(x + pad, y + pad, bubble, bubble, radius, SKY_400, gradient_end=CYAN_500)
    canvas.fill_rounded_rect(
        x + size - pad - bubble,
        y + size - pad - bubble,
        bubble,
        bubble,
        radius,
        EMERALD_400,
        gradient_end=EMERALD_500,
    )

    line_width = max(4, size // 18)
    canvas.fill_rounded_rect(
        x + size // 2 - line_width // 2,
        y + int(size * 0.2),
        line_width,
        int(size * 0.6),
        line_width // 2,
        WHITE,
    )
    canvas.fill_rounded_rect(
        x + size // 2 - int(size * 0.1),
        y + int(size * 0.62),
        int(size * 0.2),
        max(5, size // 16),
        max(3, size // 24),
        WHITE,
    )


def draw_sidebar(canvas: Canvas, x: int, y: int, width: int, height: int) -> None:
    canvas.fill_rounded_rect(x, y, width, height, 24, (15, 23, 42, 255), gradient_end=(30, 41, 59, 255))
    canvas.fill_rounded_rect(x + 20, y + 18, width - 40, 16, 8, (56, 189, 248, 38))
    row_y = y + 52
    for index in range(10):
        alpha = 42 if index < 3 else 26
        canvas.fill_rounded_rect(x + 16, row_y, width - 32, 30, 12, (248, 250, 252, alpha))
        canvas.fill_rounded_rect(x + 28, row_y + 10, width - 110, 8, 4, (248, 250, 252, 160))
        row_y += 42


def draw_messages(canvas: Canvas, x: int, y: int, width: int, height: int) -> None:
    canvas.fill_rounded_rect(x, y, width, height, 24, (255, 255, 255, 255))
    canvas.fill_rect(x, y, width, 1, (226, 232, 240, 255))

    message_y = y + 48
    for index in range(4):
        bubble_width = width - 180 if index % 2 == 0 else width - 260
        bubble_x = x + 40 if index % 2 == 0 else x + 120
        bubble_color = (241, 245, 249, 255) if index % 2 == 0 else (220, 252, 231, 255)
        canvas.fill_rounded_rect(bubble_x, message_y, bubble_width, 76, 18, bubble_color)
        canvas.fill_rounded_rect(bubble_x + 18, message_y + 16, bubble_width - 36, 10, 5, (148, 163, 184, 180))
        canvas.fill_rounded_rect(bubble_x + 18, message_y + 34, bubble_width - 80, 10, 5, (148, 163, 184, 140))
        canvas.fill_rounded_rect(bubble_x + 18, message_y + 52, bubble_width - 130, 10, 5, (148, 163, 184, 120))
        message_y += 108

    image_card_y = y + height - 210
    canvas.fill_rounded_rect(x + 48, image_card_y, 240, 152, 22, (15, 23, 42, 255), gradient_end=(6, 95, 70, 255))
    canvas.fill_circle(x + 118, image_card_y + 54, 16, SKY_400)
    canvas.fill_circle(x + 172, image_card_y + 54, 16, EMERALD_400)
    canvas.fill_rounded_rect(x + 76, image_card_y + 98, 164, 12, 6, (248, 250, 252, 180))
    canvas.fill_rounded_rect(x + 76, image_card_y + 120, 120, 12, 6, (248, 250, 252, 120))


def draw_overlay(canvas: Canvas, x: int, y: int, width: int, height: int) -> None:
    canvas.fill_rounded_rect(x, y, width, height, 20, (15, 23, 42, 235), gradient_end=(2, 6, 23, 235))
    canvas.fill_rounded_rect(x + 18, y + 20, width - 36, 8, 4, (71, 85, 105, 255))
    canvas.fill_rounded_rect(x + 18, y + 20, int((width - 36) * 0.62), 8, 4, EMERALD_500, gradient_end=SKY_400)
    canvas.fill_rounded_rect(x + 18, y + 40, width - 40, 10, 5, (248, 250, 252, 220))
    canvas.fill_rounded_rect(x + 18, y + 60, width - 84, 9, 4, (148, 163, 184, 200))
    canvas.fill_rounded_rect(x + 18, y + 80, width - 66, 9, 4, (148, 163, 184, 170))


def draw_popup(canvas: Canvas, x: int, y: int, width: int, height: int) -> None:
    canvas.fill_rounded_rect(x, y, width, height, 22, (255, 255, 255, 248))
    canvas.fill_rect(x, y, width, 1, (226, 232, 240, 255))

    card_w = (width - 44) // 2
    card_h = 68
    positions = [
        (x + 14, y + 54),
        (x + 28 + card_w, y + 54),
        (x + 14, y + 132),
        (x + 28 + card_w, y + 132),
    ]
    for px, py in positions:
        canvas.fill_rounded_rect(px, py, card_w, card_h, 14, SLATE_50)
        canvas.fill_rect(px, py, card_w, 1, (226, 232, 240, 255))
        canvas.fill_rounded_rect(px + 12, py + 16, card_w - 24, 10, 5, (148, 163, 184, 100))
        canvas.fill_rounded_rect(px + 12, py + 36, card_w - 48, 16, 8, (15, 23, 42, 255))

    button_y = y + height - 98
    for idx in range(3):
        button_color = (15, 23, 42, 255) if idx != 1 else (255, 255, 255, 255)
        button_border = (15, 23, 42, 20) if idx == 1 else (0, 0, 0, 0)
        btn_x = x + 16
        btn_y = button_y + idx * 26
        canvas.fill_rounded_rect(btn_x, btn_y, width - 32, 18, 9, button_color)
        if button_border[3]:
            canvas.fill_rect(btn_x, btn_y, width - 32, 1, button_border)


def draw_browser_scene(width: int, height: int) -> Canvas:
    canvas = Canvas(width, height, fill=WHITE)
    canvas.fill_gradient((248, 250, 252, 255), (219, 234, 254, 255))

    browser_x = int(width * 0.07)
    browser_y = int(height * 0.08)
    browser_w = int(width * 0.72)
    browser_h = int(height * 0.78)
    canvas.fill_rounded_rect(browser_x, browser_y, browser_w, browser_h, 26, (255, 255, 255, 245))
    canvas.fill_rect(browser_x, browser_y, browser_w, 1, (203, 213, 225, 255))

    for idx, color in enumerate([(248, 113, 113, 255), (250, 204, 21, 255), (74, 222, 128, 255)]):
        canvas.fill_circle(browser_x + 26 + idx * 18, browser_y + 22, 5, color)

    canvas.fill_rounded_rect(browser_x + 92, browser_y + 14, browser_w - 124, 18, 9, (241, 245, 249, 255))
    draw_sidebar(canvas, browser_x + 18, browser_y + 50, int(browser_w * 0.24), browser_h - 68)
    draw_messages(
        canvas,
        browser_x + int(browser_w * 0.24) + 30,
        browser_y + 50,
        browser_w - int(browser_w * 0.24) - 48,
        browser_h - 68,
    )
    draw_overlay(canvas, browser_x + browser_w - 270, browser_y + browser_h - 154, 236, 104)

    popup_w = int(width * 0.23)
    popup_h = int(height * 0.42)
    draw_popup(canvas, int(width * 0.72), int(height * 0.16), popup_w, popup_h)

    badge_size = int(min(width, height) * 0.12)
    draw_brand_mark(canvas, int(width * 0.77), int(height * 0.68), badge_size)
    return canvas


def generate_icons() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        canvas = Canvas(size, size, fill=TRANSPARENT)
        mark_size = max(10, size - max(2, size // 4))
        offset = (size - mark_size) // 2
        draw_brand_mark(canvas, offset, offset, mark_size)
        canvas.save_png(ICONS_DIR / f"icon-{size}.png")


def generate_store_images() -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)

    screenshot = draw_browser_scene(1280, 800)
    screenshot.save_png(STORE_DIR / "screenshot-01.png")

    promo_small = draw_browser_scene(440, 280)
    promo_small.save_png(STORE_DIR / "promo-small-440x280.png")

    promo_marquee = draw_browser_scene(1400, 560)
    promo_marquee.save_png(STORE_DIR / "promo-marquee-1400x560.png")


def main() -> None:
    generate_icons()
    generate_store_images()
    print(ICONS_DIR)
    print(STORE_DIR)


if __name__ == "__main__":
    main()
