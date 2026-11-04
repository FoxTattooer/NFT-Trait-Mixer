"""Functional checks in a real Chromium browser, with isolated device storage."""
import base64
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import struct
import threading
import zlib
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def png(red, green, blue):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes([0, red, green, blue, 255]))) + chunk(b'IEND', b'')


def payload(name, data):
    return {'name': name, 'mimeType': 'image/png', 'buffer': data}


def panel(page, name, mobile):
    if mobile:
        page.locator(f'.workspace-tabs [data-panel="{name}"]').click()
    elif name != 'layers':
        page.locator(f'.inspector-tabs [data-panel="{name}"]').click()


def submit_dialog(page, value=None):
    page.locator('#editDialog').wait_for(state='visible')
    if value is not None:
        page.locator('#dialogInput').fill(value)
    page.locator('#dialogSubmit').click()
    page.locator('#editDialog').wait_for(state='hidden')


def color(page, expected):
    page.wait_for_function('(rgba) => {const p=document.getElementById("canvas").getContext("2d").getImageData(0,0,1,1).data; return rgba.every((v,i)=>p[i]===v)}', arg=expected)


def saved(page):
    page.wait_for_function('document.getElementById("saveStatus").textContent === "Automaticky uloženo v zařízení"')


def run_case(browser, url, mobile):
    label = 'mobile' if mobile else 'desktop'
    context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 844 if mobile else 1000}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    assert page.goto(url).status == 200
    page.wait_for_selector('#appLayout[aria-busy="false"]')
    assert page.title() == 'NFT Trait Workshop'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

    page.locator('#addCat').click()
    submit_dialog(page, 'Pozadí')
    panel(page, 'layers', mobile)
    page.locator('[data-action="rename-category"]').click()
    submit_dialog(page, 'Moje pozadí')
    panel(page, 'traits', mobile)
    page.locator('#traitFiles').set_input_files([payload('red.png', png(255, 0, 0)), payload('blue.png', png(0, 0, 255))])
    page.wait_for_function('document.querySelectorAll("#traits .trait-card").length === 3')
    color(page, [255, 0, 0, 255])
    page.locator('#traits button[title="blue"]').click()
    color(page, [0, 0, 255, 255])
    page.locator('[data-action="rename-trait"]').click()
    submit_dialog(page, 'Oceán')
    assert page.locator('#traitInfo').inner_text().find('Oceán') >= 0
    page.locator('#traits button[title="red"]').click()

    panel(page, 'layers', mobile)
    page.locator('#addCat').click()
    submit_dialog(page, 'Doplňky')
    page.locator('#traitFiles').set_input_files(payload('green.png', png(0, 255, 0)))
    page.wait_for_function('document.querySelectorAll("#traits .trait-card").length === 2')
    color(page, [255, 0, 0, 255])  # First category is on top.
    panel(page, 'layers', mobile)
    page.locator('[data-action="move-up"]').click()
    color(page, [0, 255, 0, 255])
    page.locator('[data-action="toggle-category"]').first.click()
    color(page, [255, 0, 0, 255])
    page.locator('[data-action="toggle-category"]').first.click()
    color(page, [0, 255, 0, 255])

    panel(page, 'rules', mobile)
    page.locator('#ruleSource').select_option(label='Moje pozadí / red')
    page.locator('#ruleAction').select_option('block')
    page.locator('#ruleTargetCat').select_option(label='Doplňky')
    page.locator('#ruleTargetTrait').select_option(label='green')
    page.locator('#addRule').click()
    assert page.locator('#warnings').inner_text().find('zakázaná kombinace') >= 0
    assert page.locator('#export').is_disabled()
    page.locator('#rulesEnabled').uncheck()
    assert page.locator('#export').is_enabled()
    page.locator('#rulesEnabled').check()
    page.locator('[data-action="delete-rule"]').click()
    page.locator('#ruleAction').select_option('hide')
    page.locator('#addRule').click()
    color(page, [255, 0, 0, 255])
    page.locator('[data-action="delete-rule"]').click()
    color(page, [0, 255, 0, 255])

    page.locator('#snapshot').click()
    submit_dialog(page, 'Oblíbená')
    panel(page, 'traits', mobile)
    page.locator('#traits [data-id=""]').click()
    color(page, [255, 0, 0, 255])
    panel(page, 'snapshots', mobile)
    page.locator('[data-action="load-snapshot"]').click()
    color(page, [0, 255, 0, 255])
    panel(page, 'traits', mobile)
    page.locator('[data-action="delete-trait"]').click()
    submit_dialog(page)
    assert page.locator('#traits .trait-card').count() == 1
    page.locator('#undo').click()
    color(page, [0, 255, 0, 255])
    page.locator('#redo').click()
    assert page.locator('#traits .trait-card').count() == 1
    page.locator('#undo').click()
    panel(page, 'layers', mobile)
    page.locator('[data-action="delete-category"]').click()
    submit_dialog(page)
    assert page.locator('.category-card').count() == 1
    page.locator('#undo').click()
    assert page.locator('.category-card').count() == 2
    color(page, [0, 255, 0, 255])

    with page.expect_download() as export:
        page.locator('#export').click()
    exported = Path(export.value.path()).read_bytes()
    assert exported.startswith(b'\x89PNG\r\n\x1a\n')
    assert struct.unpack('>II', exported[16:24]) == (1024, 1024)
    with page.expect_download() as backup:
        page.locator('#save').click()
    project = json.loads(Path(backup.value.path()).read_bytes())
    assert len(project['cats']) == 2 and len(project['snapshots']) == 1

    saved(page)
    page.reload()
    page.wait_for_selector('#appLayout[aria-busy="false"]')
    assert page.locator('.category-card').count() == 2
    color(page, [0, 255, 0, 255])
    # Invalid imports must leave the current project unchanged.
    page.locator('#projectFile').set_input_files({'name': 'broken.json', 'mimeType': 'application/json', 'buffer': b'{"cats":"bad"}'})
    page.wait_for_selector('#toast.is-error')
    assert page.locator('.category-card').count() == 2

    # Legacy JSON has no version, visibility flags, or snapshot IDs.
    legacy = {'cats': [{'id': 'old-cat', 'name': '<img src=x onerror=alert(1)>', 'traits': [{'id': 'old-trait', 'name': 'Původní PNG', 'data': 'data:image/png;base64,' + base64.b64encode(png(120, 40, 210)).decode()}]}], 'selected': {'old-cat': 'old-trait'}, 'rules': [], 'snapshots': [{'name': 'Stará sestava', 'selected': {'old-cat': 'old-trait'}}]}
    page.locator('#projectFile').set_input_files({'name': 'legacy.json', 'mimeType': 'application/json', 'buffer': json.dumps(legacy).encode()})
    submit_dialog(page)
    color(page, [120, 40, 210, 255])
    assert page.locator('#cats img').count() == 0  # Imported names are text.
    assert page.locator('.category-card').count() == 1
    saved(page)
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    cache_keys = page.evaluate('caches.keys()')
    assert any(url in key for key in cache_keys)
    manifest = page.evaluate('fetch("./manifest.webmanifest").then(r=>r.json())')
    assert manifest['display'] == 'standalone' and manifest['start_url'] == './'
    for image in manifest['icons']:
        assert page.evaluate('(src)=>fetch(src).then(r=>r.ok)', image['src'])

    context.set_offline(True)
    response = page.reload()
    assert response.status == 200 and response.from_service_worker
    page.wait_for_selector('#appLayout[aria-busy="false"]')
    color(page, [120, 40, 210, 255])
    panel(page, 'traits', mobile)
    page.locator('#traitFiles').set_input_files(payload('offline.png', png(10, 20, 30)))
    page.wait_for_function('document.querySelectorAll("#traits .trait-card").length === 3')
    page.locator('#traits button[title="offline"]').click()
    color(page, [10, 20, 30, 255])
    saved(page)
    panel(page, 'layers', mobile)
    page.locator('[data-action="delete-category"]').click()
    page.locator('[data-action="cancel-dialog"]').click()
    assert page.locator('.category-card').count() == 1
    page.locator('[data-action="delete-category"]').click()
    submit_dialog(page)
    assert page.locator('.category-card').count() == 0
    assert page.locator('#export').is_disabled()
    assert page.locator('#canvasEmpty').is_visible()
    page.locator('#undo').click()
    color(page, [10, 20, 30, 255])
    panel(page, 'traits', mobile)
    saved(page)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('#install').click()
    assert page.locator('#installDialog').is_visible()
    page.locator('[data-action="close-install"]').click()
    if mobile:
        page.set_viewport_size({'width': 320, 'height': 568})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('#export').bounding_box()['height'] < 65
        page.set_viewport_size({'width': 390, 'height': 844})
    context.set_offline(False)
    assert not errors, errors
    (ROOT / 'test-results').mkdir(exist_ok=True)
    page.screenshot(path=str(ROOT / 'test-results' / f'{label}.png'), full_page=True)
    print(f'PASS {label}: category/trait CRUD, layer order, visibility, undo/redo, rules, snapshots, PNG export, legacy JSON, autosave, safe import, subpath PWA and offline editing', flush=True)
    context.close()


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT.parent)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/{ROOT.name}/'
    try:
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
            options = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
            if executable:
                options['executable_path'] = executable
            browser = p.chromium.launch(**options)
            for mobile in (False, True):
                run_case(browser, url, mobile)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
