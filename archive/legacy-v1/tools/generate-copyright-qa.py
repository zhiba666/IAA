"""Render every PDF page using bundled Poppler and check page geometry/text bounds."""
import json, subprocess, hashlib
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
from pypdf import PdfReader
import pdfplumber
from docx import Document
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'deliverables/copyright';QA=ROOT/'docs/copyright/qa'
POPPLER=Path('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
QA.mkdir(parents=True,exist_ok=True)
report={}
for path in OUT.glob('*.pdf'):
    kind='manual' if '操作说明书' in path.name else 'program'
    folder=QA/kind;folder.mkdir(exist_ok=True)
    # Remove only renderer-owned files in this verified QA subdirectory so a
    # shorter revision cannot leave stale pages in the visual overview.
    for old in list(folder.glob('page-*.png'))+list(folder.glob('overview-*.jpg')):
        assert old.resolve().parent==folder.resolve() and folder.resolve().is_relative_to(QA.resolve())
        old.unlink()
    subprocess.run([str(POPPLER),'-r','115','-png',str(path),str(folder/'page')],check=True,capture_output=True)
    pages=PdfReader(path).pages
    details=[]
    with pdfplumber.open(path) as pdf:
        for i,page in enumerate(pdf.pages,1):
            chars=page.chars
            bounds=[min((c['x0'] for c in chars),default=0),min((c['top'] for c in chars),default=0),
                    max((c['x1'] for c in chars),default=0),max((c['bottom'] for c in chars),default=0)]
            lines=len(page.extract_text().splitlines())
            assert bounds[0]>=0 and bounds[1]>=0 and bounds[2]<=page.width+0.2 and bounds[3]<=page.height+0.2,(path.name,i,bounds)
            details.append({'page':i,'text_lines_including_headers':lines,'text_bounds_pt':bounds})
    images=sorted(folder.glob('page-*.png'))
    for start in range(0,len(images),9):
        selected=images[start:start+9];sheet=Image.new('RGB',(900,1320),'#e6e6e6');draw=ImageDraw.Draw(sheet)
        for j,item in enumerate(selected):
            image=Image.open(item).convert('RGB');image.thumbnail((286,407))
            x=7+(j%3)*300;y=22+(j//3)*440;sheet.paste(image,(x,y))
            draw.text((x,y-16),item.name,fill='black')
        sheet.save(folder/f'overview-{start//9+1}.jpg',quality=92)
    report[kind]={'file':path.name,'pages':len(pages),'all_pages_A4':all(abs(float(p.mediabox.width)-595.276)<1 and abs(float(p.mediabox.height)-841.89)<1 for p in pages),'details':details}
docx=next(OUT.glob('*.docx'));doc=Document(docx)
report['docx']={'file':docx.name,'paragraphs':len(doc.paragraphs),'inline_images':len(doc.inline_shapes),
                'author':doc.core_properties.author,'page_width_mm':doc.sections[0].page_width.mm,
                'page_height_mm':doc.sections[0].page_height.mm,'renderer':'Microsoft Word ExportAsFixedFormat, then Poppler',
                'standard_render_docx':'Attempted; missing soffice (WinError 2), Word used for actual DOCX rendering'}
manifest=json.loads((OUT/'source-manifest.json').read_text(encoding='utf-8'))
report['source_integrity']={'files':len(manifest['source_files']),'all_match_current_tree':True,'all_match_snapshot':True}
for item in manifest['source_files']:
    for base in [ROOT,OUT/'source-snapshot']:
        assert hashlib.sha256((base/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
(QA/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({key:{k:v for k,v in value.items() if k!='details'} for key,value in report.items()},ensure_ascii=False,indent=2))
