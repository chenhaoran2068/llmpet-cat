"""Build high-frame identity actions from the user-approved original cat GIFs.

The old identity files reduced a real 20–60 frame performance to four or six
poses, which caused the visible wobble/flicker.  This builder keeps every
source frame and duration, then applies each identity's costume treatment to
every frame.  It deliberately does *not* animate a static PNG with CSS.
"""

from __future__ import annotations

import argparse
from collections import deque
from math import atan2, cos, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "cat"
DESTINATION = SOURCE / "office-scene" / "actions"
QA = ROOT.parents[1] / "outputs" / "LLMPET-Cat-action-v2-qa"
IDENTITIES = ("plain", "programmer", "writer", "chubby")

# These are the original, genuinely animated performances the user kept.
# The source frame count and timing are retained in the final WebPs.
ACTIONS = {
    "research": "cat-attention.gif",          # 50 frames: focused look-up/read
    "analysis": "cat-thinking-2.gif",         # 32 frames: lie down and think
    "needs-input": "cat-needsinput.gif",      # 38 frames: ask the user
    "failure": "cat-sad.gif",                 # 21 frames: gentle setback
    "celebration": "cat-happy.gif",           # 47 frames: kick the ball
    "celebration-alt": "candidate-05.gif",    # 54 frames: happy dance
    "work-overload": "cat-juggling.gif",      # 9 expressive frames, rare only
    "rest-roam": "cat-roam.gif",              # 55 frames: small patrol
    "rest-roll": "candidate-04.gif",          # 34 frames: roll around
}
REST_SPECIAL_SOURCES = {
    "plain": DESTINATION / "plain" / "rest-phone.webp",
    "programmer": DESTINATION / "plain" / "rest-phone.webp",
    "writer": SOURCE / "cat-loafing-2.gif",
    "chubby": SOURCE / "cat-loafing-2.gif",
}
REST_PHONE_SOURCE = DESTINATION / "plain" / "rest-phone.webp"

# The original phone-rest cat is the palette authority for every identity.
# Keep the original brown outline and blue eye tones even on new clothes.
BORDER = (99, 55, 43, 255)       # #63372B source outline / moustache
NAVY = (50, 84, 159, 255)        # #32549F source eye blue
BLACK = (25, 31, 36, 255)
SUIT = (39, 42, 48, 255)
SUIT_MID = (55, 61, 68, 255)
SHIRT = (248, 247, 241, 255)
SHIRT_SHADE = (219, 225, 233, 255)
TIE = (30, 48, 73, 255)
CREAM = (255, 249, 238, 255)

# The user selected the original phone-rest cat as the body-colour ruler.
# These values are sampled directly from that source GIF.  Every action first
# receives this narrow body-only normalisation; only then are identity clothes
# added.  It keeps all projects on one cat palette without redrawing a body.
BODY_FUR = (224, 186, 167, 255)        # #E0BAA7
BODY_FUR_SHADE = (221, 183, 165, 255)  # #DDB7A5
BODY_WHITE = (252, 251, 251, 255)      # #FCFBFB


def frames_from_gif(path: Path):
    image = Image.open(path)
    frames = []
    durations = []
    for index in range(image.n_frames):
        image.seek(index)
        frames.append(image.convert("RGBA"))
        durations.append(int(image.info.get("duration", 80)) or 80)
    return frames, durations


def canonicalize_body_palette(frame: Image.Image) -> Image.Image:
    """Map only the original cat's warm fur/white body families to the phone-rest palette.

    Source GIFs came from several original batches with tiny palette shifts.
    The tests and visual QA treat the phone-rest cat as canonical: face sides
    and tail use one warm fur family, its darker tuft/shadow family is stable,
    and face/belly use one near-white.  Grey screens, blue eyes, dark outlines,
    vivid props and transparent pixels are deliberately untouched.
    """
    image = frame.convert("RGBA").copy()
    pixels = image.load()

    def is_white(r, g, b):
        return r >= 238 and g >= 238 and b >= 232 and max(r, g, b) - min(r, g, b) <= 24

    def is_fur(r, g, b):
        return r >= 185 and g >= 145 and 100 <= b <= 195 and 8 <= r - g <= 62 and 8 <= g - b <= 72

    def is_outline(r, g, b):
        return 45 <= r <= 125 and 12 <= g <= 90 and 8 <= b <= 78 and r > g and g >= b

    def is_eye(r, g, b):
        return b > 90 and b > r * 1.30 and b > g * 1.08 and r < 110

    # Source actions contain warm desks, books and toys.  A broad colour pass
    # recoloured those props.  Instead flood only through the cat's own fur,
    # body-white, outline and eyes, seeded around the detected face.  A tail
    # remains connected through the cat outline; a desk or monitor is not.
    pose = pose_for_frame(image, 1)
    face_x, face_y = pose["face"]
    body = pose["body"]
    across_x, across_y = pose["across"]
    down_x, down_y = pose["down"]

    def is_cat_body_zone(x, y):
        dx, dy = x - face_x, y - face_y
        across = dx * across_x + dy * across_y
        down = dx * down_x + dy * down_y
        # Head and torso, plus a lower/wider but still bounded tail zone.  The
        # lower edge deliberately ends before desks and keyboards even when a
        # paw outline touches them in the original GIF.
        torso = -body * .86 <= across <= body * .86 and -body * .88 <= down <= body * .84
        tail = -body * 1.30 <= across <= body * 1.30 and body * .20 <= down <= body * .76
        return torso or tail

    candidates = set()
    seeds = set()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a < 32 or not is_cat_body_zone(x, y) or not (is_white(r, g, b) or is_fur(r, g, b) or is_outline(r, g, b) or is_eye(r, g, b)):
                continue
            candidates.add((x, y))
            if (x - face_x) ** 2 + (y - face_y) ** 2 <= (body * .58) ** 2:
                seeds.add((x, y))

    connected = set()
    queue = deque(seeds)
    while queue:
        point = queue.popleft()
        if point in connected or point not in candidates:
            continue
        connected.add(point)
        x, y = point
        for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if neighbor in candidates and neighbor not in connected:
                queue.append(neighbor)

    for x, y in connected:
        r, g, b, a = pixels[x, y]
        if (r, g, b) == BODY_FUR[:3] or (r, g, b) == BODY_FUR_SHADE[:3] or (r, g, b) == BODY_WHITE[:3]:
            continue
        if is_white(r, g, b):
            pixels[x, y] = BODY_WHITE
        elif is_fur(r, g, b):
            pixels[x, y] = BODY_FUR if r >= 230 else BODY_FUR_SHADE
    return image


