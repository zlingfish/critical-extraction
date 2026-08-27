# 临界撤离

原创的浏览器 3D 单人 PvE 搜打撤垂直切片。玩家需要进入九号物流港，搜集物资、回收加密硬盘并抵达东南撤离区。

## 开发

```bash
npm install
npm run dev
```

生产构建与测试：

```bash
npm test
npm run build
```

## 操作

- `WASD` 移动，`Shift` 冲刺，`C` 蹲伏，`Space` 跳跃
- 鼠标瞄准，左键射击，右键开镜，`R` 换弹
- `E` 交互，`4` 使用医疗包，`Tab` 查看背包，`Esc` 暂停

游戏面向桌面浏览器，进度保存在浏览器本地存储中。

双击 `start-game.command` 会直接启动无需 npm 依赖的网页版。需要完整本地开发环境时，再双击 `install-dependencies.command`；成功安装一次后无需重复安装。

## 生成可发布网页

双击 `build-web.command`，或运行：

```bash
npm run build:standalone
```

发布时上传生成的 `dist` 文件夹。此构建不需要先执行 `npm install`。
