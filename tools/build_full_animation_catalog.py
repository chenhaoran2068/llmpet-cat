"""Create a visual, page-by-page review catalog for every cat GIF and active WebP."""

from __future__ import annotations

import math
from html import escape
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "cat"
OUTPUT = ROOT.parents[1] / "outputs" / "LLMPET-Cat-full-animation-catalog"

PAGE_COLUMNS = 3
PAGE_ROWS = 4
PER_PAGE = PAGE_COLUMNS * PAGE_ROWS
CARD_W, CARD_H = 592, 214
MARGIN, HEADER_H = 34, 88
CANVAS_W = MARGIN * 2 + CARD_W * PAGE_COLUMNS
CANVAS_H = HEADER_H + MARGIN + CARD_H * PAGE_ROWS + MARGIN

BG = (251, 246, 238, 255)
CARD = (255, 253, 249, 255)
INK = (73, 52, 44, 255)
MUTED = (128, 91, 74, 255)
BORDER = (215, 177, 141, 255)
ACCENT = (232, 173, 105, 255)
FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"


def font(size: int):
    return ImageFont.truetype(FONT_PATH, size)


F_TITLE = font(24)
F_SUBTITLE = font(13)
F_LABEL = font(12)
F_META = font(11)


def category_of(path: Path) -> tuple[str, str]:
    relative = path.relative_to(ASSETS)
    parts = relative.parts
    if len(parts) == 1:
        return ("01-original-root-gifs", "原味猫：根目录原始 GIF（原味猫当前启用）")
    if parts[0] == "qq-post-2026-05-29":
        return ("02-qq-post-gifs", "原始 QQ 素材 GIF")
    if parts[0] == "office":
        return ("03-legacy-office-gifs", "旧版 office GIF（当前未启用）")
    if parts[:2] == ("office-scene", "animations"):
        return ("04-legacy-animation-gifs", "旧版 office-scene 动画 GIF（当前未启用）")
    if parts[:2] == ("office-scene", "motions"):
        return ("05-motion-library-gifs", "动作库 GIF（当前未启用）")
    return ("06-other-gifs", "其他 GIF")


