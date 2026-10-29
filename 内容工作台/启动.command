#!/bin/bash
# 多平台内容生产工作台 · 本地启动脚本
# 双击即可启动。脚本会：必要时构建前端、代码有更新时自动重启旧服务。

# 优先用脚本所在目录（项目目录）；拖到桌面后找不到项目再回退到固定路径
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/server/index.js" ]; then
  PROJ="$SCRIPT_DIR"
else
  PROJ="/Users/liz/Documents/Trae-CN/内容工作台"
fi

echo "项目目录：$PROJ"
cd "$PROJ" || { echo "目录不存在：$PROJ"; exit 1; }

PORT=5178
RUN_PID=$(lsof -ti :$PORT 2>/dev/null | head -n 1)
RUN_DIR=""
if [ -n "$RUN_PID" ]; then
  RUN_DIR=$(lsof -a -p "$RUN_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
fi

# 界面源码比构建产物新 → 需要重新构建
STALE_UI=""
if [ ! -f web/dist/index.html ]; then
  STALE_UI="1"
elif [ -n "$(find web/src web/index.html -type f -newer web/dist/index.html 2>/dev/null | head -n 1)" ]; then
  STALE_UI="1"
fi

# 已经在跑：目录不对或代码有更新 → 停掉旧服务，重启
NEED_RESTART=0
if [ -n "$RUN_PID" ]; then
  if [ -n "$RUN_DIR" ] && [ "$RUN_DIR" != "$PROJ" ]; then
    echo "正在运行的是另一个目录：$RUN_DIR"
    NEED_RESTART=1
  fi
  if [ "$STALE_UI" = "1" ]; then
    NEED_RESTART=1
  fi
fi

if [ "$NEED_RESTART" = "1" ]; then
  echo "检测到代码有更新，停止旧服务（PID $RUN_PID）..."
  kill "$RUN_PID" 2>/dev/null
  sleep 1
  RUN_PID=""
fi

if [ -z "$RUN_PID" ]; then
  echo "正在启动内容工作台..."

  if [ ! -d node_modules ]; then
    echo "首次运行，正在安装依赖..."
    npm install || { echo "依赖安装失败"; exit 1; }
  fi

  if [ "$STALE_UI" = "1" ]; then
    echo "正在构建前端界面..."
    npm run build || { echo "前端构建失败"; exit 1; }
  fi

  # 以独立进程方式启动，不跟着这个终端窗口死
  NODE_BIN="$(command -v node)"
  nohup "$NODE_BIN" server/index.js > /tmp/wb.log 2>&1 &
  disown

  # 等服务起来
  for i in 1 2 3 4 5; do
    sleep 1
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT | grep -q "200"; then
      break
    fi
  done
fi

echo "服务地址：http://localhost:$PORT"
open http://localhost:$PORT
echo "浏览器已打开。关闭本窗口不会停止服务；要停止：kill $(lsof -ti :$PORT)"
sleep 3
