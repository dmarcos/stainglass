# Lead & Light

Seven landmark stained glass windows, rebuilt in three.js from photographs: glass pieces, lead cames, solder joints,
paint and iron bars, lit by daylight and set in the kind of architecture each was made for (a Chartres ambulatory bay,
a Victorian parlour, a Gilded Age hall, Barillet's steel window wall, a Greene & Greene room, Wright's oak casement between amber side lights,
a Mackintosh entrance door). Each style has a step-by-step making sequence and highlighted hallmarks.

## Run

The page reads image pixels, so it has to be served over HTTP (opening `index.html` from disk won't work):

    python3 -m http.server 8000
    # open http://localhost:8000          (add #style=deco etc. to open a specific window)

three.js 0.160.0 and the fonts load from CDNs, so the browser needs a network connection.

## Reel

    python3 tools/record_film.py            # writes lead-and-light-reel.mp4 (1080×1920, 30 fps, 15 s)

Opens the page headless with `#film`, which steps through the seven windows frame by frame with slow camera moves,
drifting morning light and titles; frames are saved by the script and encoded with ffmpeg (needs Chrome and ffmpeg).

## Files

- `index.html`, `styles.css`, `main.js` — the page. `main.js` holds the photo-to-glass loader, style data, shaders and scene.
- `windows/` — prebuilt textures per window: `_c.jpg` glass colour, `_l.png` (R lead relief, G paint, B window mask),
  `_i.png` iron or wood bars, `_src.jpg` source thumbnail, plus `meta.json` (sizes, lead width, outline).
- `tools/fetch_photos.py` — downloads the source photographs into `tools/photos/` (already included).
- `tools/build_textures.py` — keeps every line at the width it has in the photo, splits the window into pieces with a
  watershed on those lines (lines on piece boundaries become lead came, the rest painted detail) and writes `windows/`.
  Crops, outlines and thresholds per window are at the top. Needs numpy, scipy and Pillow; OpenCV for the Chartres
  step that aligns a higher-resolution detail photo onto the full window.
  `python3 tools/build_textures.py` rebuilds all; pass style names to rebuild some.

## Sources

| Style | Window | Photo |
|---|---|---|
| Medieval & Gothic | Notre-Dame de la Belle Verrière, Chartres Cathedral | Eusebius; detail by Vassil — both public domain |
| Victorian | John La Farge, *Peonies Blown in the Wind*, c. 1880 | The Metropolitan Museum of Art, CC0 |
| Art Nouveau | Tiffany Studios, *Magnolias and Irises*, c. 1908 | The Metropolitan Museum of Art, CC0 |
| Art Deco | Louis Barillet studio façade, *Athènes* panel, 1932 | Velvet, CC BY-SA 4.0 — the derived textures `windows/deco_*` are shared under the same licence |
| Mission & Craftsman | Greene & Greene, the three Tichenor House casements, 1904–05 | The Huntington, public domain |
| Prairie | Frank Lloyd Wright, *Tree of Life* window, Darwin D. Martin House, 1904 | Daderot, public domain |
| Mackintosh | Entrance hall glass, House for an Art Lover (designed 1901, built 1989–96) | Jean-Pierre Dalbéra, CC BY 2.0 |

The view outside every window is the *Frozen Lake* panorama by Alexander Scholten from Poly Haven (CC0), `windows/outside.jpg`.

The Barillet panel is a 20th-century work still under copyright; the photo is
openly licensed but the design is not, so keep this project to personal or educational use.

Source links are in `main.js` (`STYLES[...].credit.url`) and shown in the page.
