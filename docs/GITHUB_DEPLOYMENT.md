# GitHub 自动部署接入说明

## 已准备的流程

推送 `master` 或创建 PR → Node 24 安装依赖 → 生成 Prisma Client → 测试、lint、构建。
只有 `master` 的 push/手动运行、检查通过且仓库变量 `DEPLOY_ENABLED=true` 时，才进入 production 部署。

部署通过专用 SSH 密钥登录现有 Ubuntu 服务器，在 `/opt/Idea2Screenplay-source`：

1. 获取服务器部署锁，拒绝脏工作区、分支分叉和已经过时的工作流。
2. 从 `github` remote 获取本次通过检查的准确提交。
3. 每次更新前运行现有 PostgreSQL 备份脚本，保留最近 7 份；失败立即停止。
4. 快进源码，依次构建 api 和 web 镜像，降低 4 GB 服务器的峰值内存。
5. 只重建 api、web，等待健康检查，再通过 Nginx 检查 API readiness。

数据库容器、数据卷、`.env.production`、证书目录和 super-agent 不在更新范围。
数据库 schema 仍会由 API 启动命令执行 Prisma migration；这不是零停机部署。
API 最多有 645 秒优雅停机时间。失败时不自动回滚数据库，也不清理旧镜像。
备份脚本会检查备份前后数据计数；持续有业务写入时可能拒绝部署，可在低峰重试。

## 一、创建 GitHub 仓库

在 https://github.com/new 创建一个空的 **Private** 仓库，例如 `idea2screenplay`。
不要初始化 README、License 或 .gitignore，保留服务器现有 Git 历史与 `master` 分支。
首次不要设置 `DEPLOY_ENABLED`，这样首次推送只执行检查。

## 二、把本次修改放回服务器

将更新包中的以下文件上传到服务器 `/opt/Idea2Screenplay-source` 的对应目录：

- `.github/workflows/deploy.yml`
- `.gitattributes`
- `scripts/deploy-github.sh`
- `scripts/test-deploy-github.mjs`
- `apps/web/Dockerfile`（补齐 agent workspace 的依赖清单）
- `apps/web/src/App.test.tsx`（按现有访问码机制测试路由保护）
- `apps/web/src/components/Studio.test.tsx`（按现有分组导航打开人物页）
- `docs/GITHUB_DEPLOYMENT.md`

终端检查并提交：

```bash
cd /opt/Idea2Screenplay-source
git diff --check
git diff -- apps/web/Dockerfile
git add .github/workflows/deploy.yml .gitattributes scripts/deploy-github.sh scripts/test-deploy-github.mjs apps/web/Dockerfile apps/web/src/App.test.tsx apps/web/src/components/Studio.test.tsx docs/GITHUB_DEPLOYMENT.md
git commit -m "Add GitHub Actions deployment"
```

不要用 ZIP 建一个新 Git 历史替换服务器历史，也不要覆盖服务器环境文件和证书。
完整源码包用于本地查看；更新包用于合入现有仓库。
推送历史前检查历史中是否曾提交生产密钥；若有，先清理历史并轮换泄露凭据。

## 三、让服务器能够访问 GitHub 仓库

在服务器生成单独的 GitHub 仓库密钥（如果路径已存在，不要覆盖）：

```bash
ssh-keygen -t ed25519 -f /root/.ssh/idea2screenplay-github -C idea2screenplay-github
cat /root/.ssh/idea2screenplay-github.pub
```

这把机器密钥的 passphrase 留空。将 **.pub 公钥**添加到 GitHub 仓库 Settings → Deploy keys。
首次要从服务器推送代码，暂时勾选 Allow write access；迁移后若继续从服务器编辑推送，需要保留写权限。
若以后只从本机推送，可换成只读 Deploy key。

在服务器 `/root/.ssh/config` 中新增下面配置；不要覆盖已有配置：

```sshconfig
Host github-idea2screenplay
    HostName github.com
    User git
    IdentityFile /root/.ssh/idea2screenplay-github
    IdentitiesOnly yes
```

执行 `ssh -T git@github-idea2screenplay`，首次连接时将指纹与 GitHub 官方页面核对：
https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
认证成功后 GitHub 提示不提供 shell 属正常情况。自动部署会严格校验已保存的主机密钥。

