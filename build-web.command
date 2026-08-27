#!/bin/zsh

cd "${0:A:h}" || exit 1

echo "临界撤离 - 网页发布包生成器"
echo

if node --experimental-strip-types scripts/build-standalone.mjs; then
  echo
  echo "生成成功：dist/index.html"
  echo "请将整个 dist 文件夹上传到静态网站托管服务。"
else
  echo
  echo "生成失败，请保留此窗口中的错误信息。"
fi

echo
read -k 1 "?按任意键关闭……"
