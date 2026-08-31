import { defineConfig } from "vitepress";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOSTNAME = "https://neton.tech";
const DOCS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// locale 路径前缀 → hreflang 值。root locale（英文）没有前缀。
// 增加语言时只改这里：路径用小写（zh-hans），hreflang 用 BCP 47 大小写（zh-Hans）。
const LOCALES: Array<{ prefix: string; hreflang: string }> = [
  { prefix: "", hreflang: "en" },
  { prefix: "zh-hans", hreflang: "zh-Hans" },
];

/** 去掉 locale 前缀，得到各语言共用的相对路径，如 guide/cache.md */
function stripLocale(page: string): string {
  for (const { prefix } of LOCALES) {
    if (prefix && page.startsWith(`${prefix}/`)) return page.slice(prefix.length + 1);
  }
  return page;
}

function sourceFileFor(prefix: string, sharedPath: string): string {
  return join(DOCS_ROOT, prefix, sharedPath);
}

function urlFor(prefix: string, sharedPath: string): string {
  const html = sharedPath.replace(/\.md$/, ".html").replace(/(^|\/)index\.html$/, "$1");
  return `${HOSTNAME}/${prefix ? `${prefix}/` : ""}${html}`;
}

// root locale = English（/guide/cache.html），中文走子路径（/zh-hans/guide/cache.html）。

const enGuideSidebar = [
  {
    text: "Getting started",
    items: [
      { text: "Introduction", link: "/guide/" },
      { text: "Quick start", link: "/guide/quick-start" },
      { text: "Project structure", link: "/guide/project-structure" },
    ],
  },
  {
    text: "Core features",
    items: [
      { text: "Routing and controllers", link: "/guide/routing" },
      { text: "Parameter binding", link: "/guide/parameter-binding" },
      { text: "Configuration", link: "/guide/configuration" },
      { text: "Logging", link: "/guide/logging" },
    ],
  },
  {
    text: "Security",
    items: [{ text: "Security guide", link: "/guide/security" }],
  },
  {
    text: "Data and caching",
    items: [
      { text: "Database", link: "/guide/database" },
      { text: "Cache", link: "/guide/cache" },
      { text: "Redis and distributed locks", link: "/guide/redis" },
      { text: "Domain events", link: "/guide/events" },
    ],
  },
  {
    text: "Advanced",
    items: [
      { text: "Middleware", link: "/guide/middleware" },
      { text: "Deployment and targets", link: "/guide/deployment" },
      { text: "Toolchain known issues", link: "/guide/tooling-known-issues" },
    ],
  },
];

const zhGuideSidebar = [
  {
    text: "入门",
    items: [
      { text: "简介", link: "/zh-hans/guide/" },
      { text: "快速开始", link: "/zh-hans/guide/quick-start" },
      { text: "项目结构", link: "/zh-hans/guide/project-structure" },
    ],
  },
  {
    text: "核心功能",
    items: [
      { text: "路由与控制器", link: "/zh-hans/guide/routing" },
      { text: "参数绑定", link: "/zh-hans/guide/parameter-binding" },
      { text: "配置管理", link: "/zh-hans/guide/configuration" },
      { text: "日志系统", link: "/zh-hans/guide/logging" },
    ],
  },
  {
    text: "安全与认证",
    items: [{ text: "安全指南", link: "/zh-hans/guide/security" }],
  },
  {
    text: "数据与缓存",
    items: [
      { text: "数据库操作", link: "/zh-hans/guide/database" },
      { text: "缓存", link: "/zh-hans/guide/cache" },
      { text: "Redis 与分布式锁", link: "/zh-hans/guide/redis" },
      { text: "领域事件", link: "/zh-hans/guide/events" },
    ],
  },
  {
    text: "进阶",
    items: [
      { text: "中间件机制", link: "/zh-hans/guide/middleware" },
      { text: "部署与跨平台", link: "/zh-hans/guide/deployment" },
      { text: "工具链已知问题", link: "/zh-hans/guide/tooling-known-issues" },
    ],
  },
];

export default defineConfig({
  // 兜底值；每个 locale 用自己的完整标题覆盖（见下方 locales）。
  // 浏览器标签与搜索结果里出现的是那句完整定位，导航栏用 themeConfig.siteTitle 保持短名。
  title: "Neton",
  base: "/",
  lastUpdated: true,
  // Internal contracts stay in the repository but are not published until all locales are ready.
  srcExclude: ["zh-hans/spec/**", "zh-hans/api/**"],

  sitemap: {
    hostname: HOSTNAME,
  },

  // 各语言版本互指 hreflang，否则搜索引擎会把它们当成重复内容。
  // 只在对应语言的源文件真实存在时才发 alternate——指向 404 比不指更糟。
  transformHead({ page }) {
    const shared = stripLocale(page);
    const tags: Array<[string, Record<string, string>]> = [];

    for (const { prefix, hreflang } of LOCALES) {
      if (!existsSync(sourceFileFor(prefix, shared))) continue;
      tags.push(["link", { rel: "alternate", hreflang, href: urlFor(prefix, shared) }]);
    }
    // 语言都不匹配时的兜底，指向 root locale
    if (existsSync(sourceFileFor("", shared))) {
      tags.push(["link", { rel: "alternate", hreflang: "x-default", href: urlFor("", shared) }]);
    }
    return tags;
  },

  markdown: {
    lineNumbers: true,
  },

  themeConfig: {
    socialLinks: [
      { icon: "github", link: "https://github.com/netonframework/neton" },
    ],
    search: {
      provider: "local",
    },
  },

  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: "Neton - A modern Kotlin/Native web framework",
      description:
        "Neton is a Kotlin/Native server-side framework: routing, data access, caching, security, " +
        "scheduled jobs and domain events, compiled to a native binary with no JVM and no reflection.",
      themeConfig: {
        // 导航栏只放短名；完整定位句留给 <title> 与搜索结果。
        siteTitle: "Neton",
        nav: [
          { text: "Home", link: "/" },
          { text: "Guide", link: "/guide/" },
          { text: "1.0 Public Beta", link: "/releases/1.0.0-beta1" },
        ],
        sidebar: {
          "/guide/": enGuideSidebar,
        },
        footer: {
          message: "Neton Framework Documentation",
          copyright: "Copyright 2025-present",
        },
        outline: { level: [2, 3], label: "On this page" },
      },
    },

    "zh-hans": {
      label: "简体中文",
      lang: "zh-Hans",
      link: "/zh-hans/",
      title: "Neton - 高性能 Kotlin/Native 服务端应用框架",
      description:
        "Neton 是 Kotlin/Native 服务端框架：路由、数据访问、缓存、安全、定时任务、领域事件一应俱全，" +
        "编译为原生二进制，无 JVM、零反射。",
      themeConfig: {
        siteTitle: "Neton",
        nav: [
          { text: "首页", link: "/zh-hans/" },
          { text: "用户指南", link: "/zh-hans/guide/" },
          { text: "1.0 正式公测", link: "/zh-hans/releases/1.0.0-beta1" },
        ],
        sidebar: {
          "/zh-hans/guide/": zhGuideSidebar,
        },
        footer: {
          message: "Neton Framework 文档",
          copyright: "Copyright 2025-present",
        },
        outline: { level: [2, 3], label: "目录" },
        docFooter: { prev: "上一篇", next: "下一篇" },
        lastUpdated: { text: "最后更新" },
        returnToTopLabel: "返回顶部",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "切换主题",
        langMenuLabel: "切换语言",
      },
    },
  },
});
