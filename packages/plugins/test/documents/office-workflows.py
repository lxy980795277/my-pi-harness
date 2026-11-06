"""Exercise the independent Skill CLIs and existing advanced formatting helpers."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

RESOURCE_ROOT = Path(sys.argv[1]).resolve()
DOCUMENT_VIEW_ROOT = Path(sys.argv[2]).resolve()
sys.argv = [sys.argv[0]]
BASE_ENV = {'PATH': os.defpath, 'LANG': 'en_US.UTF-8', 'LC_ALL': 'en_US.UTF-8'}


def materialize(name, folder):
    source = RESOURCE_ROOT / 'plugins' / name / 'skills' / name
    shutil.copytree(source, folder)
    manifest = json.loads((source / 'resource-manifest.json').read_text())
    for item in manifest['dependencies']:
        dependency = RESOURCE_ROOT / item['source']
        if item['source'] == 'utils/document-view/pdf_safety.py':
            dependency = DOCUMENT_VIEW_ROOT / 'pdf_safety.py'
        data = dependency.read_bytes()
        if hashlib.sha256(data).hexdigest() != item['hash']:
            raise ValueError('Resource dependency hash mismatch')
        target = folder / item['target']
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


class SkillWorkflows(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='skill-office-')
        self.root = Path(self.temporary.name)
        for name in ('documents', 'pdf', 'spreadsheets', 'presentations'):
            materialize(name, self.root / name)
        self.addCleanup(self.temporary.cleanup)

    def command(self, skill, script, *args, success=True):
        result = subprocess.run([sys.executable, '-B', '-s', str(self.root / skill / 'scripts' / script), *map(str,args)],
            cwd=self.root, env=BASE_ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result.stderr.decode()

    def python(self, skill, code):
        environment = dict(BASE_ENV, PYTHONPATH=str(self.root / skill / 'scripts'))
        result = subprocess.run([sys.executable, '-B', '-s', '-c', code], cwd=self.root, env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_dependencies_are_explicit(self):
        for name, script in [('documents','docx_edit.py'), ('pdf','pdf_edit.py'), ('spreadsheets','xlsx_check.py'), ('presentations','pptx_check.py')]:
            report = self.command(name,script,'dependencies')
            self.assertEqual(report['missingModules'], [])
            self.assertIn('installation',report)

    def test_docx_review_notes_fields_merge_and_create_only(self):
        self.python('documents', "from documents import docx; docx({'paragraphs':[{'text':'项目报告','heading':1},{'text':'Original paragraph'}], 'tables':[{'rows':[['项目','数量'],['甲','1']], 'headerRows':1}], 'layout':{'width':595,'height':842}, 'footer':{'text':'页','pageNumbers':True}}, 'source.docx')")
        before = (self.root/'source.docx').read_bytes()
        self.command('documents','docx_edit.py','track','source.docx','tracked.docx','Original','Reviewed','--author','审阅者')
        report = self.command('documents','docx_edit.py','inspect','tracked.docx')
        self.assertEqual(report['revisions'],2)
        self.command('documents','docx_edit.py','revisions','tracked.docx','accepted.docx','accept')
        self.command('documents','docx_edit.py','revisions','tracked.docx','rejected.docx','reject')
        self.assertIn('Original',self.command('documents','docx_edit.py','inspect','rejected.docx')['text'])
        self.command('documents','docx_edit.py','comment','accepted.docx','comment.docx','--paragraph','1','--text','核对','--author','审阅者')
        self.command('documents','docx_edit.py','note','comment.docx','note.docx','--paragraph','1','--type','footnote','--text','脚注')
        self.command('documents','docx_edit.py','note','note.docx','endnote.docx','--paragraph','1','--type','endnote','--text','尾注')
        self.command('documents','docx_edit.py','bookmark','endnote.docx','bookmark.docx','--paragraph','1','--name','Anchor')
        self.command('documents','docx_edit.py','field','bookmark.docx','field.docx','--type','ref','--target','Anchor')
        self.command('documents','docx_edit.py','field','field.docx','toc.docx','--type','toc')
        report=self.command('documents','docx_edit.py','inspect','toc.docx')
        self.assertEqual(report['comments'],1);self.assertTrue(report['footnotes']);self.assertTrue(report['endnotes']);self.assertEqual(report['bookmarks'],['Anchor'])
        self.assertTrue(any('TOC' in value for value in report['fields']))
        self.assertEqual((self.root/'source.docx').read_bytes(),before)
        self.assertIn('already exists',self.command('documents','docx_edit.py','replace','source.docx','source.docx','Original','X',success=False))
        self.command('documents','docx_edit.py','merge','source.docx','merged.docx','accepted.docx')
        self.assertIn('complex', self.command('documents','docx_edit.py','merge','source.docx','bad.docx','tracked.docx',success=False))

    def test_pdf_flow_form_choices_pages_render_and_rejections(self):
        self.python('pdf', "from pdfs import pdf; pdf({'flow':[{'kind':'heading','text':'中文长表','level':1},{'kind':'table','rows':[['项目','数值']]+[['行'+str(i),str(i)] for i in range(100)],'headerRows':1}], 'layout':{'pageNumbers':True}},'flow.pdf'); from reportlab.pdfgen import canvas; c=canvas.Canvas('form.pdf'); c.drawString(30,800,'Form'); c.acroForm.textfield(name='name',x=30,y=700,width=180,height=24); c.acroForm.checkbox(name='agree',x=30,y=650); c.acroForm.choice(name='region',x=30,y=600,width=180,height=24,options=[('East','east'),('West','west')],value='east'); c.showPage(); c.save()")
        report=self.command('pdf','pdf_edit.py','inspect','flow.pdf');self.assertGreater(report['pages'],1)
        self.command('pdf','pdf_edit.py','select','flow.pdf','selected.pdf','2','1')
        self.command('pdf','pdf_edit.py','rotate','selected.pdf','rotated.pdf','--page','1','--degrees','90')
        self.command('pdf','pdf_edit.py','append','rotated.pdf','appended.pdf','selected.pdf')
        self.assertEqual(self.command('pdf','pdf_edit.py','inspect','appended.pdf')['pages'],4)
        report=self.command('pdf','pdf_edit.py','form','form.pdf','filled.pdf','--set','name','"Alice"','--set','agree','true','--set','region','"west"')
        self.assertEqual(next(item for item in report['fields'] if item['name']=='region')['value'],'west')
        self.command('pdf','pdf_edit.py','form','form.pdf','bad.pdf','--set','region','"unknown"',success=False)
        self.command('pdf','pdf_edit.py','form','form.pdf','flatten.pdf','--flatten',success=False)
        result=subprocess.run([sys.executable,'-B',str(DOCUMENT_VIEW_ROOT/'render_pdf_pages.py'),'--source',str(self.root/'filled.pdf'),'--pages','1','--max-pixels','600'],capture_output=True,env=BASE_ENV,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(len(json.loads(result.stdout)['images']),1)
        self.python('pdf',"from pypdf import PdfWriter; w=PdfWriter(clone_from='form.pdf'); w.encrypt('test'); w.write('encrypted.pdf')")
        self.assertIn('Encrypted',self.command('pdf','pdf_edit.py','inspect','encrypted.pdf',success=False))

    def test_workbook_formulas_chart_caches_and_template_presentation(self):
        self.python('spreadsheets',"from spreadsheets import xlsx; xlsx({'sheets':[{'name':'Data','rows':[['Name','Amount'],['A',10],['B',20]],'cells':[{'cell':'B4','value':'=SUM(B2:B3)','numberFormat':'0.00'}], 'tables':[{'name':'Sales','range':'A1:B3'}], 'charts':[{'anchor':'D2','chart':{'kind':'bar','categories':['A','B'],'series':[{'name':'Sales','values':[10,20]}]}}]}]}, 'source.xlsx')")
        report=self.command('spreadsheets','xlsx_check.py','inspect','source.xlsx')
        self.assertEqual(report['charts'],1);self.assertEqual(report['formulaCaches'][0]['cachedValue'],None)
        self.python('presentations',"from presentations import pptx; chart={'kind':'bar','categories':['A','B'],'series':[{'name':'Sales','values':[10,20]}]}; pptx({'width':12,'height':7,'slides':[{'shapes':[{'kind':'text','x':0.5,'y':0.5,'width':5,'height':0.5,'text':'Title'},{'kind':'table','x':0.5,'y':2,'width':4,'height':2,'rows':[['A','B'],['1','2']]},{'kind':'chart','x':5,'y':2,'width':5,'height':4,'chart':chart}]}]},'source.pptx'); pptx({'source':'source.pptx','edits':[{'slide':0,'shape':0,'kind':'text','text':'Edited'}]},'edited.pptx')")
        report=self.command('presentations','pptx_check.py','inspect','edited.pptx','--template','source.pptx')
        self.assertEqual(report['slides'][0]['shapes'][0]['text'],'Edited')

    def test_rejects_unsafe_packages_formula_links_and_complex_revisions(self):
        self.python('documents', "from documents import docx; docx({'paragraphs':[{'text':'Original'}]}, 'plain.docx'); import zipfile; from common import xml, tag, set_xml; z=zipfile.ZipFile('plain.docx'); parts={n:z.read(n) for n in z.namelist()}; z.close(); root=xml(parts['word/document.xml']); from lxml import etree as E; E.SubElement(next(root.iter(tag('w','p'))),tag('w','moveFrom')); set_xml(parts,'word/document.xml',root); z=zipfile.ZipFile('complex.docx','w'); [z.writestr(n,b) for n,b in parts.items()]; z.close(); parts['word/vbaProject.bin']=b'active'; z=zipfile.ZipFile('macro.docx','w'); [z.writestr(n,b) for n,b in parts.items()]; z.close()")
        self.assertIn('Complex revisions',self.command('documents','docx_edit.py','revisions','complex.docx','out.docx','accept',success=False))
        self.assertIn('Macros',self.command('documents','docx_edit.py','inspect','macro.docx',success=False))
        self.assertFalse((self.root/'out.docx').exists())
        self.command('documents','convert_pdf.py','macro.docx','macro.pdf',success=False)
        self.assertFalse((self.root/'macro.pdf').exists())
        self.python('spreadsheets', "from openpyxl import Workbook; w=Workbook(); w.active['A1']='=WEBSERVICE(123)'; w.save('active.xlsx')")
        self.assertIn('External/network/DDE',self.command('spreadsheets','xlsx_check.py','inspect','active.xlsx',success=False))
        self.python('spreadsheets', "from spreadsheets import safe_value; import unittest; t=unittest.TestCase(); t.assertRaises(ValueError,safe_value,'=WEBSERVICE(123)')")
        result=subprocess.run([sys.executable,'-B','-S',str(self.root/'documents/scripts/docx_edit.py'),'inspect',str(self.root/'plain.docx')],capture_output=True,env=BASE_ENV,timeout=10)
        self.assertNotEqual(result.returncode,0);self.assertIn(b'Missing Python modules',result.stderr)

    def test_simple_pdf_repair_flatten_and_choice_appearance(self):
        self.python('pdf', "from reportlab.pdfgen import canvas; c=canvas.Canvas('text.pdf'); c.acroForm.textfield(name='name',x=40,y=700,width=180,height=30); c.showPage(); c.save(); from pypdf import PdfWriter; w=PdfWriter(clone_from='text.pdf'); w.root_object['/AcroForm'].get_object().pop('/Fields'); w.write('orphan.pdf')")
        repaired=self.command('pdf','pdf_edit.py','form','orphan.pdf','repaired.pdf','--repair','--set','name','\"Repaired\"')
        self.assertEqual(repaired['fields'][0]['value'],'Repaired')
        flattened=self.command('pdf','pdf_edit.py','form','repaired.pdf','flat.pdf','--flatten','--set','name','\"Repaired\"')
        self.assertEqual(flattened['fields'],[])
        self.python('pdf', "from pypdf import PdfReader; r=PdfReader('repaired.pdf'); a=r.pages[0]['/Annots'][0].get_object(); assert '/N' in a['/AP']; assert b'Repaired' in a['/AP']['/N'].get_object().get_data()")

    def test_native_docx_typography_image_page_field_and_preserved_parts(self):
        self.python('documents', """
