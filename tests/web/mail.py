"""Browser integration tests using fixture credentials and mailbox data."""
import os
import sqlite3
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

url = os.environ["FOEFLOW_FIXTURE_ORIGIN"] + "/foeflow/#mail"
proof = os.environ.get("FOEFLOW_MAIL_PROOF")
password = "browser-fixture-password-only"


def sign_in(page, username, signup=False):
    expect(page.get_by_role("heading", name="登录 FoeFlow")).to_be_visible()
    if signup:
        page.get_by_role("button", name="创建账号").click()
    page.get_by_label("用户名").fill(username)
    page.get_by_label("密码", exact=True).fill(password)
    page.get_by_role("button", name="注册" if signup else "登录", exact=True).click()
    expect(page.get_by_role("navigation", name="工作区导航")).to_be_visible()


def go(page, name):
    page.get_by_role("navigation", name="工作区导航").get_by_role("button", name=name, exact=True).click()


def connect(page, email, subject, count):
    page.get_by_label("163 邮箱地址").fill(email)
    page.get_by_label("IMAP 授权码").fill("fixture-only-imap-code")
    page.get_by_role("button", name="连接并同步").click()
    expect(page.get_by_text(subject, exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name=f"全部收件 · {count} 封")).to_be_visible()
    expect(page.get_by_label("IMAP 授权码")).to_have_count(0)


