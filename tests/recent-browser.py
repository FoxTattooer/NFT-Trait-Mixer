"""Verify the recent files panel with real PSD, PSB, Procreate and JSON opens."""
import argparse
import json
import subprocess
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class QuietServer(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def photoshop_fixture(root, psb=False):
    return subprocess.check_output(['node', '-e', '''
        const { createCanvas } = require('@napi-rs/canvas');
        const ag = require('ag-psd');
        ag.initializeCanvas(createCanvas);
        const canvas = createCanvas(24, 24);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#25b7d5';
        ctx.fillRect(0, 0, 24, 24);
        const psb = process.argv[1] === 'true';
        const imageResources = psb ? {} : { thumbnailRaw: { width: 24, height: 24, data: canvas.toBuffer('image/jpeg') } };
        const children = [{ name: 'Vrstva', canvas }];
        process.stdout.write(Buffer.from(ag.writePsd({ width: 24, height: 24, imageResources, children }, { psb, noBackground: true })));
    ''', str(psb).lower()], cwd=root)


def run(context, url, root, procreate):
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('crash', lambda: errors.append('Page crashed'))
    page.goto(url)
    page.wait_for_function("document.querySelector('#appLayout').getAttribute('aria-busy') === 'false' && navigator.serviceWorker.controller")

    def show_history():
        page.locator('button[data-panel="snapshots"]:visible').first.click()
        expect(page.get_by_role('heading', name='Historie otevření')).to_be_visible()

    names = page.locator('#recentFiles .recent-file-name')
    previews = page.locator('#recentFiles img')
    show_history()
    expect(page.locator('#recentFilesEmpty')).to_be_visible()
    assert page.locator('.snapshot-export + .recent-files').count() == 1

    def pick_photoshop(file_name, data, fallback=False):
        page.locator('#psdFile').set_input_files({'name': file_name, 'mimeType': 'image/vnd.adobe.photoshop', 'buffer': data})
        expect(page.locator('#psdBody')).to_be_visible(timeout=20000)
        if fallback:
            page.get_by_role('button', name='Náhled Vrstva').click()
            expect(page.locator('#psdPreviewName')).to_have_text('Vrstva')
        page.locator('#psdCancel').click()

    psd_name = 'Moje hodně dlouhá grafika & vzory.PSD'
    psd = photoshop_fixture(root)
    pick_photoshop(psd_name, psd)
    expect(names).to_have_text([psd_name])
    expect(previews).to_have_count(1)
    expect(page.locator('.recent-file-name span:last-child')).to_have_text('.PSD')
    pick_photoshop('Velký dokument.psb', photoshop_fixture(root, psb=True), fallback=True)
    expect(names).to_have_text(['Velký dokument.psb', psd_name])
    expect(previews).to_have_count(2)

    page.locator('#procreateFile').set_input_files(procreate)
    expect(page.locator('#psdBody')).to_be_visible(timeout=20000)
    page.locator('#psdCancel').click()
    expect(names).to_have_text([procreate.name, 'Velký dokument.psb', psd_name])
    expect(previews).to_have_count(3)
    pick_photoshop(psd_name, psd)
    expect(names).to_have_text([psd_name, procreate.name, 'Velký dokument.psb'])

    project = page.evaluate('''() => {
      const next = M.empty(), canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#d52a77';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      next.cats = [{ id: 'heads', name: 'Hlavy', visible: true, traits: [{ id: 'pink', name: 'Růžová', data: canvas.toDataURL() }] }];
      next.selected.heads = 'pink';
      return next;
    }''')
    payload = json.dumps(project).encode()

    def pick_json(name, data=payload):
        page.locator('#projectFile').set_input_files({'name': name, 'mimeType': 'application/json', 'buffer': data})

    pick_json('Záloha.json')
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    show_history()
    expect(names.first).to_have_text('Záloha.json')
    expect(previews).to_have_count(4)
    pick_json('Poškozená.json', b'broken JSON')
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    pick_json('Zrušená.json')
    expect(page.locator('#editDialog')).to_be_visible()
    page.locator('#dialogCancel').click()
    expect(names).to_have_count(4)
    for i in range(5):
        pick_json(f'Projekt {i}.json')
        page.locator('#dialogSubmit').click()
        expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    expected = [f'Projekt {i}.json' for i in reversed(range(5))] + ['Záloha.json']

    context.set_offline(True)
    page.reload()
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    show_history()
    expect(names).to_have_text(expected)
    assert previews.evaluate_all('async imgs => Promise.all(imgs.map(async img => { await img.decode(); return img.naturalWidth; }))') == [72] * 6
    page.set_viewport_size({'width': 852, 'height': 393})
    show_history()
    expect(names).to_have_text(expected)
    assert page.locator('#recentFiles').evaluate('grid => grid.scrollWidth <= grid.clientWidth')
    assert not errors, errors
    print('PSD and Procreate embedded previews, PSB fallback, JSON, deduplication, invalid/cancelled files, six entries, offline and both layouts passed', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('procreate', type=Path)
    parser.add_argument('--chromium', type=Path)
    parser.add_argument('--webkit', action='store_true')
    parser.add_argument('--webkit-binary', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietServer, directory=root)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as playwright:
            browser = playwright.webkit.launch(executable_path=args.webkit_binary) if args.webkit else playwright.chromium.launch(
                executable_path=args.chromium, args=['--disable-gpu', '--disable-dev-shm-usage'])
            context = browser.new_context(viewport={'width': 393, 'height': 780}, is_mobile=True, has_touch=True)
            run(context, f'http://127.0.0.1:{server.server_port}/', root, args.procreate.resolve())
            browser.close()
