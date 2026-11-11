"""Exercise native import with an actual Worker, canvas, service worker and IndexedDB."""
import argparse
import json
import re
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class QuietServer(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.directory = str(self.server.active_release)
        super().do_GET()


def check_update(page, context, server, url, old_root, root):
    server.active_release = old_root
    page.goto(url)
    old_version = re.search(r'id="appVersion"[^>]*>([^<]+)', (old_root / 'index.html').read_text()).group(1)
    expect(page.locator('#appVersion')).to_have_text(old_version)
    expect(page.locator('#refreshApp')).to_have_attribute('data-update-state', 'current', timeout=20000)
    saved = page.evaluate('''async () => {
      const png = document.createElement('canvas').toDataURL('image/png');
      change(() => {
        state.name = 'Project before upgrade';
        state.cats = [{ id: 'prior', name: 'Original', visible: true, traits: [{ id: 'one', name: 'Original trait', data: png }] }];
        state.selected.prior = 'one';
      });
      return flushSave();
    }''')
    assert saved
    server.active_release = root
    page.locator('#refreshApp').click()
    expect(page.locator('#appVersion')).to_have_text('v0.7.92', timeout=30000)
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    assert page.evaluate("state.name === 'Project before upgrade' && state.cats[0].traits[0].name === 'Original trait'")
    page.locator('.file-menu summary').click()
    expect(page.get_by_role('button', name='Import z Procreate')).to_be_visible()
    context.set_offline(True)
    page.reload()
    expect(page.locator('#appVersion')).to_have_text('v0.7.92')
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    assert page.evaluate("state.name === 'Project before upgrade' && state.cats[0].traits[0].name === 'Original trait'")
    print(f'upgrade from {old_version}, retained IndexedDB project, new import entry and offline reload passed', flush=True)


def run(page, context, url, stress, mask):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('crash', lambda: errors.append('Page crashed'))
    page.goto(url)
    page.wait_for_function("document.querySelector('#appLayout').getAttribute('aria-busy') === 'false' && navigator.serviceWorker.controller")
    expect(page.locator('#appVersion')).to_have_text('v0.7.92')
    panel = page.locator('#catsPanel').bounding_box()
    canvas = page.locator('.stage').bounding_box()
    assert canvas['x'] < panel['x'] and .59 < canvas['width'] / (canvas['width'] + panel['width']) < .61, (panel, canvas)
    page.set_viewport_size({'width': 393, 'height': 780})
    expect(page.locator('.workspace-credit')).to_be_visible()
    assert page.locator('.workspace-credit').evaluate('el => getComputedStyle(el).opacity') == '0.35'
    page.set_viewport_size({'width': 852, 'height': 393})

    def pick(path):
        page.locator('.file-menu summary').click()
        with page.expect_file_chooser() as event:
            page.get_by_role('button', name='Import z Procreate').click()
        event.value.set_files(path)
        expect(page.locator('#psdTitle')).to_have_text('Vrstvy z Procreate')

    def choose(path):
        pick(path)
        expect(page.locator('#psdBody')).to_be_visible(timeout=30000)

    def durable_count():
        return page.evaluate('async () => (await TraitStorage.read(db, undefined, {lazy: true})).cats.flatMap(c => c.traits).length')

    def attempts(report=None):
        report = report if report is not None else page.evaluate('TraitDiagnostics.report()')
        return [json.loads(line[7:]) for line in report.splitlines() if line.startswith('Import ')]

    page.evaluate('''() => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, ...args) {
        if (message.type !== 'parse') return post.call(this, message, ...args);
        Worker.prototype.postMessage = post;
        window.continueOpening = () => post.call(this, message, ...args);
      };
    }''')
    pick(stress)
    expect(page.locator('#layerImportProgress')).to_be_visible()
    assert not page.locator('#layerImportBar').evaluate("element => element.hasAttribute('value')")
    assert attempts()[-1]['stage'] == 'opening'
    page.evaluate('continueOpening()')
    expect(page.locator('#psdBody')).to_be_visible(timeout=30000)
    expect(page.locator('#layerImportProgress')).not_to_be_visible()
    expect(page.locator('#psdTree input[data-node]')).to_have_count(610)
    page.get_by_role('button', name='Náhled Trait 0001').click()
    expect(page.locator('#psdPreviewName')).to_have_text('Trait 0001')
    assert page.locator('#psdPreview').evaluate('img => img.decode().then(() => img.naturalWidth)') == 1024
    page.locator('#psdConfirm').click()
    page.wait_for_function("document.getElementById('psdImportReason').textContent.includes('Průběžně uloženo 8 z')")
    expect(page.locator('#layerImportBar')).to_have_attribute('value', '1')
    page.locator('#psdCancel').click()
    expect(page.locator('#psdDialog')).not_to_be_visible()
    assert durable_count() == 8
    page.reload()
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    expect(page.locator('#recentFiles li')).to_have_count(1)
    assert page.locator('#recentFiles img').evaluate('img => img.decode().then(() => img.naturalWidth)') == 72
    cancelled = attempts()[-1]
    assert (cancelled['stage'], cancelled['saved'], cancelled['selected']) == ('cancelled', 8, 610)
    choose(stress)
    expect(page.locator('#psdTree input[data-imported=true]')).to_have_count(8)
    expect(page.locator('#psdTree input:checked')).to_have_count(602)
    # Fail the next manifest write after staging images, then verify rollback.
    page.evaluate('''() => {
      const put = IDBObjectStore.prototype.put;
      window.restoreManifestWrites = () => { IDBObjectStore.prototype.put = put; };
      IDBObjectStore.prototype.put = function (value, key) {
        if (key === 'current') throw new DOMException('Simulated full disk', 'QuotaExceededError');
        return put.call(this, value, key);
      };
    }''')
    page.locator('#psdConfirm').click()
    expect(page.locator('#psdStatus')).to_contain_text('nedostatku místa', timeout=25000)
    expect(page.locator('#layerImportBar')).to_have_attribute('value', '0')
    with page.expect_download() as failure_download:
        page.get_by_role('button', name='Stáhnout diagnostiku').click()
    report = failure_download.value.path().read_text(encoding='utf-8')
    failure = attempts(report)[-1]
    assert failure['stage'] == 'failed' and failure['failedAt'] == 'saving' and failure['code'] == 'QUOTA_EXCEEDED'
    assert failure['alreadySaved'] == 8 and failure['saved'] == 0 and failure['converted'] == 8
    assert 'stress-610' not in report and 'Simulated full disk' not in report
    assert durable_count() == 8
    page.evaluate('restoreManifestWrites()')
    page.locator('#psdCancel').click()
    choose(stress)
    expect(page.locator('#psdTree input[data-imported=true]')).to_have_count(8)
    page.locator('#psdConfirm').click()
    expect(page.locator('#layerImportBar')).to_have_attribute('value', '100', timeout=180000)
    expect(page.locator('#psdDialog')).not_to_be_visible(timeout=180000)
    assert durable_count() == 610
    completed = attempts()[-1]
    assert (completed['stage'], completed['saved'], completed['alreadySaved']) == ('complete', 602, 8)
    print('610 layers, cancel after 8, reload, quota rollback, resume and real IndexedDB passed', flush=True)
    page.locator('.file-menu summary').click()
    page.get_by_role('button', name='Finál', exact=True).click()
    page.get_by_role('button', name='Uložit projekt do Finálu').click()
    expect(page.locator('#finalStatus')).to_contain_text('uložená v tomto zařízení', timeout=30000)
    page.get_by_role('button', name='Připravit ZIP').click()
    with page.expect_download() as zipped:
        page.get_by_role('link', name='Stáhnout ZIP').click(timeout=30000)
    with zipfile.ZipFile(zipped.value.path()) as archive:
        assert sum(name.endswith('.png') for name in archive.namelist()) == 610
        assert archive.testzip() is None
    page.get_by_role('button', name='Zavřít Finál').click()
    print('610-layer project archived in Final and all 610 PNG entries verified in ZIP', flush=True)
    choose(stress)
    expect(page.locator('#psdTree input[data-imported=true]')).to_have_count(610)
    expect(page.locator('#psdConfirm')).to_be_disabled()
    page.locator('#psdCancel').click()

    context.set_offline(True)
    page.reload()
    expect(page.locator('#appLayout')).to_have_attribute('aria-busy', 'false')
    choose(mask)
    expect(page.locator('#psdTree input[data-node]')).to_have_count(1)
    page.get_by_role('button', name='Náhled Layer 1').click()
    expect(page.locator('#psdPreviewName')).to_have_text('Layer 1')
    page.locator('#psdConfirm').click()
    expect(page.locator('#psdDialog')).not_to_be_visible(timeout=30000)
    assert durable_count() == 611
    page.locator('#undo').click()
    page.wait_for_function("(async () => (await TraitStorage.read(db, undefined, {lazy: true})).cats.flatMap(c => c.traits).length === 610)()")

    pick({'name': 'broken.procreate', 'mimeType': 'application/zip', 'buffer': b'Broken ZIP'})
    expect(page.locator('#psdStatus')).to_contain_text('nepodařilo otevřít')
    expect(page.locator('#psdConfirm')).to_be_disabled()
    page.locator('#psdCancel').click()
    choose(mask)
    page.evaluate('''() => {
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, ...args) {
        if (message.type !== 'render') return original.call(this, message, ...args);
        Worker.prototype.postMessage = original;
        queueMicrotask(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Simulated worker failure' })));
      };
    }''')
    page.get_by_role('button', name='Náhled Layer 1').click()
    expect(page.locator('#psdStatus')).to_contain_text('zpracování vrstev se přerušilo', ignore_case=True)
    expect(page.locator('#psdConfirm')).to_be_disabled()
    page.locator('#psdCancel').click()
    assert durable_count() == 610
    assert attempts()[-1]['code'] == 'WORKER_INTERRUPTED'
    expect(page.locator('#recentFiles .recent-file-name')).to_have_text([mask.name, stress.name])
    expect(page.locator('#recentFiles img')).to_have_count(2)
    page.get_by_label('Další možnosti').click()
    page.get_by_role('button', name='Diagnostika', exact=True).click()
    expect(page.locator('#diagnosticsReport')).to_contain_text('WORKER_INTERRUPTED')
    page.get_by_role('button', name='Zavřít diagnostiku').click()
    expect(page.locator('#versionHistoryDialog')).not_to_be_visible()
    assert not errors, errors
    print('offline, progress (opening, 1%, 0% on failed retry, 100%), private diagnostics, worker interruption, undo, and both orientations passed', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stress', type=Path)
    parser.add_argument('mask', type=Path)
    parser.add_argument('--chromium', type=Path)
    parser.add_argument('--upgrade-from', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietServer, directory=root)) as server:
        server.active_release = root
        Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium, args=['--disable-gpu', '--disable-dev-shm-usage'])
            url = f'http://127.0.0.1:{server.server_port}/'
            if args.upgrade_from:
                upgrade_context = browser.new_context()
                check_update(upgrade_context.new_page(), upgrade_context, server, url, args.upgrade_from.resolve(), root)
                upgrade_context.close()
            context = browser.new_context(viewport={'width': 852, 'height': 393}, is_mobile=True, has_touch=True)
            run(context.new_page(), context, url, args.stress.resolve(), args.mask.resolve())
            browser.close()