from PIL import Image
from cli_support import new_output
from documents import docx
from common import read_package, xml, tag
Image.new('RGB',(120,60),'navy').save('figure.png')
settings={'layout':{'width':595,'height':842,'margins':{'top':54,'right':48,'bottom':54,'left':48},'footerDistance':24},
 'defaultFont':{'name':'Arial','size':11},
 'styles':[{'name':'Body custom','basedOn':'Normal','font':{'size':12},'format':{'lineSpacing':1.5}}],
 'header':{'text':'Report','alignment':'right'},'footer':{'text':'Page ','pageNumber':True},
 'paragraphs':[{'text':'标题','heading':1},{'runs':[{'text':'Status: '},{'text':'Approved','font':{'bold':True,'color':'166534'}}],'style':'Body custom'}],
 'tables':[{'rows':[['项目','值'],['甲','42']],'headerRows':1}],
 'images':[{'source':'figure.png','width':144,'altText':'Test chart'}]}
r=new_output('formatted.docx','.docx',lambda out:docx(settings,out))
assert r['imageCount']==1 and r['sections'][0]['size']=={'w':595.0,'h':842.0}
parts=read_package('formatted.docx'); d=xml(parts['word/document.xml'])
assert len(list(d.iter(tag('w','tblHeader'))))==1
assert any(n.get(tag('w','val'))=='1' for n in d.iter(tag('w','b')))
assert b'Test chart' in parts['word/document.xml']
footer=next(name for name in parts if name.startswith('word/footer') and name.endswith('.xml'))
assert next(xml(parts[footer]).iter(tag('w','fldSimple'))).get(tag('w','instr'))==' PAGE '
new_output('styled.docx','.docx',lambda out:docx({'source':'formatted.docx','operations':[{'kind':'format_paragraph','paragraph':1,'font':{'italic':True}}]},out))
assert set(parts).issubset(read_package('styled.docx'))
""")

    def test_pdf_multiselect_export_values_and_visible_appearances(self):
        self.python('pdf', """
