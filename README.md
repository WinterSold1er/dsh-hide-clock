# dsh-hide-clock

DSH Web GUI 插件：隐藏会话消息行里的「时刻」（message clock），可在设置页选择只在移动端生效。零 npm 依赖、纯 JS、无构建步骤。

## 行为

- 用户消息的时刻在操作行行首，助手消息的时刻在行尾；插件用 CSS 直接隐藏，不参与 React 渲染。
- 设置页 **Settings → General** 一行条目，内含两项复选框：**隐藏时刻**（默认开）、**仅在移动端生效**（默认关，移动端判定 `matchMedia('(max-width: 768px)')`；环境无 `matchMedia` 时按桌面处理）。
- 持久化在浏览器 `localStorage`，键 `dsh-hide-clock`，值形如 `{"hidden":true,"mobileOnly":false}`；非法/脏值回退默认 `{hidden:true, mobileOnly:false}`。`localStorage` 不可用（读取抛 `SecurityError`、写入配额失败）时不报错：设置在内存中继续生效，只是不落盘。
- 单实例：样式、marker、`matchMedia` 监听、状态与设置行各只有一份。HMR 由 loader 先 dispose 旧 fiber 再 apply；对已应用的模块再次 `apply` 视为 no-op（不叠加样式/监听，也不会注册第二个同 id 的设置行）。

## 选择器依据

DSH 源码 `packages/client/ui-chat/src/client/chat/MessageIconActions.tsx`：

- 操作行是 `<div data-clock="start" | "end">`（第 83 行）。
- `clock === 'start'` 时，时刻 span 是行的第一个子元素（第 84 行，仅 `time !== undefined` 时渲染）；同位置缺省时第一个子元素是复制按钮 `<button>`，不会被选中。
- `clock === 'end'` 时，时刻 span 是 `span.endInfo`（行的最后一个子元素）的最后一个子元素（第 110–112 行）。

CSS module 类名是哈希，所以只依赖 `[data-clock]` 属性与上述结构；生效标记由插件加在 `<html>` 上：

```css
[data-dsh-hide-clock] [data-clock="start"] > span:first-child { display: none !important; }
[data-dsh-hide-clock] [data-clock="end"] > span:last-child > span:last-child { display: none !important; }
```

## 安装

把本仓库目录作为插件包加入 DSH profile（`package.json` 的 `dsh.profile.bundles` / `dependencies` 或等效方式），然后重启 DSH 生效。`cordis.patch.yml` 以 `id: dsh-hide-clock` 插入该插件。

## 开发与测试

```sh
node --test tests/*.test.js
```

测试用 `node:vm` 载入 `client.js`，配合最小 fake `window`/`document`，断言真实行为：两条 CSS 规则、开关生效与失效、仅移动端模式在桌面/移动端的差异、`localStorage` 脏值回退、`matchMedia` 监听、订阅通知、dispose 清理、存储写入失败不崩。

## 目录结构

```
client.js        浏览器半边：样式注入、状态、设置页条目
index.js         宿主半边（空实现）
cordis.patch.yml 插件插入声明
locale/          插件展示元数据（en / zh）：仅 meta.title / meta.description，供插件列表显示；设置页文案的翻译字典（t）硬编码在 client.js 里，由 ctx.locale.register 注册，不走这些 JSON
icon.svg         插件图标（时钟加斜杠）
tests/           node --test 用例
```

## 已知限制

- 依赖 `MessageIconActions` 的 DOM 结构（`data-clock` 与时刻 span 的位置）；上游若改结构需同步本插件。
- 仅作用于 Web GUI，不含宿主逻辑、不支持其它端。
- 单实例语义：不支持同页面并发多实例；重复 `apply` 被忽略，只有首个 fiber 拥有设置行与翻译，首个 fiber 销毁后需由 loader 重新 apply 才能再次出现。
- 时刻仍存在于 DOM 中（`display: none`），可从无障碍树之外的技术手段获取；插件目的仅是界面不显示。
