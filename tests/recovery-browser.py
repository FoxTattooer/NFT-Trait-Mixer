"""Exercise last-project recovery with a real renderer, IndexedDB and offline shell."""
import argparse
import asyncio
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.async_api import async_playwright, expect


class QuietServer(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


async def open_ready(context, url):
    page = await context.new_page()
    await page.goto(url)
    await page.wait_for_function("document.querySelector('#appLayout').getAttribute('aria-busy') === 'false' && navigator.serviceWorker.controller")
    return page


async def replace_current(page, damaged=False):
    await page.evaluate("""damaged => new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      const store = tx.objectStore('projects');
      if (damaged) store.put({storageFormat: 2, cats: [null]}, 'current');
      else store.delete('current');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      localStorage.clear();
    })""", damaged)


async def run(context, url, screenshot):
    page = await open_ready(context, url)
    await expect(page.locator('#projectRecovery')).to_be_hidden()
    await expect(page.locator('#emptyOpenBackup')).to_be_visible()
    await page.evaluate("""() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL();
      const project = M.empty();
      project.name = 'Rozpracovaný projekt';
      project.cats = [
        {id: 'background', name: 'Pozadí', visible: true, traits: []},
        {id: 'details', name: 'Detaily', visible: true, traits: [
          {id: 'trait', name: 'Červená vrstva', data: png, note: 'Dokončit okraj', flag: 'red'}
        ]}
      ];
      project.selected.details = 'trait';
      change(() => {state = M.normalize(project); active = 'details';});
    }""")
    await expect(page.locator('#saveStatus')).to_have_text('Automaticky uloženo v zařízení')
    await context.set_offline(True)
    # A renderer crash skips the application's unload and navigation handlers.
    session = await context.new_cdp_session(page)
    async with page.expect_event('crash', timeout=10000):
        crash = asyncio.create_task(session.send('Page.crash'))
    crash.cancel()
    await asyncio.gather(crash, return_exceptions=True)
    await page.close()

    page = await open_ready(context, url)
    await expect(page.locator('#projectRecovery')).to_be_hidden()
    await expect(page.locator('#projectNameText')).to_have_text('Rozpracovaný projekt')
    await expect(page.locator('#layerCategory')).to_have_value('details')

    # A fresh opening must offer the recovery record independently of recent history.
    await replace_current(page)
    await page.close()
    page = await open_ready(context, url)
    banner = page.locator('#projectRecovery')
    await expect(banner).to_be_visible()
    await expect(banner).to_contain_text('Rozpracovaný projekt')
    await expect(banner.locator('time')).not_to_be_empty()
    if screenshot:
        await banner.screenshot(path=screenshot)
    await banner.get_by_role('button', name='Přeskočit').click()
    await expect(banner).to_be_hidden()
    await expect(page.locator('#emptyOpenBackup')).to_be_visible()
    await page.locator('.file-menu summary').click()
    await page.get_by_role('button', name='Obnovit poslední projekt').click()
    await expect(page.locator('#projectNameText')).to_have_text('Rozpracovaný projekt')
    await expect(page.locator('#layerCategory')).to_have_value('details')
    await expect(banner).to_be_hidden()
    await expect(page.locator('#projectSource')).to_have_text('Obnoveno z automatické zálohy')
    assert await page.evaluate("""async () => {
      const p = await TraitStorage.read(db, undefined, {lazy: true});
      const trait = p.cats[1].traits[0];
      return p.selected.details === trait.id && trait.note === 'Dokončit okraj' &&
        trait.flag === 'red' && (await TraitStorage.imageBlob(db, trait.data)).size > 0;
    }""")

    await replace_current(page, damaged=True)
    await page.close()
    page = await open_ready(context, url)
    banner = page.locator('#projectRecovery')
    await expect(banner).to_be_visible()
    await banner.get_by_role('button', name='Obnovit projekt', exact=True).click()
    await expect(page.locator('#projectNameText')).to_have_text('Rozpracovaný projekt')
    assert await page.evaluate('flushSave()')
    await page.locator('.file-menu summary').click()
    await page.get_by_role('button', name='Nový projekt', exact=True).click()
    await page.locator('#editDialog').get_by_role('button', name='Nový projekt', exact=True).click()
    await expect(page.locator('#projectNameText')).to_have_text('Můj NFT projekt')
    assert await page.evaluate('flushSave()')
    await page.close()
    page = await open_ready(context, url)
    await expect(page.locator('#projectRecovery')).to_contain_text('Rozpracovaný projekt')
    await page.set_viewport_size({'width': 667, 'height': 375})
    await expect(page.locator('#projectRecovery').get_by_role('button', name='Obnovit projekt', exact=True)).to_be_visible()
    print('PASS renderer crash, offline reopen, missing and damaged project, dismissed prompt, restore of pixels and workspace, and retention after New Project')


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium', type=Path)
    parser.add_argument('--screenshot', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietServer, directory=root)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=args.chromium, args=['--disable-gpu', '--disable-dev-shm-usage'])
            context = await browser.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
            await context.add_init_script("localStorage.setItem('nft-color-scheme', 'graphite-grey');")
            await asyncio.wait_for(run(context, f'http://127.0.0.1:{server.server_port}/', args.screenshot), timeout=35)
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
