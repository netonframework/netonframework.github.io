# Neton development skills

This directory is the sole maintained source of Neton ecosystem skills. Specifications
define contracts; skills guide implementation and verification against those contracts.
Installing a framework dependency does not install a skill.

| Future distribution identifier | Skill name and source |
| --- | --- |
| `neton/framework.skill` | [neton-development](neton-development/SKILL.md) |
| `neton/application.skill` | [neton-application-development](neton-application-development/SKILL.md) |

These identifiers are reserved design names, not registered packages or existing URLs.
`claude skills add neton/framework.skill` and its Application equivalent describe a
desired future installation experience, **not a currently supported installation command**.
The `.skill` suffix is a distribution label, not the name of the source directory.
Keep standard skill directories and `SKILL.md` manifests portable across tools.

## Install today

Obtain a trusted checkout of this repository at a commit compatible with your framework
version. Review the selected skill before installing it. Copy the **whole skill directory**,
including `references/` and `agents/`, not just `SKILL.md`.

- Claude Code: install into your business project's `.claude/skills/<skill-name>/`, or
  `~/.claude/skills/<skill-name>/` for personal use across projects.
- Codex: install into your business project's `.agents/skills/<skill-name>/`, or use its
  skill installer to install the selected directory from this repository.
- Other Agent Skills-compatible tools: use their documented installation location.

For example, from this repository root, with an existing business project:

```sh
# Set this to your own project. This installs only the framework skill.
PROJECT=/absolute/path/to/your-project
mkdir -p "$PROJECT/.claude/skills"
test ! -e "$PROJECT/.claude/skills/neton-development" && \
  cp -R skills/neton-development "$PROJECT/.claude/skills/neton-development"
```

For Application use `neton-application-development` instead. For Codex project scope,
replace `.claude/skills` with `.agents/skills`. Do not overwrite a locally modified
installation silently. Install only the skills you need; Application does not require
the framework skill to be installed separately.

Repository `AGENTS.md` / `CLAUDE.md` files are lightweight entry points, not installers.
Discovery and automatic task matching depend on the tool; availability does not guarantee
invocation or correctness. Explicitly request the installed skill when needed.

Official installation/discovery references:
[Claude Code](https://code.claude.com/docs/en/skills),
[Codex](https://learn.chatgpt.com/docs/build-skills).

## Versioning and future distribution

- Pin an installation to a reviewed documentation commit; record that commit with the
  project. Source-map baseline commits describe inspected code, not universal compatibility.
- Keep release compatibility explicit. Do not silently update skills to match unrelated
  framework versions. Review changes before replacing an installed copy.
- Future registries, plugins or archives must be generated from these directories, never
  separately hand-maintained. Map the two identifiers above to the corresponding source.
- Before publishing, validate both manifests, relative references and package contents,
  and test installation in a clean project for every advertised client.
- A short name requires an actual registry/installer mapping. Do not claim that mapping,
  public downloads or a supported CLI command exists before it is published and tested.

Specs remain under `docs/zh-hans/spec/`; they are available from the repository even
where excluded from the public documentation site. Skill references explain version
resolution and missing/offline documentation behavior. No sibling checkout is mandatory.