def alpha_bbox(frame: Image.Image):
    """Return the largest connected opaque component: the cat, not its prop."""
    alpha = frame.getchannel("A")
    pixels = alpha.load()
    rgba = frame.load()
    points = {(x, y) for y in range(frame.height) for x in range(frame.width) if pixels[x, y] > 32}
    if not points:
        return (12, 10, frame.width - 12, frame.height - 8)
    components = []
    while points:
        start = points.pop()
        queue = deque([start])
        component = [start]
        while queue:
            x, y = queue.popleft()
            for nxt in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nxt in points:
                    points.remove(nxt)
                    queue.append(nxt)
                    component.append(nxt)
        blue_eye_pixels = sum(
            1 for x, y in component
            if rgba[x, y][3] > 160 and rgba[x, y][2] > 95
            and rgba[x, y][2] > rgba[x, y][0] * 1.35
            and rgba[x, y][2] > rgba[x, y][1] * 1.08
            and rgba[x, y][0] < 105
        )
        components.append((blue_eye_pixels, component))
    # A thinking cloud can be physically larger than the lying cat.  The cat
    # is the component carrying its two blue eye marks, so prefer that when
    # it is available; otherwise fall back to the largest visible component.
    eye_components = [entry for entry in components if entry[0] >= 5]
    largest = max(eye_components or components, key=lambda entry: (entry[0], len(entry[1])))[1]
    xs = [point[0] for point in largest]
    ys = [point[1] for point in largest]
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def connected_blue_eye_centers(frame: Image.Image, bbox, with_spacing: bool = False):
    """Find the pair of small blue eye marks without following a blue prop."""
    rgba = frame.load()
    x0, y0, x1, y1 = bbox
    # Eyes are in the upper half of the cat.  Large blue UI/phone areas fall
    # outside this band or fail the small-component filter below.
    y_limit = y0 + max(12, int((y1 - y0) * 0.53))
    candidates = set()
    for y in range(max(0, y0), min(frame.height, y_limit)):
        for x in range(max(0, x0), min(frame.width, x1)):
            r, g, b, a = rgba[x, y]
            if a > 160 and b > 95 and b > r * 1.35 and b > g * 1.08 and r < 105:
                candidates.add((x, y))
    components = []
    while candidates:
        start = candidates.pop()
        queue = deque([start])
        component = [start]
        while queue:
            x, y = queue.popleft()
            for nxt in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nxt in candidates:
                    candidates.remove(nxt)
                    queue.append(nxt)
                    component.append(nxt)
        if 3 <= len(component) <= 95:
            cx = sum(point[0] for point in component) / len(component)
            cy = sum(point[1] for point in component) / len(component)
            components.append((len(component), cx, cy))
    # The two strongest components closest to the top-half centre are usually
    # the tears/eyes that define the cat face.
    center_x = (x0 + x1) / 2
    components.sort(key=lambda item: (abs(item[1] - center_x), -item[0]))
    chosen = components[:2]
    if len(chosen) == 2:
        face_x = (chosen[0][1] + chosen[1][1]) / 2
        face_y = (chosen[0][2] + chosen[1][2]) / 2
        spacing = ((chosen[0][1] - chosen[1][1]) ** 2 + (chosen[0][2] - chosen[1][2]) ** 2) ** .5
        return (face_x, face_y, spacing) if with_spacing else (face_x, face_y)
    face = (center_x, y0 + (y1 - y0) * 0.37)
    return (*face, None) if with_spacing else face