将下面的 `YOUR_USER/YOUR_REPO` 替换为真实仓库：

```bash
cd /opt/Idea2Screenplay-source
git remote add github git@github-idea2screenplay:YOUR_USER/YOUR_REPO.git
git push github master
```

保留现有 Gitee `origin`。以后发布用 `git push github master`。
如果 `github` remote 已经存在，先 `git remote get-url github` 确认，不要重复添加。
后续停止使用旧的 `scripts/deploy-ecs.sh` 发布，避免它仍从 Gitee 拉取或与新流程并行。

## 四、让 GitHub Actions 能登录服务器

这与上一节的密钥方向相反，需要另一把专用密钥。
在本机 PowerShell 生成（不要覆盖已存在文件）：

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\idea2screenplay-actions" -C idea2screenplay-actions
```

passphrase 留空，将生成的 `.pub` 公钥追加到服务器 `/root/.ssh/authorized_keys`，
建议在该行公钥之前添加 `restrict `，禁止转发和 PTY，但允许工作流执行部署命令。
确认 `/root/.ssh` 权限为 700，`authorized_keys` 为 600。保留原有登录配置。
此方案沿用现有 root 部署布局，专用密钥可以执行 root 命令；应仅放在受控仓库的 production Secrets 中。

在 GitHub 仓库 Settings → Environments 创建 `production`，添加以下 Secrets：

| 名称 | 内容 |
|---|---|
| `DEPLOY_HOST` | `8.130.170.254` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_PORT` | `22`（也可以不设置，默认 22） |
| `DEPLOY_SSH_KEY` | 本机 `idea2screenplay-actions` 私钥文件全文，直接粘贴到 GitHub，不发送到聊天 |
| `DEPLOY_KNOWN_HOSTS` | 经过核对的服务器 SSH 主机公钥行，见下方 |

从已经可信的服务器终端读取 **主机公钥**：

```bash
awk '{print "8.130.170.254 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

整行保存为 `DEPLOY_KNOWN_HOSTS`。非 22 端口时主机字段改为 `[8.130.170.254]:端口`。
这是公钥，不是私钥。不要使用关闭主机校验的 SSH 参数。

## 五、启用并验收

1. 确认第一次 GitHub Actions 的 check 任务成功。
2. 服务器运行 `docker compose version`，需要支持 `up --wait --wait-timeout`。
3. 确认服务器可以连接 GitHub、npm、Docker 镜像源，且 GitHub runner 能访问服务器 SSH 端口。
   不要为了接入而盲目将安全组开放给所有来源；已有网络策略若阻止 runner，需另行选择允许的执行环境。
4. 在 Settings → Secrets and variables → Actions → **Variables** 新增仓库变量 `DEPLOY_ENABLED`，值为 `true`。
5. Actions → Test and deploy → Run workflow → 选择 `master`。
6. 确认 check 和 deploy 都成功，手动访问网站并确认原有项目数据可见。

第一次使用手动运行，后续推送自动部署；PR 只测试，不获得部署密钥。
暂时停用自动部署：将 `DEPLOY_ENABLED` 改成 `false`，不影响正在运行的网站。

## 失败处理

- 本地变更：先审核并提交服务器修改，禁止强行 reset 或覆盖。
- 过时运行：执行最新 master 的 workflow，旧提交不会误覆盖新版本。
- 备份失败：旧容器保持运行，检查服务器备份目录和业务写入情况后重试。
- 构建失败：旧容器保持运行，但源码可能已快进；修复后推送，或重新运行同一提交。
- 健康检查失败：可能已切换了部分服务，需要在服务器排查；不要自动恢复数据库覆盖新数据。
  可在服务器本地查看 `docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=80 api web`。
  日志可能含业务信息，不要直接全部发布到公开页面。
- 数据库备份在 `/var/backups/idea2screenplay/postgres`。涉及 migration 的回退应单独审查兼容性和恢复方案。

## 官方参考

- GitHub 部署控制：https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
- Docker Compose up：https://docs.docker.com/reference/cli/docker/compose/up/
