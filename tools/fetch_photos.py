"""Download the source photographs into tools/photos/.  Usage: python3 tools/fetch_photos.py"""
import json, os, urllib.parse, urllib.request

UA = {'User-Agent': 'LeadAndLight/1.0 (stained glass demo)'}
SOURCES = {  # Wikimedia Commons file titles, or direct museum URLs
    'gothic': 'Chartres - cathédrale - ND de la belle verrière.JPG',
    'gothic_detail': 'Vitrail Chartres Notre-Dame 210209 1.jpg',
    'gothic_context': 'Vitrail Chartres-030.jpg',
    'victorian': 'https://images.metmuseum.org/CRDImages/ad/original/DT219912.jpg',
    'nouveau': 'Magnolias and Irises MET DT280214.jpg',
    'deco': 'Paris atelier barillet vitrail athenes.jpg',
    'mission': 'Greene & Greene - Tichenor casement windows - center pane - HNT.jpg',
    'mission_left': 'Greene & Greene - Tichenor casement windows - left pane - HNT.jpg',
    'mission_right': 'Greene & Greene - Tichenor casement windows - right pane - HNT.jpg',
    'prairie': 'Tree of Life window for the Darwin D. Martin House, by Frank Lloyd Wright, American, 1904, glass, brass - Princeton University Art Museum - DSC06964.jpg',
    'mackintosh': 'Vitrail du hall dentrée (House for an art lover, Glasgow) (3809393032).jpg',
}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()

def commons_url(title, width=1800):
    q = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'titles': 'File:' + title,
                                'prop': 'imageinfo', 'iiprop': 'url', 'iiurlwidth': width})
    page = next(iter(json.loads(get('https://commons.wikimedia.org/w/api.php?' + q))['query']['pages'].values()))
    return page['imageinfo'][0]['thumburl']

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'photos')
os.makedirs(out, exist_ok=True)
for name, src in SOURCES.items():
    url = src if src.startswith('http') else commons_url(src)
    open(os.path.join(out, name + '.jpg'), 'wb').write(get(url))
    print(name, '<-', url)
