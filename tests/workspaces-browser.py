"""Exercise document switching and customization in a real browser."""
import base64
import functools
import http.server
import json
import shutil
import struct
import zlib
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
def png_chunk(kind, data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
PNG = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+png_chunk(b'IDAT',zlib.compress(bytes([0,255,0,0,255])))+png_chunk(b'IEND',b'')).decode()


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

def project(name):
    return dict(version=2,name=name,cats=[dict(id='cat',name='Heads',visible=True,traits=[dict(id='trait',name='Hair',data=PNG,note='Original note')])],selected={'cat':'trait'},rules=[],snapshots=[],lookbookCards=[],organizer={})

def open_file(page, name, mode):
    page.locator('#projectFile').set_input_files({'name':name+'.json','mimeType':'application/json','buffer':json.dumps(project(name)).encode()})
    page.locator('#projectOpeningDialog').wait_for(state='visible')
    page.locator('[data-action="project-opening-'+mode+'"]').click()
    page.locator('#projectOpeningDialog').wait_for(state='hidden')
    page.wait_for_function('!busy')
    page.wait_for_function('revision === persistedRevision')

def switch(page, name):
    page.locator('#openProjectsButton').click()
    page.locator('#openProjectsDialog').wait_for(state='visible')
    page.locator('#openProjectsList button').filter(has=page.locator('strong',has_text=name)).click()
    page.locator('#openProjectsDialog').wait_for(state='hidden')
    page.wait_for_function('!busy')
    assert page.locator('#projectNameText').inner_text()==name

def run(browser, url, width, height):
    context=browser.new_context(viewport={'width':width,'height':height},service_workers='block',has_touch=True)
    page=context.new_page(); errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(url);page.locator('#appLayout[aria-busy="false"]').wait_for()
    open_file(page,'Project A','new')
    open_file(page,'Project B','new')
    assert page.locator('#projectNameText').inner_text()=='Project B'
    switch(page,'Project A')
    page.evaluate('change(()=>{state.cats[0].traits[0].note="Edited A";},"Edit note")')
    switch(page,'Project B')
    assert page.evaluate('state.cats[0].traits[0].note')=='Original note'
    assert page.locator('#undo').is_disabled()
    switch(page,'Project A')
    assert page.evaluate('state.cats[0].traits[0].note')=='Edited A'
    assert not page.locator('#undo').is_disabled()
    # Merge a file whose identifiers deliberately collide with the active project.
    open_file(page,'Project B','insert')
    assert page.locator('#projectNameText').inner_text()=='Project A'
    assert page.evaluate('state.cats.length')==2
    assert page.evaluate('new Set(state.cats.flatMap(c=>[c.id,...c.traits.map(t=>t.id)])).size')==4
    page.reload();page.locator('#appLayout[aria-busy="false"]').wait_for()
    assert page.locator('#projectNameText').inner_text()=='Project A'
    assert page.evaluate('state.cats.length')==2
    switch(page,'Project B')
    assert page.evaluate('state.cats.length')==1
    assert page.evaluate('state.cats[0].traits[0].note')=='Original note'
    # New document creation keeps both previous documents available.
    page.evaluate('handleAction("new-project")');page.wait_for_function('!busy')
    assert page.evaluate('state.cats.length')==0
    switch(page,'Project A')
    page.locator('#openProjectsButton').click();page.locator('#openProjectsDialog').wait_for(state='visible')
    page.screenshot(path=str(ROOT/'test-results'/f'projects-{width}.png'))
    assert page.locator('#openProjectsList [aria-current="true"]').count()==1
    assert page.locator('#openProjectsList img').count()>=2
    page.locator('[data-action="close-projects"]').click()
    # All fifteen controls are real and persist, and help works by tap and hold.
    page.evaluate('handleAction("open-settings")');page.locator('#settingsDialog').wait_for(state='visible')
    assert page.locator('.environment-field').count()==15
    for section in page.locator('.environment-section').all(): section.evaluate('(el)=>el.open=true')
    page.locator('#environment-rowHeight').fill('64')
    page.locator('#environment-preview').select_option('light')
    page.locator('#environment-motion').select_option('reduced')
    page.locator('#environment-helpDuration').fill('2')
    assert page.evaluate('getComputedStyle(document.querySelector(".stage .canvas-wrap")).backgroundColor')=='rgb(243, 243, 243)'
    help_button=page.get_by_role('button',name='Informace: Výška řádků',exact=True)
    help_button.click();page.locator('#settingsInformation').wait_for(state='visible')
    assert 'prstem' in page.locator('#settingsInformation').inner_text()
    page.locator('#settingsInformation').wait_for(state='hidden',timeout=3500)
    help_button.dispatch_event('pointerdown',{'pointerType':'touch'})
    page.locator('#settingsInformation').wait_for(state='visible')
    help_button.dispatch_event('pointerup',{'pointerType':'touch'})
    assert page.evaluate('document.querySelector("#settingsInformation").getBoundingClientRect().right <= innerWidth')
    page.screenshot(path=str(ROOT/'test-results'/f'settings-{width}.png'))
    page.locator('[data-action="close-settings"]').click()
    assert page.locator('#settingsInformation').is_hidden()
    page.reload();page.locator('#appLayout[aria-busy="false"]').wait_for()
    assert page.locator('#environment-rowHeight').input_value()=='64'
    assert page.locator('#environment-preview').input_value()=='light'
    assert page.evaluate('document.body.classList.contains("environment-reduced-motion")')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow'
    page.evaluate('handleAction("open-settings")');page.locator('#settingsDialog').wait_for(state='visible')
    page.locator('.environment-reset').click()
    assert page.locator('#environment-rowHeight').input_value()=='44'
    assert page.locator('#environment-preview').input_value()=='theme'
    assert not errors, errors
    print(f'PASS {width}×{height}: independent projects, undo, merge, restart, thumbnails, 15 preferences, tap/hold help and reset',flush=True)
    context.close()

def main():
    (ROOT/'test-results').mkdir(exist_ok=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
            for size in [(390,844),(844,390),(1440,1000)]: run(browser,f'http://127.0.0.1:{server.server_port}',*size)
            browser.close()
    finally: server.shutdown();server.server_close()

if __name__=='__main__':main()
