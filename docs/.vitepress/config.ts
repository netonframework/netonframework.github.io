import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Neton Framework",
  description: "Neton 框架设计规范与用户指南",
  lang: "zh-CN",
  base: "/",

  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "用户指南", link: "/guide/" },
      { text: "规范文档", link: "/spec/" },
      { text: "API 参考", link: "/api/" },
      {
        text: "更多",
        items: [
          { text: "路线图", link: "/spec/roadmap" },
          { text: "项目状态", link: "/spec/project-status-report" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "入门",
          items: [
            { text: "简介", link: "/guide/" },
            { text: "快速开始", link: "/guide/quick-start" },
            { text: "项目结构", link: "/guide/project-structure" },
          ],
        },
        {
          text: "核心功能",
          items: [
            { text: "路由与控制器", link: "/guide/routing" },
            { text: "参数绑定", link: "/guide/parameter-binding" },
            { text: "配置管理", link: "/guide/configuration" },
            { text: "日志系统", link: "/guide/logging" },
          ],
        },
        {
          text: "安全与认证",
          items: [{ text: "安全指南", link: "/guide/security" }],
        },
        {
          text: "数据与缓存",
          items: [
            { text: "数据库操作", link: "/guide/database" },
            { text: "缓存", link: "/guide/cache" },
            { text: "Redis 与分布式锁", link: "/guide/redis" },
          ],
        },
        {
          text: "进阶",
          items: [
            { text: "中间件机制", link: "/guide/middleware" },
            { text: "部署与跨平台", link: "/guide/deployment" },
          ],
        },
      ],

      "/spec/": [
        {
          text: "框架规范",
          items: [
            { text: "规范概览", link: "/spec/" },
            { text: "路线图", link: "/spec/roadmap" },
            { text: "项目状态报告", link: "/spec/project-status-report" },
          ],
        },
        {
          text: "Core",
          items: [
            { text: "Core 规范 v1", link: "/spec/core" },
            { text: "Core 架构", link: "/spec/core-architecture" },
            {
              text: "Core SPI 最佳实践",
              link: "/spec/core-spi-best-practices",
            },
            { text: "Core v2 重构设计", link: "/spec/core-v2-refactor" },
            { text: "Config SPI 规范", link: "/spec/config-spi" },
          ],
        },
        {
          text: "HTTP",
          items: [
            { text: "HTTP 规范 v1", link: "/spec/http" },
            { text: "HTTP 适配器总结", link: "/spec/ktor-adapter-summary" },
          ],
        },
        {
          text: "路由与参数",
          items: [
            { text: "路由规范 v1", link: "/spec/routing" },
            { text: "参数绑定规范 v1", link: "/spec/parameter-binding" },
          ],
        },
        {
          text: "安全",
          items: [
            { text: "安全规范 v1", link: "/spec/security" },
            {
              text: "安全 v1.1 API Freeze",
              link: "/spec/security-v1.1-freeze",
            },
            { text: "JWT 认证器规范", link: "/spec/jwt-authenticator" },
            {
              text: "AuthenticationPrincipal 设计",
              link: "/spec/authentication-principal-design",
            },
          ],
        },
        {
          text: "日志",
          items: [{ text: "日志规范 v1", link: "/spec/logging" }],
        },
        {
          text: "数据库",
          items: [
            { text: "Database API Freeze v2", link: "/spec/database-api" },
            { text: "Query DSL v2", link: "/spec/database-query-dsl" },
            { text: "sqlx 适配设计", link: "/spec/database-sqlx-design" },
            { text: "SqlxStore v2 API", link: "/spec/database-sqlxstore-v2" },
          ],
        },
        {
          text: "缓存与 Redis",
          items: [
            { text: "缓存规范 v1", link: "/spec/cache" },
            { text: "缓存注解规范 v1", link: "/spec/cache-annotation" },
            { text: "Redis 设计", link: "/spec/redis-design" },
            { text: "Redis 分布式锁规范", link: "/spec/redis-lock" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/netonframework/neton" },
    ],

    search: {
      provider: "local",
    },

    footer: {
      message: "Neton Framework Documentation",
      copyright: "Copyright 2025-present",
    },

    outline: {
      level: [2, 3],
      label: "目录",
    },

    docFooter: {
      prev: "上一篇",
      next: "下一篇",
    },
    lastUpdated: {
      text: "最后更新",
    },
    returnToTopLabel: "返回顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "切换主题",
  },

  markdown: {
    lineNumbers: true,
  },

  lastUpdated: true,
});
