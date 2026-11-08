"""Follower report integration checks against synthetic X responses only.

Requires Python Playwright and its Chromium (or CHROMIUM=/path/to/browser).
Run: python3 tests/e2e_audience.py
Optional: TMPDIR and FL_SCREENSHOT keep profiles/downloads/screenshots in a
chosen test-artifact directory. No existing browser profile is opened.
"""

import csv
import io
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


EXT = Path(__file__).resolve().parent.parent
PAGE = """<!doctype html><html><head><title>Follower fixture</title></head>
<body><main><div data-testid="primaryColumn"><div data-testid="UserCell" role="button">
<div><div><a role="link" href="/builder"><div dir="ltr"><span>Builder</span></div></a></div>
<div><a role="link" href="/builder"><div dir="ltr"><span>@builder</span></div></a></div></div>
</div></div></main></body></html>"""


def user(uid, handle, followers=None, bio="", location=""):
    legacy = {"screen_name": handle, "name": handle, "description": bio,
              "location": location, "friends_count": 42,
              "created_at": "Mon Jan 01 00:00:00 +0000 2018"}
    if followers is not None:
        legacy["followers_count"] = followers
    return {"__typename": "User", "rest_id": str(uid), "legacy": legacy}


def entry(profile, entry_id=None):
    return {"entryId": entry_id or "user-" + profile["rest_id"],
            "content": {"entryType": "TimelineTimelineItem", "itemContent": {
                "itemType": "TimelineUser", "user_results": {"result": profile}}}}


def response(users, owner_id="123", extras=None):
    return {"data": {"user": {"result": {"__typename": "User", "rest_id": owner_id,
        "timeline": {"timeline": {"instructions": [{"type": "TimelineAddEntries",
            "entries": [entry(u) for u in users] + (extras or [])}]}}}}}}


