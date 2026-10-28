#!/usr/bin/env python3
"""Reproduz as fontes incorporadas dos PDFs. Dev: fontTools e fontes DejaVu locais; sem dependência de runtime."""
from fontTools import subset
from fontTools.ttLib import TTFont
from pathlib import Path
import io, json, base64
import argparse
args=argparse.ArgumentParser()
args.add_argument('--font-dir',default='/usr/share/fonts/truetype/dejavu')
args.add_argument('--licence',default='/usr/share/doc/fonts-dejavu-core/copyright')
options=args.parse_args()
project=Path(__file__).resolve().parents[1]
fonts={}
root=Path(options.font_dir)
for key,filename in [('sans','DejaVuSans.ttf'),('bold','DejaVuSans-Bold.ttf'),('serif','DejaVuSerif.ttf')]:
 font=TTFont(root/filename)
 opts=subset.Options();opts.layout_features=[];opts.name_IDs=[1,2,6];opts.name_languages=[0x409];opts.notdef_outline=True
 s=subset.Subsetter(opts)
 chars=set(range(32,592))|set(range(0x400,0x530))|set(range(0x2000,0x2070))|set(range(0x20a0,0x20d0))|{0x2212,0x2713}
 s.populate(unicodes=chars);s.subset(font)
 cmap=font.getBestCmap();order=font.getGlyphOrder();gids={name:i for i,name in enumerate(order)}
 em=font['head'].unitsPerEm
 widths=[round(font['hmtx'].metrics[g][0]/em*1000) for g in order]
 bbox=[round(getattr(font['head'],k)/em*1000) for k in ['xMin','yMin','xMax','yMax']]
 out=io.BytesIO();font.save(out)
 fonts[key]={'name':'INTGRA+'+filename[:-4].replace('-',''),'data':base64.b64encode(out.getvalue()).decode(),'map':{str(c):gids[g] for c,g in cmap.items()},'widths':widths,'bbox':bbox,'ascent':round(font['hhea'].ascent/em*1000),'descent':round(font['hhea'].descent/em*1000),'flags':6 if key=='serif' else 32}
path=project/'apps/api/src/lib/financial-fonts.ts'
path.write_text('/** DejaVu subsets (Latin/Cyrillic), generated offline with fontTools. Licence: financial-fonts-LICENSE.txt. */\nexport const FINANCIAL_FONTS = '+json.dumps(fonts,separators=(',',':'))+';\n')
lic=Path(options.licence)
(project/'apps/api/src/lib/financial-fonts-LICENSE.txt').write_text(lic.read_text())
print({k:len(base64.b64decode(v['data'])) for k,v in fonts.items()})