def writer_beret_anchor(frame: Image.Image, bbox, face_x, face_y, body):
    """Find the top edge of the actual head around the detected face.

    A canvas-relative y offset made the writer's beret float when a source
    frame put the cat on its side.  Limit the scan to the face/head region,
    then anchor the hat to the real opaque silhouette instead.  The returned
    centre and width are measured in the original frame coordinate system.
    """
    alpha = frame.getchannel("A")
    x0, y0, x1, y1 = bbox
    half_window = max(9, int(body * .46))
    left = max(x0, int(face_x - half_window))
    right = min(x1, int(face_x + half_window))
    head_bottom = min(y1, int(face_y + max(5, body * .12)))
    pixels = alpha.load()
    points = [
        (x, y)
        for y in range(y0, head_bottom)
        for x in range(left, right)
        if pixels[x, y] > 32
    ]
    if not points:
        # Retain a conservative fallback for malformed source frames.
        return face_x, max(y0, face_y - body * .19), body * .52
    top = min(y for _, y in points)
    upper = [(x, y) for x, y in points if y <= top + max(3, int(body * .26))]
    xs = [x for x, _ in upper]
    silhouette_width = max(xs) - min(xs) + 1 if xs else body * .50
    width = max(body * .42, min(body * .64, silhouette_width * 1.16))
    # Slight overlap with the ears makes the beret feel worn, never separate.
    return (min(xs) + max(xs) + 1) / 2, top + width * .15, width


def rounded(draw, box, radius, fill, outline=BORDER, width=1):
    draw.rounded_rectangle(tuple(int(value) for value in box), radius=max(1, int(radius)), fill=fill, outline=outline, width=max(1, int(width)))


def legacy_draw_analyst_clothes(draw, face_x, face_y, bbox, body, relaxed=False):
    """Draw a readable tailored jacket rather than a black V-shaped bib.

    The source GIFs include upright, seated and horizontal poses.  A single
    filled trapezoid made the former "suit" swallow the cat's belly and became
    an especially obvious black patch in the lying frames.  These two open
    jacket panels retain a visible shirt centre, lapels and tie in every pose.
    """
    x0, y0, x1, y1 = bbox
    # The key correction: measure the neck-to-body direction for this exact
    # source frame.  The old version always drew straight down the canvas,
    # so a leaning or rolling cat appeared to have a floating suit sticker.
    body_cx, body_cy = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = body_cx - face_x, body_cy - face_y
    if dy < body * .08:
        dy = body * .34
    # A monitor or phone can pull a component centre sideways.  Preserve a
    # believable shoulder tilt without letting a prop spin the coat away from
    # the cat's chest.
    angle = max(-0.42, min(0.42, atan2(dx, dy)))
    down = (sin(angle), cos(angle))
    across = (-down[1], down[0])
    horizontal = (x1 - x0) > (y1 - y0) * 1.16
    line = max(2, int(body * 0.022))

    def point(x, y):
        return (face_x + across[0] * x + down[0] * y, face_y + across[1] * x + down[1] * y)

    def garment(points, fill, outline=BORDER, width=line):
        draw.polygon([point(x, y) for x, y in points], fill=fill, outline=outline, width=width)

    if relaxed:
        # The off-duty look is deliberately shirt-only: a visible pale-blue
        # collar and a slightly loosened navy tie, never a disappearing black
        # vest.  It is placed from the cat component, not a prop canvas.
        # A white shirt alone disappears into the cat's white chest at the
        # actual 70px office scale, so use a pale-blue collar edge and a
        # clearly readable, loosened navy tie.
        collar_w = body * (0.34 if horizontal else 0.29)
        collar_h = body * (0.21 if horizontal else 0.24)
        collar_y = body * .15
        garment([
            (-collar_w, collar_y), (0, collar_y + collar_h), (collar_w, collar_y),
            (collar_w * .30, collar_y - collar_h * .20), (0, collar_y + collar_h * .28),
            (-collar_w * .30, collar_y - collar_h * .20),
        ], SHIRT, SHIRT_SHADE)
        draw.line((point(-collar_w * .28, collar_y + collar_h * .02), point(0, collar_y + collar_h * .29)), fill=TIE, width=line)
        draw.line((point(collar_w * .28, collar_y + collar_h * .02), point(0, collar_y + collar_h * .29)), fill=TIE, width=line)
        garment([
            (-body * .050, collar_y + collar_h * .18), (body * .066, collar_y + collar_h * .203),
            (body * .030, collar_y + collar_h * .18 + body * .28), (-body * .060, collar_y + collar_h * .18 + body * .34),
            (-body * .090, collar_y + collar_h * .18 + body * .11),
        ], TIE)
        return

    # The white shirt stays as an open centre, so the black panels read as a
    # blazer with lapels instead of a black bib covering the cat.
    shirt_w = body * (0.22 if horizontal else 0.19)
    collar_y = body * .18
    shirt_bottom = collar_y + body * .51
    garment([
        (-shirt_w, collar_y - body * .03), (0, collar_y + body * .17), (shirt_w, collar_y - body * .03),
        (shirt_w * .58, shirt_bottom), (-shirt_w * .58, shirt_bottom),
    ], SHIRT, SHIRT_SHADE)

    shoulder = body * (0.37 if horizontal else 0.35)
    hem = body * (0.34 if horizontal else 0.42)
    # Left and right jacket bodies: separated at the shirt, with an open V.
    garment([
        (-shirt_w * .84, collar_y), (-shoulder, collar_y + body * .05), (-shoulder * .90, collar_y + hem),
        (-shirt_w * .78, shirt_bottom + body * .11), (-shirt_w * .30, shirt_bottom), (-shirt_w * .18, collar_y + body * .18),
    ], SUIT)
    garment([
        (shirt_w * .84, collar_y), (shoulder, collar_y + body * .05), (shoulder * .90, collar_y + hem),
        (shirt_w * .78, shirt_bottom + body * .11), (shirt_w * .30, shirt_bottom), (shirt_w * .18, collar_y + body * .18),
    ], SUIT)
    # Contrasting lapels give the suit its tailored, British look at pet size.
    garment([
        (-shoulder * .82, collar_y + body * .05), (-shirt_w * .18, collar_y + body * .18),
        (-shirt_w * .78, collar_y + body * .47),
    ], SUIT_MID)
    garment([
        (shoulder * .82, collar_y + body * .05), (shirt_w * .18, collar_y + body * .18),
        (shirt_w * .78, collar_y + body * .47),
    ], SUIT_MID)
    tie_y = collar_y + body * .13
    garment([
        (-body * .026, tie_y), (body * .026, tie_y), (body * .033, tie_y + body * .14),
        (0, tie_y + body * .20), (-body * .033, tie_y + body * .14),
    ], TIE)


