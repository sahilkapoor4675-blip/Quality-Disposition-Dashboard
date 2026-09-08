from PIL import Image, ImageOps
from pathlib import Path
root=Path('/mnt/data/favicon_work')
src=Image.open('/mnt/data/a_clean_vector_style_logo_graphic_on_a_white_backg.png').convert('RGB')
# Focus on the QA emblem so it remains legible at browser-tab size.
crop=src.crop((150,120,1240,790))
# Make a square white icon with the emblem centered.
side=max(crop.size)
canvas=Image.new('RGB',(side,side),'white')
canvas.paste(crop,((side-crop.width)//2,(side-crop.height)//2))
canvas=canvas.resize((1024,1024),Image.Resampling.LANCZOS)
for s in (16,32,48,64,128,180,192,256,512):
    canvas.resize((s,s),Image.Resampling.LANCZOS).save(root/f'favicon-{s}.png', optimize=True)
canvas.save(root/'favicon.ico', sizes=[(16,16),(32,32),(48,48),(64,64)], optimize=True)
# Web manifest for bookmark/home-screen identity.
(root/'site.webmanifest').write_text('''{\n  "name": "Quality Disposition Control",\n  "short_name": "Quality",\n  "start_url": "/",\n  "display": "standalone",\n  "background_color": "#ffffff",\n  "theme_color": "#0f2a4a",\n  "icons": [\n    {"src":"/favicon-192.png","sizes":"192x192","type":"image/png"},\n    {"src":"/favicon-512.png","sizes":"512x512","type":"image/png"}\n  ]\n}\n''')
for fn in ['index.html','admin.html']:
    p=root/fn
    txt=p.read_text()
    marker='<head>'
    tags='''\n    <link rel="icon" type="image/x-icon" href="/favicon.ico?v=qa1">\n    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=qa1">\n    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png?v=qa1">\n    <link rel="apple-touch-icon" sizes="180x180" href="/favicon-180.png?v=qa1">\n    <link rel="manifest" href="/site.webmanifest?v=qa1">\n'''
    if 'favicon.ico?v=qa1' not in txt:
        txt=txt.replace(marker, marker+tags, 1)
        p.write_text(txt)