def frame_samples(path: Path):
    image = Image.open(path)
    count = getattr(image, "n_frames", 1)
    indices = sorted({0, max(0, (count - 1) // 2), max(0, count - 1)})
    while len(indices) < 3:
        indices.append(indices[-1])
    frames = []
    durations = []
    for index in range(count):
        image.seek(index)
        durations.append(int(image.info.get("duration", 0)) or 80)
    for index in indices[:3]:
        image.seek(index)
        frame = image.convert("RGBA")
        bbox = frame.getbbox()
        if bbox:
            frame = frame.crop(bbox)
        frame.thumbnail((168, 158), Image.Resampling.LANCZOS)
        frames.append(frame)
    return frames, count, sum(durations), indices[:3]


def create_page(category_label: str, entries: list[dict], page_number: int, page_total: int, destination: Path):
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), BG)
    draw = ImageDraw.Draw(canvas)
    draw.text((MARGIN, 18), category_label, font=F_TITLE, fill=INK)
    draw.text((MARGIN, 52), f"第 {page_number}/{page_total} 页 · 每项为首帧／中帧／末帧 · 仅供审查，不代表当前是否启用", font=F_SUBTITLE, fill=MUTED)
    for slot, entry in enumerate(entries):
        col, row = slot % PAGE_COLUMNS, slot // PAGE_COLUMNS
        x = MARGIN + col * CARD_W
        y = HEADER_H + row * CARD_H
        draw.rounded_rectangle((x, y, x + CARD_W - 12, y + CARD_H - 12), radius=14, fill=CARD, outline=BORDER, width=2)
        draw.text((x + 16, y + 12), entry["relative"], font=F_LABEL, fill=INK)
        draw.text((x + 16, y + 35), f"{entry['format']} · {entry['frame_count']} 帧 · {entry['duration_ms']} ms · 关键帧 {entry['indices']}", font=F_META, fill=MUTED)
        for frame_index, frame in enumerate(entry["sample_frames"]):
            fx = x + 14 + frame_index * 186 + (168 - frame.width) // 2
            fy = y + 56 + (144 - frame.height) // 2
            canvas.alpha_composite(frame, (fx, fy))
            if frame_index < 2:
                draw.line((x + 178 + frame_index * 186, y + 132, x + 192 + frame_index * 186, y + 132), fill=ACCENT, width=3)
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(destination, quality=94)


def main():
    # Removed identities must not remain in the user-facing review book just
    # because an old local source file still exists.  The app package excludes
    # them as well; this keeps the catalogue aligned with what users can pick.
    removed_identities = {"analyst"}
    removed_catalogues = {
        "03-legacy-office-gifs",
        "04-legacy-animation-gifs",
        "05-motion-library-gifs",
        "06-other-gifs",
        "02-qq-post-gifs",
    }
    gifs = [
        path for path in sorted(ASSETS.rglob("*.gif"))
        if not (set(path.parts) & removed_identities) and category_of(path)[0] not in removed_catalogues
    ]
    active_webps = [
        path for path in sorted((ASSETS / "office-scene" / "actions").rglob("*.webp"))
        if not (set(path.parts) & removed_identities) and path.parent.name != "plain"
    ]
    categories: dict[tuple[str, str], list[Path]] = {}
    for path in gifs:
        categories.setdefault(category_of(path), []).append(path)
    categories[("07-active-runtime-webps", "其他身份猫当前动作 WebP")]=active_webps

    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = ["category\tpage\tfile\tformat\tframes\tduration_ms\tstatus"]
    index_lines = ["# LLMPET Cat 动画素材检查册", "", "包含全部 GIF，以及当前运行时会使用的 WebP 动作。每张卡片按首帧／中帧／末帧展示。", ""]
    html_sections = []
    html_navigation = []
    total_assets = 0
    for (category_id, category_label), paths in sorted(categories.items()):
        pages = math.ceil(len(paths) / PER_PAGE) if paths else 0
        index_lines.extend([f"## {category_label}", ""])
        html_pages = []
        section_id = f"section-{category_id}"
        status = "当前运行" if category_id in {"01-original-root-gifs", "07-active-runtime-webps"} else "素材库"
        html_navigation.append(
            f'<a href="#{section_id}"><span>{escape(category_label)}</span><small>{len(paths)} 项 · {status}</small></a>'
        )
        for page_index in range(pages):
            start = page_index * PER_PAGE
            page_paths = paths[start:start + PER_PAGE]
            entries = []
            for path in page_paths:
                frames, frame_count, duration, indices = frame_samples(path)
                relative = path.relative_to(ASSETS).as_posix()
                entry = {
                    "relative": relative,
                    "format": path.suffix.upper().lstrip("."),
                    "frame_count": frame_count,
                    "duration_ms": duration,
                    "indices": "/".join(str(value) for value in indices),
                    "sample_frames": frames,
                }
                entries.append(entry)
                status = "当前启用" if category_id == "07-active-runtime-webps" else "素材库／未必启用"
                manifest.append(f"{category_id}\t{page_index + 1}\t{relative}\t{entry['format']}\t{entry['frame_count']}\t{duration}\t{status}")
            page_name = f"{category_id}-page-{page_index + 1:02d}.png"
            create_page(category_label, entries, page_index + 1, pages, OUTPUT / page_name)
            index_lines.append(f"- [{page_name}]({page_name})：{start + 1}–{start + len(page_paths)} / {len(paths)}")
            html_pages.append(
                f'<figure><figcaption>{escape(category_label)} · 第 {page_index + 1}/{pages} 页 · '
                f'{start + 1}–{start + len(page_paths)} / {len(paths)}</figcaption>'
                f'<a href="{page_name}" title="打开第 {page_index + 1} 页原图"><img loading="lazy" src="{page_name}" alt="{escape(category_label)} 第 {page_index + 1} 页"></a></figure>'
            )
            total_assets += len(page_paths)
        index_lines.append("")
        html_sections.append(
            f'<section id="{section_id}"><div class="section-heading"><h2>{escape(category_label)}</h2>'
            f'<span>{len(paths)} 项 · {pages} 页 · {status}</span></div><div class="page-grid">{''.join(html_pages)}</div></section>'
        )

    (OUTPUT / "README.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    (OUTPUT / "manifest.tsv").write_text("\n".join(manifest) + "\n", encoding="utf-8")
    gallery_html = f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LLMPET Cat 动画素材检查册</title>
<style>
html{{scroll-behavior:smooth}}body{{margin:0;background:#f7f0e7;color:#4d3028;font-family:"Microsoft YaHei",sans-serif}}
main{{max-width:1920px;margin:auto;padding:24px 28px 54px}}h1{{margin:0;font-size:28px}}p{{margin:7px 0 0;color:#7b5c50;line-height:1.65}}
.summary{{display:flex;flex-wrap:wrap;gap:9px;margin:17px 0 13px}}.summary span{{padding:6px 10px;border-radius:999px;color:#684a3b;background:#fffaf4;border:1px solid #e2c2a6;font-size:13px;font-weight:700}}
nav{{position:sticky;z-index:4;top:0;display:flex;gap:8px;overflow-x:auto;padding:10px 0 12px;background:linear-gradient(#f7f0e7 82%,rgba(247,240,231,0))}}
nav a{{flex:0 0 auto;display:grid;gap:2px;min-width:118px;padding:7px 10px;border:1px solid #ddb08e;border-radius:10px;color:#4d3028;background:#fffaf4;text-decoration:none;box-shadow:0 2px 0 rgba(131,84,49,.08)}}nav small{{color:#876454;font-size:10px}}
section{{margin:26px 0 48px;scroll-margin-top:82px}}.section-heading{{display:flex;align-items:baseline;justify-content:space-between;gap:16px;border-bottom:2px solid #ddb08e;padding:0 2px 8px}}h2{{margin:0;font-size:20px}}.section-heading span{{color:#8c6a58;font-size:12px;white-space:nowrap}}
.page-grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}}figure{{margin:0;padding:10px;background:#fffdf9;border:1px solid #e1bb9c;border-radius:14px;box-shadow:0 3px 0 rgba(133,84,48,.08)}}figcaption{{min-height:35px;margin:1px 2px 8px;font-size:12px;font-weight:700;line-height:1.45}}figure a{{display:block;overflow:hidden;border-radius:8px;background:#fff8ef}}img{{width:100%;height:auto;display:block;transition:transform .18s ease}}figure a:hover img{{transform:scale(1.012)}}
@media(max-width:950px){{main{{padding:18px 14px 42px}}.page-grid{{grid-template-columns:1fr}}h1{{font-size:23px}}}}
</style><main><h1>LLMPET Cat 动画素材检查册</h1>
<p>已删除西服猫。每张检查图展示首帧／中帧／末帧；点击图片可打开单页原图，方便你逐项标记保留、停用或重做。</p>
<div class="summary"><span>{len(gifs)} 个 GIF</span><span>{len(active_webps)} 个当前运行 WebP</span><span>共 {total_assets} 项 · {sum(math.ceil(len(paths) / PER_PAGE) for paths in categories.values())} 页</span></div>
<nav>{''.join(html_navigation)}</nav>""" + "".join(html_sections) + "</main></html>"
    (OUTPUT / "index.html").write_text(gallery_html, encoding="utf-8")
    print(f"catalog={OUTPUT}")
    print(f"gif_files={len(gifs)}")
    print(f"active_runtime_webps={len(active_webps)}")
    print(f"catalogued_assets={total_assets}")


if __name__ == "__main__":
    main()