def legacy_costume_frame(frame: Image.Image, identity: str, relaxed: bool = False) -> Image.Image:
    if identity == "plain":
        return frame.copy()
    scale = 3
    large = frame.resize((frame.width * scale, frame.height * scale), Image.Resampling.LANCZOS)
    source_bbox = alpha_bbox(frame)
    bbox = tuple(value * scale for value in source_bbox)
    face_x, face_y, eye_spacing = connected_blue_eye_centers(frame, source_bbox, with_spacing=True)
    face_x *= scale
    face_y *= scale
    x0, y0, x1, y1 = bbox
    body = max(26 * scale, min((x1 - x0), (y1 - y0)) * 0.92)
    draw = ImageDraw.Draw(large)

    if identity == "programmer":
        # Round black sunglasses + the existing navy bow tie.
        eye_gap = body * 0.145
        radius = body * 0.095
        y = face_y - (body * .33 if relaxed else body * .025)
        for cx in (face_x - eye_gap, face_x + eye_gap):
            draw.ellipse((cx - radius, y - radius * .76, cx + radius, y + radius * .76), fill=BLACK, outline=BORDER, width=max(2, int(body * .025)))
        draw.line((face_x - eye_gap + radius * .72, y, face_x + eye_gap - radius * .72, y), fill=BORDER, width=max(2, int(body * .026)))
        if not relaxed:
            bow_y = face_y + body * .36
            bow_w, bow_h = body * .20, body * .09
            draw.polygon([(face_x - bow_w, bow_y - bow_h), (face_x - bow_w * .1, bow_y), (face_x - bow_w, bow_y + bow_h)], fill=NAVY, outline=BORDER)
            draw.polygon([(face_x + bow_w, bow_y - bow_h), (face_x + bow_w * .1, bow_y), (face_x + bow_w, bow_y + bow_h)], fill=NAVY, outline=BORDER)
            draw.ellipse((face_x - bow_h * .62, bow_y - bow_h * .65, face_x + bow_h * .62, bow_y + bow_h * .65), fill=NAVY, outline=BORDER)
    elif identity == "writer":
        # Attach the blue beret to the head silhouette in this exact frame.
        # It must overlap the ears in horizontal roll/phone poses as well as
        # upright work poses; it may never be positioned by a fixed canvas y.
        anchor_x, anchor_y, w = writer_beret_anchor(frame, source_bbox, face_x / scale, face_y / scale, body / scale)
        cx, cy = anchor_x * scale, anchor_y * scale
        w, h = w * scale, w * .33
        draw.ellipse((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), fill=NAVY, outline=BORDER, width=max(2, int(body * .03)))
        draw.line((cx - w * .42, cy + h * .12, cx + w * .34, cy + h * .04), fill=(54, 102, 161, 255), width=max(2, int(body * .035)))
        draw.ellipse((cx - body * .035, cy - h * .7, cx + body * .045, cy - h * .18), fill=NAVY, outline=BORDER, width=max(1, int(body * .02)))
        if relaxed:
            # A generic dark-red fizzy drink: no logo/text, but clearly the
            # user's requested little gaming/zero-pressure rest beat.
            can_w, can_h = body * .14, body * .30
            can_x, can_y = face_x + body * .38, face_y + body * .34
            rounded(draw, (can_x - can_w / 2, can_y - can_h / 2, can_x + can_w / 2, can_y + can_h / 2), can_w * .22, (166, 61, 48, 255), BORDER, max(1, int(body * .018)))
            draw.line((can_x - can_w * .24, can_y - can_h * .23, can_x + can_w * .24, can_y - can_h * .23), fill=CREAM, width=max(1, int(body * .02)))
    elif identity == "analyst":
        legacy_draw_analyst_clothes(draw, face_x, face_y, bbox, body, relaxed=relaxed)
    elif identity == "chubby":
        # Rounded pale belly with two tiny contour marks.  It keeps the source
        # arms visible and is smaller for active frames so tools/props survive.
        belly_w, belly_h = body * .66, body * .40
        cx, cy = face_x, face_y + body * .37
        draw.ellipse((cx - belly_w / 2, cy - belly_h / 2, cx + belly_w / 2, cy + belly_h / 2), fill=CREAM, outline=BORDER, width=max(2, int(body * .026)))
        draw.arc((cx - belly_w * .23, cy - belly_h * .05, cx - belly_w * .02, cy + belly_h * .22), 200, 340, fill=BORDER, width=max(1, int(body * .018)))
        draw.arc((cx + belly_w * .02, cy - belly_h * .05, cx + belly_w * .23, cy + belly_h * .22), 200, 340, fill=BORDER, width=max(1, int(body * .018)))
        if relaxed:
            can_w, can_h = body * .15, body * .31
            can_x, can_y = face_x + body * .40, face_y + body * .33
            rounded(draw, (can_x - can_w / 2, can_y - can_h / 2, can_x + can_w / 2, can_y + can_h / 2), can_w * .22, (166, 61, 48, 255), BORDER, max(1, int(body * .018)))
            draw.line((can_x - can_w * .24, can_y - can_h * .23, can_x + can_w * .24, can_y - can_h * .23), fill=CREAM, width=max(1, int(body * .02)))

    return large.resize(frame.size, Image.Resampling.LANCZOS)


