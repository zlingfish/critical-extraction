#!/bin/zsh

cd "${0:A:h}" || exit 1
mkdir -p .npm-cache

echo "临界撤离 - 完整依赖安装"
echo

if NPM_CONFIG_CACHE="$PWD/.npm-cache" npm install; then
  echo
  echo "依赖安装完成。以后双击 start-game.command 即可启动完整版本。"
else
  echo
  echo "安装失败。普通网页版仍可通过 start-game.command 直接启动。"
fi

echo
read -k 1 "?按任意键关闭……"
