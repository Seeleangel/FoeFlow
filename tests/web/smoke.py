"""Run against a FoeFlow browser build. The model is simulated, no API quota is used."""
import json
import os
import struct
import zipfile
import zlib

from playwright.sync_api import expect, sync_playwright

URL = os.environ.get("FOEFLOW_WEB_URL", "http://127.0.0.1:4173/foeflow/")
PROOF = os.environ.get("FOEFLOW_WEB_SCREENSHOT")


def png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    size = 128
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", size, size, 8, 2, 0, 0, 0)) + chunk(
        b"IDAT", zlib.compress((b"\0" + b"\xfa\xf5\xef" * size) * size, level=0)
    ) + chunk(b"IEND", b"")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1365, "height": 900}, accept_downloads=True)
    page = context.new_page()
    errors = []
    calls = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def model(route):
        assert route.request.headers.get("authorization") == "Bearer test-only-not-a-real-key"
        request = route.request.post_data_json
        user = request["messages"][-1]["content"]
        calls.append(user)
        if user == "请只回复 OK":
            content = "OK"
        elif "审核" in request["messages"][0]["content"]:
            content = json.dumps([{"dimension": "text", "severity": "medium",
                                   "message": "报名方式缺失", "suggestion": "补充报名入口"}], ensure_ascii=False)
        else:
            content = "请问这篇推文面向哪些读者？"
        route.fulfill(json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})

    page.route("**/foeflow/_model/chat/completions", model)
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    nav = page.get_by_role("navigation", name="工作区导航")
    expect(nav.get_by_role("button", name="审核台", exact=True)).to_be_visible(timeout=15000)
    expect(nav.get_by_role("button", name="邮件箱", exact=True)).to_have_count(0)

    def go(name):
        nav.get_by_role("button", name=name, exact=True).click()

    go("生成器")
    composer = page.get_by_role("textbox", name="写作需求或现有稿件")
    composer.fill("# 校园分享活动\n## 活动安排\n欢迎同学参加本周的阅读分享。")
    page.get_by_role("button", name="排版现有稿件").click()
    expect(page.get_by_role("heading", name="校园分享活动", exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="活动安排", exact=True)).to_be_visible()
    with page.expect_download() as event:
        page.get_by_role("button", name="导出 Word", exact=True).click()
    with zipfile.ZipFile(event.value.path()) as docx:
        assert "欢迎同学参加本周的阅读分享" in docx.read("word/document.xml").decode()
    page.get_by_role("button", name="保存草稿", exact=True).click()
    expect(page.get_by_text("草稿已保存到工作台")).to_be_visible()
    assert not calls, "Local layout must not call a model"
    if PROOF:
        page.screenshot(path=PROOF, animations="disabled")

    page.reload()
    go("工作台")
    page.get_by_role("button", name="草稿箱").click()
    expect(page.get_by_text("校园分享活动", exact=True)).to_be_visible()

    page.get_by_role("button", name="图片压缩").click()
    image = png()
    page.locator("input[type=file]").set_input_files({"name": "example.png", "mimeType": "image/png", "buffer": image})
    page.get_by_role("button", name="开始处理").click()
    with page.expect_download() as event:
        page.get_by_role("button", name="下载", exact=True).click()
    assert event.value.path().stat().st_size < len(image)

    go("设置")
    page.get_by_label("API Key", exact=True).fill("test-only-not-a-real-key")
    page.get_by_role("button", name="测试模型连接").click()
    expect(page.get_by_text("模型连接成功", exact=True)).to_be_visible()
    page.get_by_role("button", name="保存设置", exact=True).click()
    expect(page.get_by_role("button", name="已保存", exact=True)).to_be_visible()

    go("审核台")
    page.get_by_placeholder("请粘贴推文文字内容...").fill("校园活动将在周五举行。")
    page.get_by_role("button", name="开始审核", exact=True).click()
    expect(page.get_by_text("报名方式缺失", exact=True)).to_be_visible()
    go("工作台")
    page.get_by_role("button", name="审核历史").click()
    expect(page.get_by_text("校园活动将在周五举行。", exact=False).first).to_be_visible()

    go("生成器")
    composer.fill("请帮我准备一篇校园分享推文")
    page.get_by_role("button", name="发送给 AI").click()
    expect(page.get_by_text("请问这篇推文面向哪些读者？", exact=True)).to_be_visible()
    assert len(calls) == 3, calls

    narrow = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    narrow.on("pageerror", lambda error: errors.append(str(error)))
    narrow.goto(URL)
    narrow.get_by_role("navigation", name="工作区导航").get_by_role("button", name="生成器").click()
    expect(narrow.get_by_role("textbox", name="写作需求或现有稿件")).to_be_visible()
    assert narrow.locator("main").evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")
    if PROOF:
        narrow.screenshot(path=PROOF.replace(".png", "-mobile.png"), animations="disabled")
    assert not errors, errors
    browser.close()

print("PASS: browser startup, local layout, Word download, persistent drafts, image compression, model setup, audit/history, writing dialogue, mobile layout")