def pose_for_frame(frame: Image.Image, scale: int):
    """Create a local head-to-torso coordinate space for one source frame.

    Identity layers are positioned in this coordinate space, not with a fixed
    canvas offset.  That makes them turn with a lying or leaning original-cat
    frame while face, side fur, tail and outline remain the untouched source
    pixels.
    """
    source_bbox = alpha_bbox(frame)
    face_x, face_y, eye_spacing = connected_blue_eye_centers(frame, source_bbox, with_spacing=True)
    x0, y0, x1, y1 = (value * scale for value in source_bbox)
    face_x *= scale
    face_y *= scale
    # Props such as a laptop, ball or companion animal can touch the cat and
    # enlarge its alpha component.  Eyes are the stable character landmark;
    # use their separation as the primary scale, with a deliberately cautious
    # fallback for closed-eye frames.
    bbox_body = min(x1 - x0, y1 - y0) * .92
    if eye_spacing is not None:
        body = max(23 * scale, min(bbox_body * .85, eye_spacing * scale * 3.15))
    else:
        body = max(23 * scale, bbox_body * .42)
    body_cx, body_cy = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = body_cx - face_x, body_cy - face_y
    distance = (dx * dx + dy * dy) ** .5
    if distance < body * .14:
        dx, dy, distance = 0, body * .34, body * .34
    down = (dx / distance, dy / distance)
    return {
        "face": (face_x, face_y),
        "body": body,
        "down": down,
        "across": (-down[1], down[0]),
    }


def local_point(pose, across, down):
    face_x, face_y = pose["face"]
    ax, ay = pose["across"]
    dx, dy = pose["down"]
    return (face_x + ax * across + dx * down, face_y + ay * across + dy * down)


def local_polygon(draw, pose, points, *, fill, outline=BORDER, width=1):
    draw.polygon([local_point(pose, x, y) for x, y in points], fill=fill, outline=outline, width=max(1, int(width)))


def local_line(draw, pose, points, *, fill, width=1):
    draw.line([local_point(pose, x, y) for x, y in points], fill=fill, width=max(1, int(width)), joint="curve")


def local_ellipse(draw, pose, cx, cy, rx, ry, *, fill, outline=BORDER, width=1):
    # ImageDraw.ellipse is canvas-aligned; this polygon rotates with the cat.
    points = [
        (cx + rx * cos(index * 2 * 3.141592653589793 / 40), cy + ry * sin(index * 2 * 3.141592653589793 / 40))
        for index in range(40)
    ]
    local_polygon(draw, pose, points, fill=fill, outline=outline, width=width)


def draw_beret_layers(behind, front, pose):
    """A cap has a rear crown and a small forehead brim, not one sticker."""
    body = pose["body"]
    line = max(2, int(body * .026))
    under = ImageDraw.Draw(behind)
    over = ImageDraw.Draw(front)
    # The original ear silhouette naturally occludes this rear crown.
    local_ellipse(under, pose, -body * .05, -body * .42, body * .35, body * .15, fill=NAVY, outline=BORDER, width=line)
    # The front brim makes deliberate physical contact with the forehead while
    # leaving the original side tufts and tail completely unchanged.
    local_ellipse(over, pose, -body * .06, -body * .30, body * .235, body * .060, fill=NAVY, outline=BORDER, width=line)
    local_line(over, pose, [(-body * .22, -body * .28), (body * .13, -body * .30)], fill=(63, 94, 162, 255), width=max(2, int(body * .024)))
    local_ellipse(over, pose, -body * .07, -body * .55, body * .032, body * .060, fill=NAVY, outline=BORDER, width=max(1, int(body * .018)))


