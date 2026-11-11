"""Verify the in-app PDF reader and return flow at iPhone viewport sizes."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MENU = '.header-end .header-menu > summary'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def open_pdf_info(page):
    page.locator(MENU).click()
    page.get_by_role('button', name='PDF info', exact=True).click()
    page.locator('#pdfInfoDialog[open]').wait_for()


def wait_for_page(page, number):
    page.wait_for_function('''number => {
        const canvas = document.querySelector(`#pdfPages [data-page="${number}"] canvas`);
        return canvas?.width > 100 && canvas.getContext('2d').getImageData(5, 5, 1, 1).data[3] > 0;
    }''', arg=number)


def run(browser, url):
    context = browser.new_context(viewport={'width': 393, 'height': 852},
                                  is_mobile=True, has_touch=True, device_scale_factor=3)
    page = context.new_page()
    page.set_default_timeout(12000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    assert page.goto(url).ok
    page.wait_for_selector('#appLayout[aria-busy="false"]')
    page.wait_for_function('navigator.serviceWorker.controller !== null')

    project = {
        'name': 'PDF test',
        'selected': {},
        'rules': [],
        'cats': [{'id': f'category-{index}', 'name': f'Kategorie {index}', 'visible': True, 'traits': []}
                 for index in range(30)],
    }
    page.locator('#projectFile').set_input_files({
        'name': 'test.json', 'mimeType': 'application/json', 'buffer': json.dumps(project).encode(),
    })
    page.wait_for_function('document.querySelector("#projectNameText").textContent === "PDF test"')
    page.evaluate('window.scrollTo(0, 160)')

    open_pdf_info(page)
    before = page.evaluate('window.scrollY')
    page.get_by_role('button', name='Mobilní design').click()
    wait_for_page(page, 1)
    assert page.locator('#pdfPages li').count() == 9
    page.locator('#pdfPages [data-page="9"]').scroll_into_view_if_needed()
    wait_for_page(page, 9)
    assert page.get_by_role('button', name='Zpět do editoru', exact=True).is_visible()

    page.set_viewport_size({'width': 852, 'height': 393})
    exit_box = page.locator('#pdfExit').bounding_box()
    assert exit_box and 0 <= exit_box['y'] <= 30
    assert exit_box['x'] + exit_box['width'] <= 852
    page.locator('#pdfBack').click()
    page.get_by_role('button', name='Popis aplikace').click()
    wait_for_page(page, 1)
    assert page.locator('#pdfPages li').count() == 19
    page.locator('#pdfPages [data-page="2"]').scroll_into_view_if_needed()
    page.locator('#pdfPages [data-page="2"] a[href="#"]').first.click()
    page.wait_for_function('''() => {
        const page = document.querySelector('#pdfPages [data-page="3"]');
        const scroll = document.querySelector('#pdfScroll');
        return Math.abs(page.getBoundingClientRect().top - scroll.getBoundingClientRect().top) < 2;
    }''')
    wait_for_page(page, 3)
    page.set_viewport_size({'width': 393, 'height': 852})
    page.locator('#pdfExit').click()
    page.locator('#pdfInfoDialog').wait_for(state='hidden')
    assert page.url == url
    assert len(context.pages) == 1
    assert page.evaluate('document.querySelector("#projectNameText").textContent') == 'PDF test'
    assert page.evaluate('Math.abs(window.scrollY - %s) < 2' % before)
    assert page.locator('#pdfPages li').count() == 0

    # The in-app viewer can reuse documents that were opened while online.
    context.set_offline(True)
    open_pdf_info(page)
    page.get_by_role('button', name='Mobilní design').click()
    wait_for_page(page, 1)
    page.locator('#pdfBack').click()
    page.get_by_role('button', name='Popis aplikace').click()
    wait_for_page(page, 1)
    page.locator('#pdfExit').click()
    assert not errors, errors
    context.close()


if __name__ == '__main__':
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=ROOT)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as playwright:
            if os.environ.get('PDF_TEST_BROWSER') == 'webkit':
                browser = playwright.webkit.launch()
            else:
                browser = playwright.chromium.launch(
                    executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                    args=['--no-sandbox'],
                )
            run(browser, f'http://127.0.0.1:{server.server_port}/')
            browser.close()
    print('PDF info: portrait, landscape, both PDFs, internal links, editor return, and offline reading passed.')