def put_legacy_workspace(page):
    with tempfile.TemporaryDirectory() as tmp:
        file = Path(tmp) / "legacy.sqlite"
        db = sqlite3.connect(file)
        db.executescript("""
          CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
          INSERT INTO settings VALUES('apiKey','old-secret-fixture');
          CREATE TABLE generated_drafts (
            id TEXT PRIMARY KEY, template_id TEXT, mode TEXT NOT NULL,
            params_json TEXT, content_html TEXT, content_text TEXT, created_at INTEGER
          );
          INSERT INTO generated_drafts VALUES('legacy-draft', '', 'generator-draft',
            '{"title":"旧版保留稿件"}', '<p>旧正文</p>', '旧正文', 1780000000000);
        """)
        db.close()
        page.evaluate("""bytes => new Promise((resolve, reject) => {
          const open = indexedDB.open('foeflow-web', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('workspace');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('workspace', 'readwrite');
            tx.objectStore('workspace').put(Uint8Array.from(bytes), 'sqlite');
            tx.oncomplete = () => { open.result.close(); resolve(); };
            tx.onabort = () => reject(tx.error);
          };
        })""", list(file.read_bytes()))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1365, "height": 900}, accept_downloads=True)
    first = context.new_page()
    errors = []
    first.on("pageerror", lambda e: errors.append(str(e)))
    tracked = []
    first.on("request", lambda request: tracked.append(request.url) if "tracker.invalid" in request.url else None)
    first.goto(url)
    first.wait_for_load_state("networkidle")
    expect(first.get_by_role("navigation", name="工作区导航")).to_have_count(0)
    expect(first.get_by_label("邀请码")).to_have_count(0)
    sign_in(first, "first_test", signup=True)
    connect(first, "first@163.com", "校园讲座投稿（测试）", 31)
    read = first.get_by_role("listitem").filter(has_text="已归档投稿（测试）")
    unread = first.get_by_role("listitem").filter(has_text="校园讲座投稿（测试）")
    expect(read.get_by_text("已读", exact=True)).to_be_visible()
    expect(unread.get_by_text("未读", exact=True)).to_be_visible()
    assert read.evaluate("(node) => getComputedStyle(node).backgroundColor") != unread.evaluate("(node) => getComputedStyle(node).backgroundColor")
    if proof:
        first.screenshot(path=Path(proof).with_name("收件箱-测试数据.png"))
    first.get_by_role("button", name="下一页").click()
    expect(first.get_by_text("历史投稿 1", exact=True)).to_be_visible()
    expect(first.get_by_text("第 2 / 2 页")).to_be_visible()
    expect(first.get_by_role("button", name="下一页")).to_be_disabled()
    first.get_by_role("button", name="立即同步").click()
    expect(first.get_by_text("校园讲座投稿（测试）", exact=True)).to_be_visible()

    first.get_by_role("button", name="未读 校园讲座投稿（测试）", exact=False).click()
    expect(first.get_by_text("这是测试邮件正文。", exact=True)).to_be_visible()
    expect(first.get_by_text("为保护隐私，正文不加载远程图片。")).to_be_visible()
    assert not tracked and first.evaluate("window.mailScriptRan") is None
    expect(first.get_by_text("无效链接", exact=True)).not_to_have_attribute("href", "javascript:window.mailScriptRan=1")
    text_file = first.get_by_role("listitem").filter(has_text="投稿资料.txt")
    download_button = text_file.get_by_role("button", name="下载 投稿资料.txt", exact=True)
    first.route("**/mail/attachment", lambda route: route.fulfill(status=404, json={"error": "attachment_missing"}), times=1)
    download_button.focus()
    download_button.press("Enter")
    expect(text_file.get_by_role("alert")).to_have_text("附件不可用。")
    expect(download_button).to_be_focused()
    with first.expect_download() as download:
        download_button.press("Enter")
    expect(text_file.get_by_role("alert")).to_have_count(0)
    assert download.value.suggested_filename == "投稿资料.txt"
    assert download.value.path().read_bytes() == b"fixture data"
    preview = first.get_by_role("button", name="预览图片 稿件插图.png")
    preview.click()
    expect(first.get_by_role("img", name="稿件插图.png")).to_be_visible()
    expect(first.get_by_role("button", name="关闭预览")).to_be_focused()
    first.keyboard.press("Escape")
    expect(preview).to_be_focused()
    if proof:
        first.screenshot(path=proof)
    first.get_by_role("button", name="返回收件箱").click()
    updated = first.get_by_role("listitem").filter(has_text="校园讲座投稿（测试）")
    expect(updated.get_by_text("已读", exact=True)).to_be_visible()
    expect(updated.get_by_role("button")).to_be_focused()
    first.get_by_role("button", name="立即同步").click()
    expect(updated.get_by_text("已读", exact=True)).to_be_visible()

    put_legacy_workspace(first)
    go(first, "设置")
    first.get_by_role("button", name="导入旧版资料").click()
    expect(first.get_by_text("已导入旧版工作区。模型密钥需重新填写。")).to_be_visible()
    expect(first.get_by_label("API Key", exact=True)).to_have_value("")
    go(first, "工作台")
    first.get_by_role("button", name="草稿箱").click()
    expect(first.get_by_text("旧版保留稿件", exact=True)).to_be_visible()

    # Switching users in the same browser must not reveal the first user's local draft.
    first.get_by_role("button", name="退出登录").click()
    sign_in(first, "second_test", signup=True)
    go(first, "工作台")
    first.get_by_role("button", name="草稿箱").click()
    expect(first.get_by_text("旧版保留稿件", exact=True)).to_have_count(0)
    go(first, "邮件箱")
    expect(first.get_by_text("校园讲座投稿（测试）", exact=True)).to_have_count(0)
    connect(first, "second@163.com", "读书分享投稿（测试）", 1)
    first.get_by_role("button", name="管理邮箱").click()
    expect(first.get_by_label("IMAP 授权码")).to_have_value("")
    first.get_by_role("button", name="解除连接").click()
    first.get_by_role("button", name="确认解除").click()
    expect(first.get_by_text("尚未连接邮箱", exact=True)).to_be_visible()
    first.get_by_role("button", name="退出登录").click()
    sign_in(first, "first_test")
    expect(first.get_by_text("校园讲座投稿（测试）", exact=True)).to_be_visible()
    go(first, "工作台")
    first.get_by_role("button", name="草稿箱").click()
    expect(first.get_by_text("旧版保留稿件", exact=True)).to_be_visible()

    narrow = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    narrow.goto(url)
    sign_in(narrow, "first_test")
    expect(narrow.get_by_text("校园讲座投稿（测试）", exact=True)).to_be_visible()
    assert narrow.locator("main").evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")
    if proof:
        narrow.screenshot(path=Path(proof).with_name("手机收件箱-测试数据.png"))
    narrow.get_by_role("button", name="已读 校园讲座投稿（测试）", exact=False).tap()
    expect(narrow.get_by_text("这是测试邮件正文。", exact=True)).to_be_visible()
    mobile_download = narrow.get_by_role("button", name="下载 投稿资料.txt", exact=True)
    assert mobile_download.bounding_box()["height"] >= 44
    assert narrow.locator("main").evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")
    if proof:
        narrow.screenshot(path=Path(proof).with_name("手机邮件详情-测试数据.png"))
    assert not errors, errors
    browser.close()

print("PASS: app login, all mail, detail, downloads, safe HTML, persistent read status, pagination, legacy import, same-browser account isolation, logout, mobile")
