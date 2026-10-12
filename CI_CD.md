# CI/CD

CI/CD 包含代码质量检查、测试、以及 Docker 镜像构建与部署。

## 工作流概览

- `quality.yml`
  - ESLint
  - TypeScript 检查
- `test.yml`
  - Jest 测试
  - PostgreSQL 集成测试
  - Next.js 构建验证
  - Playwright 端到端测试
- `ci.yml`
  - 编排 `quality` 与 `test`
- `deploy.yml`
  - 手动构建应用与 migration Docker 镜像 → 推送私有 TCR → SSH 远程迁移并部署
- `release.yml`
  - 在推送 `v*` 标签时创建 GitHub Draft Release

## 触发条件

| 工作流 | 触发 |
|--------|------|
| `ci.yml` | Pull Request |
| `deploy.yml` | 手动 `workflow_dispatch`，且仅当 ref 为 `v3` 分支或 `v*` 标签；标签部署还要求同一 commit 已有成功的 `release.yml` 运行 |
| `release.yml` | 推送 `v*` 标签 |

手动触发 `deploy.yml` 时可填写外部生产数据库备份/快照编号作为审计标签；留空时部署会在服务器 `/data/sast-people-next/backups` 自动创建并校验一份 PostgreSQL custom-format 逻辑备份，自动生成编号。备份创建或校验失败会阻止迁移和应用切换。

## 部署流程

1. **Quality + Test** — 必须先通过质量检查和测试
2. **Docker Build** — 使用同一个 Git commit 构建应用镜像和一次性 migration 镜像
3. **Private Registry Pull** — 服务器从 TCR 拉取两个镜像，数据库凭据仍只存在服务器 `.env`
4. **Database Backup** — 在服务器服务目录自动创建并校验 PostgreSQL custom-format 逻辑备份；可选输入仅作为外部快照审计标签
5. **Database Migration** — 使用 migration 镜像、生产 `.env` 和内网 `postgres` Docker network 执行 `pnpm db:migrate`
6. **Application Deploy** — 只有迁移和权限检查成功后才轮换 `backup/current` 标签并执行 `docker compose up -d`
7. **Health Check / Rollback** — 健康检查失败时回滚应用镜像；数据库迁移不自动回滚

### 部署所需 Secrets

| Secret | 说明 |
|--------|------|
| `SERVER_HOST` | 目标服务器 IP 或域名 |
| `SERVER_USER` | SSH 用户名 |
| `SSH_PRIVATE_KEY` | SSH 私钥 |
| `TCR_USERNAME` | 腾讯云账号 ID / UIN（组织级 secret），用于登录私有 TCR |
| `TCR_PASSWORD` | TCR 镜像仓库登录密码（组织级 secret） |
| `NEXT_PUBLIC_SENTRY_DSN` | 构建期公开 Sentry DSN，会被 Next.js inline 到前端产物 |
| `FEEDBACK_FEISHU_GROUP_URL` | 关于页展示的飞书群邀请链接；部署时会同步写入服务器 `.env` |
| `SENTRY_AUTH_TOKEN` | 可选；`next.config.ts` 在 `CI=true` 且该变量存在时启用 Sentry build plugin。仓库工作流目前未把它注入构建环境，需要显式加进去才会生效 |

生产运行时变量不再由 GitHub Actions 写入 —— 唯一的例外是 `FEEDBACK_FEISHU_GROUP_URL`：配置了该仓库 secret 时，部署步骤会把它写入服务器 `.env`（覆盖同名旧值）。其余变量由服务器上的 `/data/sast-people-next/.env` 管理，并通过 `docker-compose.yml` 的 `env_file` 注入容器。

如果只修改运行时变量，例如数据库、会话密钥、飞书密钥或邮箱密码，不需要重新构建镜像，也不需要 SCP 镜像 tar：

```bash
cd /data/sast-people-next
vim .env
chmod 600 .env
docker compose up -d --force-recreate
```

如果修改 `NEXT_PUBLIC_*` 变量，需要重新构建部署，因为 Next.js 会在 `pnpm build` 时把它们写入前端产物。

本地构建默认不启用 Sentry build plugin，避免在未配置 Sentry CLI 时出现可选构建后 warning。需要验证 Sentry 构建期处理时设置 `SENTRY_BUILD_PLUGIN=true`。

## 数据库迁移规范

生产迁移由 `deploy.yml` 在应用切换前自动执行，不再通过数据库软件手工复制 SQL。migration 镜像和应用镜像来自同一个 commit，运行时使用服务器上的 `/data/sast-people-next/.env`，并仅通过 Docker 内网访问数据库。

