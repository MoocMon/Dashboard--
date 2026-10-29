#!/bin/bash
# 多平台内容生产工作台 · 本地启动脚本
# 把这个文件拖到桌面，双击即可启动（首次需右键 → 打开 绕过 Gatekeeper）

PROJ="/Users/liz/Documents/Trae-CN/内容工作台"

# 自动检测已在运行吗？
if lsof -ti :5178 >/dev/null 2>&1; then
  echo "5178 端口已在监听，跳过启动，直接打开浏览器..."
else
  echo "正在启动内容工作台..."
  cd "$PROJ" || { echo "目录不存在：$PROJ"; exit 1; }

  if [ ! -d node_modules ]; then
    echo "首次运行，正在安装依赖..."
    npm install || { echo "依赖安装失败"; exit 1; }
  fi
  if [ ! -f web/dist/index.html ]; then
    echo "首次运行，正在构建前端..."
    npm run build || { echo "前端构建失败"; exit 1; }
  fi

  # 以独立进程方式启动，不跟着这个终端窗口死
  nohup /usr/local/bin/node server/index.js > /tmp/wb.log 2>&1 &
  disown

  # 等服务起来
  for i in 1 2 3 4 5; do
    sleep 1
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5178 | grep -q "200"; then
      break
    fi
  done
fi

echo "服务地址：http://localhost:5178"
open http://localhost:5178
echo "浏览器已打开。关闭本窗口不会停止服务；要停止：kill $(lsof -ti :5178)"
sleep 3
