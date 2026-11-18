"""Build the ScriptCat subscription and its three scripts for HTTPS hosting."""

import argparse
from pathlib import Path
from shutil import copyfile
from urllib.parse import urlsplit


SOURCE_DIR = Path(__file__).resolve().parent
SUBSCRIPTION_FILE = "guandata-tools.user.sub.js"
SCRIPTS = (
    "guandata-add-fields.user.js",
    "guandata-edit-calculated-fields.user.js",
    "guandata-original-field-names.user.js",
)


def main():
    parser = argparse.ArgumentParser(description="生成观远字段工具的 ScriptCat 集合订阅。")
    parser.add_argument("base_url", help="发布目录的 HTTPS URL")
    parser.add_argument("--output", type=Path, default=SOURCE_DIR / "dist", help="输出目录")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    try:
        url = urlsplit(base_url)
        valid_url = url.scheme == "https" and url.hostname and not url.username and not url.password
        url.port  # Validate explicit port if present.
    except ValueError:
        valid_url = False
    if not valid_url or any(char.isspace() or char in "?#\\" for char in base_url):
        parser.error("发布目录必须是无凭据、查询参数或片段的 HTTPS URL。")

    metadata = [
        "// ==UserSubscribe==",
        "// @name         观远字段工具",
        "// @description  集合安装字段快速添加、栏目内编辑计算字段、重命名字段显示原名。",
        "// @version      1.0.0",
        *(f"// @scriptUrl    {base_url}/{filename}" for filename in SCRIPTS),
        "// ==/UserSubscribe==",
        "",
    ]

    args.output.mkdir(parents=True, exist_ok=True)
    for filename in SCRIPTS:
        copyfile(SOURCE_DIR / filename, args.output / filename)
    (args.output / SUBSCRIPTION_FILE).write_text("\n".join(metadata), encoding="utf-8")
    print(f"{base_url}/{SUBSCRIPTION_FILE}")


if __name__ == "__main__":
    main()