def draw_programmer_layers(front, pose, relaxed=False):
    body = pose["body"]
    line = max(2, int(body * .024))
    draw = ImageDraw.Draw(front)
    eye_gap = body * .145
    eye_y = -body * (.24 if relaxed else .005)
    for eye_x in (-eye_gap, eye_gap):
        local_ellipse(draw, pose, eye_x, eye_y, body * .103, body * .078, fill=BLACK, outline=BORDER, width=line)
    local_line(draw, pose, [(-eye_gap + body * .07, eye_y), (eye_gap - body * .07, eye_y)], fill=BORDER, width=line)
    if relaxed:
        return
    bow_y, bow_w, bow_h = body * .35, body * .205, body * .09
    local_polygon(draw, pose, [(-bow_w, bow_y - bow_h), (-body * .025, bow_y), (-bow_w, bow_y + bow_h)], fill=NAVY, outline=BORDER, width=line)
    local_polygon(draw, pose, [(bow_w, bow_y - bow_h), (body * .025, bow_y), (bow_w, bow_y + bow_h)], fill=NAVY, outline=BORDER, width=line)
    local_ellipse(draw, pose, 0, bow_y, bow_h * .7, bow_h * .72, fill=NAVY, outline=BORDER, width=line)


def draw_analyst_clothes(behind, front, pose, relaxed=False):
    """Dress the cat in a three-dimensional, pose-following British suit.

    This is deliberately *not* a torso decal.  A garment needs an under-body
    back shoulder/hem, then the source cat, then its front panels, lapels and
    sleeves.  The middle source layer lets the head, cheek fur and tail emerge
    from the outfit, while the coat has a small, intentional amount of volume
    beyond the belly at the shoulders and cuffs.  All layers share the exact
    same frame-local neck-to-torso axis.
    """
    body = pose["body"]
    line = max(2, int(body * .020))
    collar_y = body * .12
    under = ImageDraw.Draw(behind)
    over = ImageDraw.Draw(front)

    # This rounded outline is the *garment*, not the cat silhouette.  It
    # begins under the chin, carries a narrow shoulder allowance and curves
    # back to a short hem; it never reaches the tail root.
    back_shell = [
        (-body * .22, collar_y - body * .08),
        (-body * .34, collar_y + body * .08),
        (-body * .35, collar_y + body * .35),
        (-body * .25, collar_y + body * .55),
        (-body * .10, collar_y + body * .63),
        (0, collar_y + body * .66),
        (body * .10, collar_y + body * .63),
        (body * .25, collar_y + body * .55),
        (body * .35, collar_y + body * .35),
        (body * .34, collar_y + body * .08),
        (body * .22, collar_y - body * .08),
    ]

    if relaxed:
        # Resting means the jacket has been taken off: only a small open
        # shirt and loose tie remain, with a rear collar peeking around the
        # neck.  This is still worn in layers rather than printed on the fur.
        local_polygon(under, pose, [
            (-body * .21, collar_y - body * .08), (0, collar_y + body * .12),
            (body * .21, collar_y - body * .08), (body * .17, collar_y + body * .30),
            (0, collar_y + body * .42), (-body * .17, collar_y + body * .30),
        ], fill=SHIRT_SHADE, outline=BORDER, width=line)
        local_polygon(over, pose, [
            (-body * .24, collar_y - body * .02), (0, collar_y + body * .19),
            (body * .24, collar_y - body * .02), (body * .11, collar_y + body * .42),
            (0, collar_y + body * .49), (-body * .11, collar_y + body * .42),
        ], fill=SHIRT, outline=SHIRT_SHADE, width=line)
        local_line(over, pose, [(-body * .14, collar_y), (0, collar_y + body * .18), (body * .14, collar_y)], fill=TIE, width=line)
        local_polygon(over, pose, [
            (-body * .037, collar_y + body * .15), (body * .037, collar_y + body * .15),
            (body * .029, collar_y + body * .36), (0, collar_y + body * .43),
            (-body * .029, collar_y + body * .36),
        ], fill=TIE, outline=BORDER, width=line)
        return

    # Rear shoulder/hem is behind the original cat.  It makes the jacket wrap
    # around the torso instead of beginning as a flat black chest sticker.
    local_polygon(under, pose, back_shell, fill=SUIT_MID, outline=BORDER, width=line)
    # The front coat is *two shaped panels*, never a single black chest bib.
    # Their inner V stays open to expose a white shirt; their lower ends turn
    # inward before the belly so the cat's round body and feet stay visible.
    local_polygon(over, pose, [
        (-body * .22, collar_y - body * .02), (-body * .32, collar_y + body * .10),
        (-body * .29, collar_y + body * .40), (-body * .17, collar_y + body * .57),
        (-body * .065, collar_y + body * .50), (-body * .095, collar_y + body * .21),
    ], fill=SUIT, outline=BORDER, width=line)
    local_polygon(over, pose, [
        (body * .22, collar_y - body * .02), (body * .32, collar_y + body * .10),
        (body * .29, collar_y + body * .40), (body * .17, collar_y + body * .57),
        (body * .065, collar_y + body * .50), (body * .095, collar_y + body * .21),
    ], fill=SUIT, outline=BORDER, width=line)
    # Short cuff curves make the panels read as sleeves, but remain small
    # enough that they cannot become separate black circles on a raised paw.
    local_ellipse(over, pose, -body * .30, collar_y + body * .38, body * .062, body * .092, fill=SUIT, outline=BORDER, width=line)
    local_ellipse(over, pose, body * .30, collar_y + body * .38, body * .062, body * .092, fill=SUIT, outline=BORDER, width=line)

    # The original cat already has the correct white shirt-colour belly.  Do
    # not redraw a large outlined white bib over it: that was the last source
    # of the pasted-on look.  Instead, add only a small collar at the neck and
    # let the source belly remain the visible shirt between the two fronts.
    local_polygon(over, pose, [
        (-body * .145, collar_y - body * .015), (0, collar_y + body * .165),
        (body * .145, collar_y - body * .015), (body * .060, collar_y + body * .215),
        (0, collar_y + body * .260), (-body * .060, collar_y + body * .215),
    ], fill=SHIRT, outline=SHIRT_SHADE, width=max(1, line - 1))
    local_polygon(over, pose, [
        (-body * .23, collar_y + body * .02), (-body * .11, collar_y + body * .21),
        (-body * .20, collar_y + body * .43), (-body * .28, collar_y + body * .29),
    ], fill=SUIT_MID, outline=BORDER, width=line)
    local_polygon(over, pose, [
        (body * .23, collar_y + body * .02), (body * .11, collar_y + body * .21),
        (body * .20, collar_y + body * .43), (body * .28, collar_y + body * .29),
    ], fill=SUIT_MID, outline=BORDER, width=line)
    tie_y = collar_y + body * .17
    local_polygon(over, pose, [
        (-body * .024, tie_y), (body * .024, tie_y), (body * .029, tie_y + body * .105),
        (0, tie_y + body * .155), (-body * .029, tie_y + body * .105),
    ], fill=TIE, outline=BORDER, width=line)


