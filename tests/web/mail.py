"""Browser integration test against the local fixture, never real mailbox credentials."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

url = os.environ["FOEFLOW_FIXTURE_ORIGIN"] + "/foeflow/#mail"
invites = json.loads(Path(os.environ["FOEFLOW_FIXTURE_PATH"]).read_text())
proof = os.environ.get("FOEFLOW_MAIL_PROOF")
password = "browser-fixture-password-only"


def register(page, username, code):
    page.goto(url)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="登录邮件账号")).to_be_visible()
    page.get_by_role("button", name="使用邀请码创建账号").click()
    page.get_by_label("用户名").fill(username)
    page.get_by_label("密码", exact=True).fill(password)
    page.get_by_label("邀请码").fill(code)
    page.get_by_role("button", name="创建账号", exact=True).click()
    expect(page.get_by_label("163 邮箱地址")).to_be_visible()


def connect(page, email, subject):
    page.get_by_label("163 邮箱地址").fill(email)
    page.get_by_label("IMAP 授权码").fill("fixture-only-imap-code")
    page.get_by_role("button", name="连接并同步").click()
    expect(page.get_by_text(subject, exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="未读投稿 · 1 封")).to_be_visible()
    expect(page.get_by_label("IMAP 授权码")).to_have_count(0)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    first = browser.new_page(viewport={"width": 1365, "height": 900})
    errors = []
    first.on("pageerror", lambda e: errors.append(str(e)))
    register(first, "first_test", invites[0])
    connect(first, "first@163.com", "校园讲座投稿（测试）")
    first.reload()
    expect(first.get_by_text("校园讲座投稿（测试）", exact=True)).to_be_visible()
    first.get_by_role("button", name="立即同步").click()
    expect(first.get_by_role("button", name="立即同步")).to_be_enabled()
    if proof:
        first.screenshot(path=proof)

    second = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    second.on("pageerror", lambda e: errors.append(str(e)))
    register(second, "second_test", invites[1])
    expect(second.get_by_text("校园讲座投稿（测试）", exact=True)).to_have_count(0)
    connect(second, "second@163.com", "读书分享投稿（测试）")
    assert second.locator("main").evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")
    second.get_by_role("button", name="管理邮箱").click()
    expect(second.get_by_label("IMAP 授权码")).to_have_value("")
    second.get_by_role("button", name="解除连接").click()
    second.get_by_role("button", name="确认解除").click()
    expect(second.get_by_text("尚未连接邮箱", exact=True)).to_be_visible()
    expect(second.get_by_text("读书分享投稿（测试）", exact=True)).to_have_count(0)
    expect(first.get_by_text("校园讲座投稿（测试）", exact=True)).to_be_visible()

    first.get_by_role("button", name="退出登录").click()
    expect(first.get_by_role("heading", name="登录邮件账号")).to_be_visible()
    expect(first.get_by_text("校园讲座投稿（测试）", exact=True)).to_have_count(0)
    first.get_by_label("用户名").fill("first_test")
    first.get_by_label("密码", exact=True).fill(password)
    first.get_by_role("button", name="登录", exact=True).click()
    expect(first.get_by_text("校园讲座投稿（测试）", exact=True)).to_be_visible()
    first.get_by_role("navigation").get_by_role("button", name="设置", exact=True).click()
    first.get_by_role("button", name="前往邮件箱").click()
    expect(first.get_by_role("heading", name="邮件收件箱")).to_be_visible()
    assert not errors, errors
    browser.close()
print("PASS: two invited accounts, sign-in, mailbox setup, persistent encrypted settings, refresh, separation, disconnect, logout, mobile")
