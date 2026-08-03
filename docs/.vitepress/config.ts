import { defineConfig } from "vitepress";

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
