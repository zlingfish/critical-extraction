#!/bin/zsh

cd "${0:A:h}" || exit 1

game_url="http://127.0.0.1:4173/play.html"
runtime_dir="/tmp/critical-extraction-web"
service_name="com.critical-extraction.game"
server_script="$runtime_dir/no-cache-server.py"

echo "临界撤离 - 启动器"
echo
echo "正在准备最新游戏网页……"
if [[ ! -s play.html ]]; then
  echo "找不到游戏网页，请把这个窗口发给 Codex。"
  read "?按回车键关闭窗口…"
  exit 1
fi
if [[ ! -s no-boss-mode.js ]]; then
  echo "找不到无首领模式脚本，请把这个窗口发给 Codex。"
  read "?按回车键关闭窗口…"
  exit 1
fi
if [[ ! -s extended-maps.js || ! -s ten-boss-mode.js || ! -s weapon-variants.js ]]; then
  echo "找不到地图或首领模式脚本，请把这个窗口发给 Codex。"
  read "?按回车键关闭窗口…"
  exit 1
fi
echo "已找到可用网页，直接启动。"
mkdir -p "$runtime_dir" || exit 1
cp play.html "$runtime_dir/play.html" || exit 1
cp no-boss-mode.js "$runtime_dir/no-boss-mode.js" || exit 1
cp extended-maps.js "$runtime_dir/extended-maps.js" || exit 1
cp ten-boss-mode.js "$runtime_dir/ten-boss-mode.js" || exit 1
cp weapon-variants.js "$runtime_dir/weapon-variants.js" || exit 1
cp preview/index.html "$runtime_dir/index.html" || exit 1
cp scripts/no-cache-server.py "$server_script" || exit 1

if ! /usr/bin/curl -fsSI "$game_url" 2>/dev/null | /usr/bin/grep -qi '^Cache-Control:.*no-store'; then
  /bin/launchctl remove "$service_name" >/dev/null 2>&1 || true
  /bin/launchctl submit -l "$service_name" -- \
    /usr/bin/python3 "$server_script" --port 4173 --bind 127.0.0.1 --directory "$runtime_dir"
fi

for attempt in {1..40}; do
  /usr/bin/curl -fsS "$game_url" >/dev/null 2>&1 && break
  /bin/sleep 0.2
done

if ! /usr/bin/curl -fsS "$game_url" >/dev/null 2>&1; then
  echo "游戏服务启动失败，请把这个窗口发给 Codex。"
  read "?按回车键关闭窗口…"
  exit 1
fi

/usr/bin/open "${game_url}?v=$(/bin/date +%s)"
echo "游戏已打开。现在可以关闭这个窗口，游戏不会停止。"
/bin/sleep 2