from reportlab.pdfgen import canvas
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, NameObject, TextStringObject
c=canvas.Canvas('base.pdf'); c.drawString(30,790,'Choices')
c.acroForm.choice(name='color',options=['Red','Blue'],value='Red',fieldFlags='combo',x=40,y=700,width=180,height=25)
c.acroForm.listbox(name='tags',options=['A','B','C'],value=['A'],fieldFlags='multiSelect',x=40,y=550,width=180,height=100)
c.showPage();c.save()
w=PdfWriter(clone_from='base.pdf');f=w.get_fields()['color'].indirect_reference.get_object()
f[NameObject('/Opt')]=ArrayObject(ArrayObject([TextStringObject(v),TextStringObject(label)]) for v,label in [('red','Red'),('blue','Blue')])
f[NameObject('/V')]=TextStringObject('red');w.write('choices.pdf')
""")
        before=(self.root/'choices.pdf').read_bytes()
        report=self.command('pdf','pdf_edit.py','form','choices.pdf','chosen.pdf','--set','color','"blue"','--set','tags','["A","C"]')
        self.assertEqual(next(item for item in report['fields'] if item['name']=='tags')['value'],['A','C'])
        self.python('pdf', """
from pypdf import PdfReader
r=PdfReader('chosen.pdf'); f=r.get_fields()
assert list(f['tags'].indirect_reference.get_object()['/I'])==[0,2]
assert f['color']['/V']=='blue'
for ref in r.pages[0]['/Annots']:
 assert ref.get_object()['/AP']['/N'].get_object().get_data()
""")
        self.command('pdf','pdf_edit.py','form','choices.pdf','invalid.pdf','--set','tags','["A","A"]',success=False)
        self.command('pdf','pdf_edit.py','form','choices.pdf','invalid.pdf','--set','color','["blue"]',success=False)
        self.assertEqual((self.root/'choices.pdf').read_bytes(),before)


if __name__ == '__main__': unittest.main()