生产数据库必须配置独立的 migration 发布账号，并在服务器 `.env` 中设置 `DATABASE_MIGRATION_URL`；migration image 未配置该变量会直接拒绝执行。应用运行账号 `sastpeople` 不应拥有执行 DDL 的权限；应用继续使用 `DATABASE_URL`。迁移前应完成数据库备份或快照；迁移文件必须采用向后兼容的 expand/contract 方式，删除字段或表等不可逆变更需要拆分发布。

如果迁移失败，部署会在应用镜像激活前终止；如果迁移成功但应用健康检查失败，只回滚应用镜像，数据库不会自动回滚，因此每次迁移都必须兼容上一版本应用。

## 镜像版本管理

每次部署往 TCR 推送两个标签：
- `sast/sast-people-next:<commit-hash>` — 应用镜像（按 commit 打，供部署与「重拉某个历史版本」）
- `sast/sast-people-next:migrator` — 一次性迁移镜像（**固定 tag，每次部署覆盖**）

TCR 个人版每个仓库上限 **100 个 tag**，而应用镜像每次部署都要占一个，所以 `deploy.yml` 在推送前会先清理仓库里的旧 tag（步骤 `Prune old image tags from TCR`）：保留**当前 ref 最近 `TAG_RETENTION_COMMITS`（默认 20）个提交**对应的 tag、本次要推的 tag，以及固定 tag `migrator`，其余（含早期 `<commit-hash>-migrator` 那种旧格式）走 Registry v2 API 删除。判定按「还在不在保留集合里」，不依赖 tag 的时间顺序（tag 名是短 sha，本身不带时间信息）。

Registry v2 的 `DELETE /manifests/<digest>` 会把指向同一个 manifest 的**所有** tag 一起删掉，而内容没变的构建（例如只改文档的 commit）会与上一个 commit 共用 digest，所以只按 tag 名判重会误删保留窗口里的 tag——脚本会先取出保留窗口那些 tag 的 digest，候选 digest 命中就跳过。唯一的例外是固定 tag `migrator`：它每次部署都会被重新推上来，而历史上那批 `<sha>-migrator` 大多与它共用 digest，保护它等于让那些旧 tag 永远删不掉，所以它不参与这层保护（这个 tag 被连带删掉时，同一次运行的后续推送会立刻把它建回来）。

清理拿不到 token / 列不出列表 / 单个删除失败时只打 `::warning::` 并继续部署；只有清理后仍有 100 个（下一个 tag 必然推不上去）才 `::error::` 终止，提示去 TCR 控制台清理或升级套餐。token 服务不是写死的：脚本先请求 `/v2/` 读注册表返回的 401 challenge（注册表与 token 服务都必须用 `https://` 访问——`TCR_HOST` 只是域名，少了协议头 curl 会走 80 端口拿到 308 重定向页而不是 JSON），从中取 `realm` 与 `service`（TCR 个人版实际是 `realm=/service/token`、`service=token-service`，写死成 `service=registry` 会被拒），并用 `scope=repository:<ns>/<repo>:pull,push,delete` 取 token（实测只请求 `pull` 会 401；注册表的 401 明细写明删除要 `Action: delete`）。这些调用失败时会把 HTTP 状态与响应前 400 字节打进日志，便于定位。

部署过程中还会打上服务器本地滚动标签，`docker-compose.yml` 使用 `:current`：
- `current` — 当前运行版本
- `backup` — 上一版本（用于快速回滚）

部署成功收尾时只清理**部署服务器本地**的引用：删除本轮 `<commit-hash>` / `migrator` 的本地标签，并把本地 `sast/sast-people-next` 的历史版本标签只保留最近 3 个（`docker rmi` 逐个删除更早的），最后 `docker image prune -f`。`docker rmi` 不会删除镜像仓库里的标签——仓库里的标签由上面那段 CI 清理收敛，超出保留窗口的版本需要重拉时得重新部署。服务器上也没有 `latest` 标签，回滚靠本地的 `current` / `backup` 滚动标签。

回滚命令：`docker tag sast/sast-people-next:backup sast/sast-people-next:current && docker compose up -d`

## 本地建议

推送前建议至少运行：

```bash
pnpm lint
pnpm test
pnpm build
```

## 依赖更新

Dependabot 当前负责：

- 根目录 npm/pnpm 依赖
- GitHub Actions 依赖
