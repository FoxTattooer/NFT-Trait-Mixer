"""Verify Final snapshots, offline persistence and the extracted project backup."""
import argparse
import io
import json
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class QuietServer(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def seed(page, name):
    return page.evaluate('''async name => {
      const png = document.createElement('canvas').toDataURL('image/png');
      const next = M.empty();
      next.name = name;
      next.cats = [{ id: 'heads', name: 'Hlavy', visible: false, traits: [
        { id: 'dark', name: 'Černé / A', data: png, note: 'Poznámka k vrstvě' },
        { id: 'light', name: 'Světlé', data: png },
      ] }];
      next.organizer.heads = { folders: [
        { id: 'hair', name: 'Dready', parentId: null },
        { id: 'dark-group', name: 'Tmavé', parentId: 'hair' },
        { id: 'empty', name: 'Prázdná', parentId: 'dark-group' },
      ], assignments: { dark: 'dark-group' } };
      change(() => { state = next; active = 'heads'; layerOverview = false; });
      showPanel('layers');
      return flushSave();
    }''', name)


def run(context, url):
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    expect(page.locator('#appVersion')).to_have_text('v0.7.93')
    page.wait_for_function("document.querySelector('#appLayout').getAttribute('aria-busy') === 'false' && navigator.serviceWorker.controller")
    assert seed(page, 'Projekt A')

    def open_final():
        page.locator('.file-menu summary').click()
        page.get_by_role('button', name='Finál', exact=True).click()
        expect(page.locator('#finalDialog')).to_be_visible()

    open_final()
    page.get_by_role('button', name='Uložit projekt do Finálu').click()
    expect(page.locator('#finalLock')).to_be_visible()
    expect(page.locator('#finalTitle')).to_have_text('Projekt A')
    page.get_by_role('button', name='Zavřít Finál').click()

    page.get_by_role('button', name='Uložit kategorii do Finálu').click()
    expect(page.locator('#finalTitle')).to_have_text('Hlavy')
    page.get_by_role('button', name='Zavřít Finál').click()

    assert seed(page, 'Projekt B')
    page.get_by_role('button', name='Akce · Dready').click()
    page.get_by_role('button', name='Uložit do Finálu').click()
    expect(page.locator('#finalTitle')).to_have_text('Dready')
    expect(page.locator('#finalLock')).to_be_visible()
    page.get_by_role('button', name='Zavřít Finál').click()
    page.evaluate('''async () => {
      change(() => { state = M.empty(); active = null; });
      return flushSave();
    }''')
    page.close()

    context.set_offline(True)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    assert page.evaluate('state.cats.length') == 0
    open_final()
    expect(page.locator('#finalRows')).to_contain_text('Projekt A')
    expect(page.locator('#finalRows')).to_contain_text('Projekt B')
    page.locator('#finalRows').get_by_role('button', name='Dready', exact=False).click()
    page.get_by_role('button', name='Hlavy', exact=True).click()
    page.get_by_role('button', name='Dready', exact=True).click()
    expect(page.locator('#finalRows')).not_to_contain_text('Světlé')
    page.get_by_role('button', name='Tmavé', exact=True).click()
    expect(page.locator('#finalRows')).to_contain_text('Prázdná')
    with page.expect_download() as png_download:
        page.get_by_role('button', name='Stáhnout PNG · Černé / A').click()
    original_png = png_download.value.path().read_bytes()
    assert original_png[:8] == b'\x89PNG\r\n\x1a\n'

    page.get_by_role('button', name='Připravit ZIP').click()
    with page.expect_download() as zip_download:
        page.get_by_role('link', name='Stáhnout ZIP').click()
    assert zip_download.value.suggested_filename == 'Dready.zip'
    with zipfile.ZipFile(io.BytesIO(zip_download.value.path().read_bytes())) as archive:
        assert archive.testzip() is None
        root = 'Dready/01 Hlavy/01 Dready/01 Tmavé/'
        assert archive.getinfo(root + '01 Prázdná/').is_dir()
        assert archive.read(root + '02 Černé _ A.png') == original_png
        json_backup = archive.read('Dready/project.json')
    backed_up = json.loads(json_backup)
    assert backed_up['name'] == 'Projekt B'
    assert len(backed_up['cats'][0]['traits']) == 1
    assert backed_up['cats'][0]['traits'][0]['note'] == 'Poznámka k vrstvě'
    page.get_by_role('button', name='Zavřít Finál').click()
    page.locator('#projectFile').set_input_files({'name': 'project.json', 'mimeType': 'application/json', 'buffer': json_backup})
    page.wait_for_function("state.name === 'Projekt B' && state.cats[0].traits.length === 1")
    assert page.evaluate('state.organizer.heads.folders.length') == 3
    page.set_viewport_size({'width': 852, 'height': 393})
    open_final()
    assert page.locator('#finalDialog').bounding_box()['height'] <= 393
    assert not errors, errors
    print('two projects, frozen copy after editor deletion and offline restart, exact PNG, ZIP extraction, JSON restore and both layouts passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietServer, directory=root)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium, args=['--disable-gpu', '--disable-dev-shm-usage'])
            context = browser.new_context(viewport={'width': 393, 'height': 780}, is_mobile=True, has_touch=True)
            run(context, f'http://127.0.0.1:{server.server_port}/')
            browser.close()
