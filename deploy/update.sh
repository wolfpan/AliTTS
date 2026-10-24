#!/usr/bin/env bash
# AliTTS 服务器更新脚本（在服务器 ~/aliTTS 下执行）
# 更新流程：本地推送 GitHub → 服务器执行 ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# pm2 安装在用户目录时（无 sudo 环境），确保能找到
export PATH="$HOME/.npm-global/bin:$PATH"

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 安装依赖"
npm install --no-audit --no-fund
npm --prefix web install --no-audit --no-fund

echo "==> 构建前端"
npm run build

echo "==> 重启服务（PM2）"
pm2 restart alitts --update-env 2>/dev/null || pm2 start server/index.js --name alitts
pm2 save

sleep 2
echo "==> 健康检查"
curl -sf http://127.0.0.1:3210/api/health && echo "" && echo "==> 更新完成"