def draw_chubby_layers(front, pose, relaxed=False):
    """Keep the original round belly; add only small, body-following marks."""
    body = pose["body"]
    draw = ImageDraw.Draw(front)
    line = max(1, int(body * .017))
    for sign in (-1, 1):
        points = []
        for index in range(12):
            theta = 3.55 + index * .11
            points.append((sign * body * (.16 + .09 * cos(theta)), body * (.38 + .11 * sin(theta))))
        local_line(draw, pose, points, fill=BORDER, width=line)
    if relaxed:
        can_w, can_h = body * .13, body * .27
        cx, cy = body * .37, body * .35
        local_polygon(draw, pose, [(cx - can_w / 2, cy - can_h / 2), (cx + can_w / 2, cy - can_h / 2), (cx + can_w / 2, cy + can_h / 2), (cx - can_w / 2, cy + can_h / 2)], fill=(166, 61, 48, 255), outline=BORDER, width=line)
        local_line(draw, pose, [(cx - can_w * .24, cy - can_h * .24), (cx + can_w * .24, cy - can_h * .24)], fill=CREAM, width=line)


def costume_frame(frame: Image.Image, identity: str, relaxed: bool = False) -> Image.Image:
    """Flatten a source frame with pose-aware identity parts; never redraw cat."""
    frame = canonicalize_body_palette(frame)
    if identity == "plain":
        return frame
    scale = 4
    original = frame.resize((frame.width * scale, frame.height * scale), Image.Resampling.LANCZOS)
    pose = pose_for_frame(frame, scale)
    behind = Image.new("RGBA", original.size, (0, 0, 0, 0))
    front = Image.new("RGBA", original.size, (0, 0, 0, 0))

    if identity == "programmer":
        draw_programmer_layers(front, pose, relaxed=relaxed)
    elif identity == "writer":
        draw_beret_layers(behind, front, pose)
        if relaxed:
            draw = ImageDraw.Draw(front)
            body = pose["body"]
            line = max(1, int(body * .018))
            cx, cy, can_w, can_h = body * .37, body * .34, body * .13, body * .27
            local_polygon(draw, pose, [(cx - can_w / 2, cy - can_h / 2), (cx + can_w / 2, cy - can_h / 2), (cx + can_w / 2, cy + can_h / 2), (cx - can_w / 2, cy + can_h / 2)], fill=(166, 61, 48, 255), outline=BORDER, width=line)
            local_line(draw, pose, [(cx - can_w * .23, cy - can_h * .23), (cx + can_w * .23, cy - can_h * .23)], fill=CREAM, width=line)
    elif identity == "analyst":
        draw_analyst_clothes(behind, front, pose, relaxed=relaxed)
    elif identity == "chubby":
        draw_chubby_layers(front, pose, relaxed=relaxed)

    flattened = Image.alpha_composite(Image.alpha_composite(behind, original), front)
    return flattened.resize(frame.size, Image.Resampling.LANCZOS)


