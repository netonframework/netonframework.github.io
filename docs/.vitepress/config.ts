import { defineConfig } from "vitepress";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOSTNAME = "https://netonframework.github.io";
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

/** 目录下所有 .html 的相对路径 */
function collectHtml(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else if (entry.name.endsWith(".html")) out.push(rel);
    }
  };
  walk(dir, "");
  return out;
}

function redirectHtml(target: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved</title>
<link rel="canonical" href="${HOSTNAME}${target}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>This page moved to <a href="${target}">${target}</a>.</body>
</html>
`;
}

// root locale = English（/guide/cache.html），中文走子路径（/zh-hans/guide/cache.html）。
// spec/ 目前只有中文版，英文导航直接指向 /zh-hans/spec/ 并标注语言，不留死链。

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

const zhSpecSidebar = [
  {
    text: "框架规范",
    items: [
      { text: "规范概览", link: "/zh-hans/spec/" },
      { text: "路线图", link: "/zh-hans/spec/roadmap" },
    ],
  },
  {
    text: "Core",
    items: [
      { text: "Core 规范 v1", link: "/zh-hans/spec/core" },
      { text: "Core SPI 最佳实践", link: "/zh-hans/spec/core-spi-best-practices" },
      { text: "Config SPI 规范", link: "/zh-hans/spec/config-spi" },
    ],
  },
  {
    text: "HTTP",
    items: [{ text: "HTTP 规范 v1", link: "/zh-hans/spec/http" }],
  },
  {
    text: "路由与参数",
    items: [
      { text: "路由规范 v1", link: "/zh-hans/spec/routing" },
      { text: "参数绑定规范 v1", link: "/zh-hans/spec/parameter-binding" },
    ],
  },
  {
    text: "安全",
    items: [{ text: "安全规范 v1", link: "/zh-hans/spec/security" }],
  },
  {
    text: "日志",
    items: [{ text: "日志规范 v1", link: "/zh-hans/spec/logging" }],
  },
  {
    text: "数据库",
    items: [
      { text: "数据库规范 v1", link: "/zh-hans/spec/database" },
      { text: "JOIN 查询规范", link: "/zh-hans/spec/database-join" },
      { text: "执行链与约束规范", link: "/zh-hans/spec/database-execution" },
      { text: "会话与事务契约", link: "/zh-hans/spec/database-session" },
    ],
  },
  {
    text: "缓存与 Redis",
    items: [
      { text: "缓存规范 v1", link: "/zh-hans/spec/cache" },
      { text: "Redis 规范 v1", link: "/zh-hans/spec/redis" },
    ],
  },
  {
    text: "定时任务与存储",
    items: [
      { text: "定时任务规范", link: "/zh-hans/spec/jobs" },
      { text: "存储规范", link: "/zh-hans/spec/storage-spec" },
    ],
  },
];

export default defineConfig({
  title: "Neton Framework",
  base: "/",
  lastUpdated: true,

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

  // spec/ 和 api/ 原本在根路径（中文），改 i18n 后整体搬进 /zh-hans/，老地址会 404。
  // GitHub Pages 没有服务端跳转，只能生成跳转桩页：canonical 交代权重归属，
  // meta refresh 负责把人送过去。等这些目录有了英文版，真实页面会占住路径，桩页自动不再生成。
  buildEnd(siteConfig) {
    const movedRoots = ["spec", "api"];
    let written = 0;

    for (const { prefix } of LOCALES) {
      if (!prefix) continue;
      for (const root of movedRoots) {
        for (const rel of collectHtml(join(siteConfig.outDir, prefix, root))) {
          const from = join(siteConfig.outDir, root, rel);
          if (existsSync(from)) continue; // 已有真实页面，不覆盖
          const target = `/${prefix}/${root}/${rel}`;
          mkdirSync(dirname(from), { recursive: true });
          writeFileSync(from, redirectHtml(target), "utf-8");
          written += 1;
        }
      }
    }
    if (written > 0) console.log(`  generated ${written} redirect stubs for moved paths`);
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
      description:
        "Kotlin Multiplatform backend framework — guide and specifications",
      themeConfig: {
        nav: [
          { text: "Home", link: "/" },
          { text: "Guide", link: "/guide/" },
          { text: "Specs (中文)", link: "/zh-hans/spec/" },
          { text: "API (中文)", link: "/zh-hans/api/" },
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
      description: "Neton 框架设计规范与用户指南",
      themeConfig: {
        nav: [
          { text: "首页", link: "/zh-hans/" },
          { text: "用户指南", link: "/zh-hans/guide/" },
          { text: "规范文档", link: "/zh-hans/spec/" },
          { text: "API 参考", link: "/zh-hans/api/" },
          {
            text: "更多",
            items: [{ text: "路线图", link: "/zh-hans/spec/roadmap" }],
          },
        ],
        sidebar: {
          "/zh-hans/guide/": zhGuideSidebar,
          "/zh-hans/spec/": zhSpecSidebar,
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
