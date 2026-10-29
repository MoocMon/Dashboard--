#!/bin/bash
cd "$(dirname "$0")" || exit 1

echo "多平台内容生产工作台 · AKA张猩猩"
echo "--------------------------------"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 18 或更高版本：https://nodejs.org"
  read -r -p "按回车键退出..." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖（需要联网，约 1–2 分钟）..."
  if ! npm install; then
    echo "依赖安装失败，请检查网络后重试。"
    read -r -p "按回车键退出..." _
    exit 1
  fi
fi

if [ ! -f web/dist/index.html ]; then
  echo "正在构建前端界面..."
  if ! npm run build; then
    echo "前端构建失败。"
    read -r -p "按回车键退出..." _
    exit 1
  fi
fi

PORT="${PORT:-5178}"
( sleep 2; open "http://localhost:${PORT}" ) &

echo "服务地址：http://localhost:${PORT}"
echo "关闭此窗口或按 Ctrl+C 即可停止服务。"
echo ""
node server/index.js