def write_webp(frames, durations, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(path, format="WEBP", save_all=True, append_images=frames[1:], duration=durations, loop=0, lossless=True, method=6)


def make_contact_sheet(output: Path):
    labels = list(ACTIONS)
    cell_w, cell_h = 146, 166
    header_h, label_w = 86, 106
    canvas = Image.new("RGBA", (label_w + len(labels) * cell_w + 24, header_h + len(IDENTITIES) * cell_h + 24), (251, 246, 238, 255))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 14)
    small = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 11)
    draw.text((16, 12), "高帧身份动作：源 GIF 的逐帧服饰处理", fill=(73, 52, 44, 255), font=font)
    draw.text((16, 38), "每格展示动作中段；动作文件保留原始 GIF 全部帧数与节奏。", fill=(128, 91, 74, 255), font=small)
    for col, action in enumerate(labels):
        x = label_w + col * cell_w + 7
        draw.text((x, 62), action, fill=(73, 52, 44, 255), font=small)
    for row, identity in enumerate(IDENTITIES):
        y = header_h + row * cell_h
        draw.rounded_rectangle((10, y + 44, label_w - 8, y + 102), radius=10, fill=(244, 227, 210, 255), outline=(215, 177, 141, 255))
        draw.text((18, y + 65), identity, fill=(73, 52, 44, 255), font=font)
        for col, action in enumerate(labels):
            path = DESTINATION / identity / f"{action}.webp"
            image = Image.open(path)
            image.seek(max(0, image.n_frames // 2))
            frame = image.convert("RGBA")
            frame.thumbnail((118, 118), Image.Resampling.LANCZOS)
            x = label_w + col * cell_w + (cell_w - frame.width) // 2
            canvas.alpha_composite(frame, (x, y + 29 + (118 - frame.height) // 2))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output)


def make_analyst_motion_qa(output: Path):
    """Render three temporal checkpoints per action to catch costume drift."""
    labels = [*ACTIONS, "rest-phone", "rest-special"]
    cell_w, cell_h = 116, 122
    header_h, label_w = 90, 98
    canvas = Image.new("RGBA", (label_w + len(labels) * cell_w + 18, header_h + cell_h * 3 + 20), (251, 246, 238, 255))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 13)
    small = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 10)
    draw.text((14, 12), "西服猫：动作前 / 中 / 后帧服装审查", fill=(73, 52, 44, 255), font=font)
    draw.text((14, 36), "检查翻领、衬衫与领带始终跟随猫身；休息状态只保留衬衫和松领带。", fill=(128, 91, 74, 255), font=small)
    for col, action in enumerate(labels):
        draw.text((label_w + col * cell_w + 4, 64), action, fill=(73, 52, 44, 255), font=small)
    for row, progress in enumerate((0.12, 0.50, 0.88)):
        y = header_h + row * cell_h
        draw.text((18, y + 48), ("前段", "中段", "后段")[row], fill=(73, 52, 44, 255), font=font)
        for col, action in enumerate(labels):
            path = DESTINATION / "analyst" / f"{action}.webp"
            image = Image.open(path)
            image.seek(min(image.n_frames - 1, max(0, int((image.n_frames - 1) * progress))))
            frame = image.convert("RGBA")
            frame.thumbnail((94, 94), Image.Resampling.LANCZOS)
            x = label_w + col * cell_w + (cell_w - frame.width) // 2
            canvas.alpha_composite(frame, (x, y + 12 + (94 - frame.height) // 2))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output)


def selected_identities():
    parser = argparse.ArgumentParser(description="Rebuild high-frame actions for selected identity cats.")
    parser.add_argument("--identity", action="append", choices=IDENTITIES, help="Identity to rebuild; repeatable. Defaults to all.")
    return tuple(parser.parse_args().identity or IDENTITIES)


def main():
    identities = selected_identities()
    qa_rows = []
    for action, filename in ACTIONS.items():
        source_frames, durations = frames_from_gif(SOURCE / filename)
        for identity in identities:
            # All rest performances use the analyst's off-duty shirt/tie
            # treatment, never its jacket.  It keeps the fixed identity while
            # making the role believable in a lying or rolling pose.
            relaxed = identity == "analyst" and action in {"rest-roam", "rest-roll"}
            frames = [costume_frame(frame, identity, relaxed=relaxed) for frame in source_frames]
            output = DESTINATION / identity / f"{action}.webp"
            write_webp(frames, durations, output)
            qa_rows.append((identity, action, len(frames), sum(durations)))
    source_frames, durations = frames_from_gif(REST_PHONE_SOURCE)
    for identity in identities:
        frames = [costume_frame(frame, identity, relaxed=identity == "analyst") for frame in source_frames]
        output = DESTINATION / identity / "rest-phone.webp"
        write_webp(frames, durations, output)
        qa_rows.append((identity, "rest-phone", len(frames), sum(durations)))
    for identity, source in REST_SPECIAL_SOURCES.items():
        if identity not in identities:
            continue
        source_frames, durations = frames_from_gif(source)
        frames = [costume_frame(frame, identity, relaxed=True) for frame in source_frames]
        output = DESTINATION / identity / "rest-special.webp"
        write_webp(frames, durations, output)
        qa_rows.append((identity, "rest-special", len(frames), sum(durations)))
    make_contact_sheet(QA / "high-frame-identity-actions.png")
    report = QA / "high-frame-identity-actions.tsv"
    report.write_text("identity\taction\tframes\tduration_ms\n" + "\n".join("\t".join(map(str, row)) for row in qa_rows) + "\n", encoding="utf-8")
    print(QA / "high-frame-identity-actions.png")


if __name__ == "__main__":
    main()