def run():
    envelope = {"value": response([])}
    unexpected = []
    errors = []
    with sync_playwright() as pw, tempfile.TemporaryDirectory(prefix="fl-audience-") as profile:
        browser = os.environ.get("CHROMIUM") or pw.chromium.executable_path
        context = pw.chromium.launch_persistent_context(
            profile, executable_path=browser, headless=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
                  "--host-resolver-rules=MAP * ~NOTFOUND"],
            viewport={"width": 1360, "height": 1000}, accept_downloads=True)

        def route(request):
            url = request.request.url
            parsed = urlparse(url)
            if parsed.hostname == "x.com" and parsed.path.startswith("/i/api/graphql/"):
                request.fulfill(status=200, content_type="application/json",
                                body=json.dumps(envelope["value"]))
            elif parsed.hostname == "x.com" and parsed.path in {
                    "/owner/followers", "/owner/following", "/other/followers", "/home"}:
                request.fulfill(status=200, content_type="text/html", body=PAGE)
            elif parsed.scheme == "chrome-extension":
                request.continue_()
            else:
                unexpected.append(url)
                request.abort()

        context.route("**/*", route)
        context.on("page", lambda p: p.on("pageerror", lambda error: errors.append(str(error))))
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
        extension_id = urlparse(worker.url).hostname
        popup = context.new_page()
        popup.goto(f"chrome-extension://{extension_id}/popup.html")
        with context.expect_page() as opened:
            popup.locator("#openAudience").click()
        report = opened.value
        report.wait_for_url("**/audience.html")

        def rpc(action, **kwargs):
            result = report.evaluate("message => chrome.runtime.sendMessage(message)",
                                     {"type": "fl-audience", "action": action, **kwargs})
            assert result and result.get("ok"), result
            return result.get("dataset")

        def records():
            return (rpc("get") or {}).get("records", [])

        def expect_count(count):
            report.wait_for_function("""async expected => {
                const r = await chrome.runtime.sendMessage({type:'fl-audience', action:'get'});
                return r.ok && (r.dataset?.records || []).length === expected;
            }""", arg=count, timeout=7000)

        def fetch(page, users, operation="Followers", owner_id="123", extras=None, xhr=False):
            envelope["value"] = response(users, owner_id, extras)
            page.evaluate("""async options => {
                const variables = encodeURIComponent(JSON.stringify({userId:options.ownerId,count:20}));
                const url='/i/api/graphql/fixture/' + options.operation + '?variables=' + variables;
                if(options.xhr) return new Promise((resolve,reject)=>{
                    const request=new XMLHttpRequest(); request.open('GET',url);
                    request.onload=()=>resolve(); request.onerror=reject; request.send();
                });
                const response = await window.fetch(url);
                await response.json();
            }""", {"operation": operation, "ownerId": owner_id, "xhr": xhr})

        page = context.new_page()
        page.goto("https://x.com/owner/followers")
        builder = user("456", "builder", 12000, "Independent developer building AI agents", "Singapore")
        unknown = user("457", "unknown", None, "", "")
        zero = user("458", "zero", 0, "Designer", "Tokyo")
        fetch(page, [builder])
        report.wait_for_timeout(350)
        assert not records(), "capture must be opt-in"
        print("PASS capture is opt-in")

        report.locator("#ownerHandle").fill("owner")
        # Chrome-created tabs may start navigation before Playwright attaches
        # interception. Record the real API argument, then navigate under the
        # test router; DNS is disabled so that first navigation cannot go live.
        report.evaluate("""() => {
            const create=chrome.tabs.create;
            window.testOpenedUrls=[];
            chrome.tabs.create=function(options){
                window.testOpenedUrls.push(options.url);
                return create.call(chrome.tabs,options);
            };
        }""")
        with context.expect_page() as followers_opened:
            report.locator("#startCapture").click()
        page = followers_opened.value
        assert report.evaluate("window.testOpenedUrls") == ["https://x.com/owner/followers"]
        page.goto("https://x.com/owner/followers")
        fetch(page, [builder, unknown, zero], extras=[entry(user("999", "recommended", 900000), "who-to-follow-999")])
        expect_count(3)
        saved = {u["id"]: u for u in records()}
        assert saved["457"]["followers"] is None
        assert saved["458"]["followers"] == 0
        assert "999" not in saved
        page.wait_for_selector(".fl-badge")
        assert "1.2万" in page.locator(".fl-badge").first.inner_text()
        print("PASS scoped followers, unknown versus zero, recommendation isolation, existing badge")

        before_pages = rpc("get")["pages"]
        fetch(page, [unknown], xhr=True)
        report.wait_for_function("""async before => {
            const r=await chrome.runtime.sendMessage({type:'fl-audience',action:'get'});
            return r.dataset.pages>before;
        }""", arg=before_pages)
        assert len(records()) == 3
        print("PASS XHR captures a page with no follower-count fields")

        replacement = user("456", "builder", 15000, "Independent developer building AI agents", "Singapore")
        fetch(page, [replacement])
        report.wait_for_function("""async () => {
            const r=await chrome.runtime.sendMessage({type:'fl-audience',action:'get'});
            return r.dataset.records.find(u=>u.id==='456')?.followers === 15000;
        }""")
        assert len(records()) == 3
        print("PASS duplicate user ID updates without double counting")

        outsider = user("900", "outsider", 100000)
        fetch(page, [outsider], operation="Following")
        page.goto("https://x.com/home")
        fetch(page, [outsider])
        page.goto("https://x.com/other/followers")
        fetch(page, [outsider], owner_id="321")
        report.wait_for_timeout(350)
        assert len(records()) == 3
        print("PASS following, home, and different-owner responses are excluded")

        report.locator("#pauseCapture").click()
        report.wait_for_function("""async () => {
            const r=await chrome.runtime.sendMessage({type:'fl-audience',action:'get'});
            return !r.dataset.active;
        }""")
        page.goto("https://x.com/owner/followers")
        fetch(page, [outsider])
        report.wait_for_timeout(350)
        assert len(records()) == 3
        print("PASS pause stops capture")

        report.reload()
        expect_count(3)
        assert "非随机样本" in report.locator("body").inner_text()
        print("PASS report survives reload and discloses sample limits")

        report.locator("#bandFilter").select_option("unknown")
        assert report.locator("#peopleRows tr").count() == 1
        assert "@unknown" in report.locator("#peopleRows").inner_text()
        report.locator("#bandFilter").select_option("all")
        report.locator("#topicFilter").select_option("design")
        assert report.locator("#peopleRows tr").count() == 1
        assert "@zero" in report.locator("#peopleRows").inner_text()
        report.locator("#topicFilter").select_option("all")
        print("PASS unknown-count and topic filters")

        # UI filtering/export assertions are deliberately based on actual form
        # controls rather than replacing the runtime/storage implementation.
        report.locator("#search").fill("builder")
        report.wait_for_timeout(250)
        assert report.locator("#peopleRows tr").count() == 1
        with report.expect_download() as downloading:
            report.locator("#exportCsv").click()
        contents = Path(downloading.value.path()).read_text(encoding="utf-8-sig")
        exported = list(csv.DictReader(io.StringIO(contents)))
        assert len(exported) == 1 and "builder" in contents and "unknown" not in contents
        print("PASS search and filtered CSV export")

        report.locator("#search").fill("")
        screenshot = os.environ.get("FL_SCREENSHOT")
        if screenshot:
            report.screenshot(path=screenshot, full_page=True)

        rpc("start", ownerHandle="owner")
        page.reload()
        formula = user("460", "formula", 120,
                       '<img src="https://example.invalid/x" onerror="window.testXss=1">', "")
        formula["legacy"]["name"] = "=1+1"
        fetch(page, [formula])
        expect_count(4)
        report.locator("#search").fill("formula")
        report.wait_for_timeout(250)
        assert report.locator("#peopleRows img").count() == 0
        assert report.evaluate("window.testXss === undefined")
        with report.expect_download() as downloading:
            report.locator("#exportCsv").click()
        contents = Path(downloading.value.path()).read_text(encoding="utf-8-sig")
        exported = list(csv.DictReader(io.StringIO(contents)))
        assert len(exported) == 1 and "'=1+1" in exported[0].values()
        print("PASS profile text is inert and CSV formula cells are escaped")

        report.once("dialog", lambda dialog: dialog.accept())
        report.locator("#clearData").click()
        expect_count(0)
        fetch(page, [outsider])
        report.wait_for_timeout(350)
        assert not records(), "clear must not leave capture running"
        assert not unexpected, f"Unexpected network destinations: {unexpected}"
        assert not errors, f"Page errors: {errors}"
        print("PASS clear deletes samples and stops capture; no unexpected network or page errors")
        context.close()
    print("ALL PASS")


if __name__ == "__main__":
    run()
